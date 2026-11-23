import { createHash, createSign } from "node:crypto";
import { z } from "zod";
import { breaker } from "./ai/breaker.ts";
import { dateInTz, timeInTz, zonedToUtc } from "./time.ts";

// Google Calendar mirror for reminders and timed tasks. Everything here is optional: with no valid configuration the
// feature is simply off and nothing else in the app changes. Secrets are never logged or returned.

export type GcalConfig = { calendarId: string; clientEmail: string; privateKey: string };
export type ParsedEnv = { on: true; cfg: GcalConfig } | { on: false; reason: string };

const KeySchema = z.object({
  type: z.literal("service_account"),
  client_email: z.string().email(),
  private_key: z.string().min(100),
});

// Accepts the key as raw JSON, or base64 of the JSON (use this if Vercel mangles the newlines in private_key).
export function parseGcalEnv(env: Record<string, string | undefined>): ParsedEnv {
  if ((env.GOOGLE_CALENDAR_SYNC ?? "").toLowerCase() === "off") return { on: false, reason: "Switched off (GOOGLE_CALENDAR_SYNC=off)." };
  const calendarId = (env.GOOGLE_CALENDAR_ID ?? "").trim();
  const raw = (env.GOOGLE_SERVICE_ACCOUNT_JSON || env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 || "").trim();
  if (!calendarId && !raw) return { on: false, reason: "Not configured." };
  if (!calendarId) return { on: false, reason: "GOOGLE_CALENDAR_ID is missing." };
  if (!raw) return { on: false, reason: "GOOGLE_SERVICE_ACCOUNT_JSON is missing." };
  let json: unknown;
  try { json = JSON.parse(raw); } catch {
    try { json = JSON.parse(Buffer.from(raw, "base64").toString("utf8")); } catch { return { on: false, reason: "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON." }; }
  }
  const p = KeySchema.safeParse(json);
  if (!p.success) return { on: false, reason: "The service account key is incomplete (needs type, client_email, private_key)." };
  const privateKey = p.data.private_key.replace(/\\n/g, "\n");
  if (!privateKey.includes("BEGIN PRIVATE KEY")) return { on: false, reason: "private_key is not a PEM key." };
  return { on: true, cfg: { calendarId, clientEmail: p.data.client_email, privateKey } };
}

// ---------------------------------------------------------------- event building (pure)
// Deterministic id: the same source always maps to the same event, so a retry can never create a duplicate.
export const eventIdFor = (type: string, id: string) => "fos" + createHash("sha256").update(`${type}:${id}`).digest("hex").slice(0, 48);

export type EventSpec = { kind: "reminder" | "task"; id: string; title: string; start: Date; end: Date; tz: string; url: string; popups: number[]; test?: boolean };
const wall = (d: Date, tz: string) => `${dateInTz(d, tz)}T${timeInTz(d, tz)}:00`;

export function buildEvent(s: EventSpec) {
  return {
    summary: s.kind === "reminder" ? `⏰ ${s.title}` : `Due: ${s.title}`,
    description: `Founder OS ${s.kind}. Open: ${s.url}`,
    start: { dateTime: wall(s.start, s.tz), timeZone: s.tz },
    end: { dateTime: wall(s.end, s.tz), timeZone: s.tz },
    transparency: "transparent",
    status: "confirmed",
    reminders: { useDefault: false, overrides: s.popups.slice(0, 5).map((minutes) => ({ method: "popup", minutes })) },
    extendedProperties: { private: { fosSource: s.kind, fosId: s.id, fosTest: s.test ? "1" : "0" } },
  };
}
export const payloadHash = (body: unknown) => createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 32);

export type SkipReason = "past";

// Which reminders mirror to Google: only ones set by the user/assistant (not auto-planned digests, events or tests).
export function reminderQualifies(r: { kind: string; event_id?: string | null; task_id?: string | null; meeting_id?: string | null; commitment_id?: string | null; dedupe_key?: string | null }): boolean {
  return r.kind === "custom" && !r.event_id && !r.task_id && !r.meeting_id && !r.commitment_id && (r.dedupe_key ?? "").startsWith("custom:");
}
export function reminderSpec(r: { id: string; title: string; remind_at: string }, tz: string, now: Date, appUrl: string): { spec: EventSpec } | { skip: SkipReason } {
  const start = new Date(r.remind_at);
  if (!(start.getTime() > now.getTime())) return { skip: "past" };   // a popup in the past can never fire
  return { spec: { kind: "reminder", id: r.id, title: r.title, start, end: new Date(start.getTime() + 15 * 60_000), tz, url: `${appUrl}/`, popups: [0] } };
}
export function taskSpec(t: { id: string; title: string; current_deadline: string; due_time: string; estimated_minutes?: number | null }, tz: string, now: Date, appUrl: string): { spec: EventSpec } | { skip: SkipReason } {
  const start = zonedToUtc(`${t.current_deadline}T${String(t.due_time).slice(0, 5)}`, tz);
  if (Number.isNaN(start.getTime()) || !(start.getTime() > now.getTime())) return { skip: "past" };
  const mins = Math.min(Math.max(t.estimated_minutes ?? 30, 15), 240);
  return { spec: { kind: "task", id: t.id, title: t.title, start, end: new Date(start.getTime() + mins * 60_000), tz, url: `${appUrl}/tasks/${t.id}`, popups: [10, 0] } };
}

// ---------------------------------------------------------------- API client
export type Fetch = typeof fetch;
export type ApiResult = { ok: true } | { ok: false; status: number; message: string };
const scrub = (s: string) => s.replace(/[A-Za-z0-9_\-]{40,}/g, "…").slice(0, 200);

export function makeClient(cfg: GcalConfig, f: Fetch = fetch, nowMs: () => number = Date.now) {
  let token: { value: string; exp: number } | null = null;
  const b64u = (x: string | Buffer) => Buffer.from(x).toString("base64url");

  async function getToken(): Promise<{ ok: true; value: string } | { ok: false; status: number; message: string }> {
    if (token && token.exp > nowMs() + 60_000) return { ok: true, value: token.value };
    const iat = Math.floor(nowMs() / 1000);
    const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64u(JSON.stringify({ iss: cfg.clientEmail, scope: "https://www.googleapis.com/auth/calendar.events", aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 }));
    let sig: string;
    try { sig = createSign("RSA-SHA256").update(`${head}.${claims}`).sign(cfg.privateKey).toString("base64url"); }
    catch { return { ok: false, status: 0, message: "The private key could not sign (check GOOGLE_SERVICE_ACCOUNT_JSON)." }; }
    try {
      const r = await f("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${sig}` }), signal: AbortSignal.timeout(8000) });
      const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
      if (!r.ok || !j.access_token) return { ok: false, status: r.status, message: scrub(`Google sign-in failed: ${j.error_description ?? j.error ?? r.status}`) };
      token = { value: j.access_token, exp: nowMs() + (j.expires_in ?? 3600) * 1000 };
      return { ok: true, value: token.value };
    } catch { return { ok: false, status: 0, message: "Could not reach Google sign-in." }; }
  }

  async function call(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<ApiResult & { status?: number }> {
    if (breaker.open("gcal")) return { ok: false, status: 0, message: "Google Calendar paused after repeated sign-in/permission errors." };
    const t = await getToken();
    if (!t.ok) { if (t.status === 400 || t.status === 401 || t.status === 403) breaker.fail("gcal", { limit: 1, coolMs: 600_000 }); return t; }
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cfg.calendarId)}/events${path}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await f(url, { method, headers: { authorization: `Bearer ${t.value}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
        if (r.ok || okStatuses.includes(r.status)) return { ok: true, status: r.status };
        if ((r.status === 429 || r.status >= 500) && attempt < 2) { await new Promise((res) => setTimeout(res, 300 * (attempt + 1))); continue; }
        const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
        if (r.status === 401 || r.status === 403) breaker.fail("gcal", { limit: 1, coolMs: 600_000 });
        return { ok: false, status: r.status, message: scrub(`Google Calendar ${r.status}: ${j.error?.message ?? "no details"}`) };
      } catch { if (attempt === 2) return { ok: false, status: 0, message: "Could not reach Google Calendar." }; }
    }
    return { ok: false, status: 0, message: "Could not reach Google Calendar." };
  }

  return {
    // Create with our own id; if it already exists (409, including a deleted one) replace it, which also revives it.
    async upsert(eventId: string, body: ReturnType<typeof buildEvent>): Promise<ApiResult> {
      const c = await call("POST", "", { id: eventId, ...body }, []);
      if (c.ok || c.status !== 409) return c;
      return call("PUT", `/${encodeURIComponent(eventId)}`, { id: eventId, ...body });
    },
    // Already gone (404/410) counts as deleted.
    remove: (eventId: string) => call("DELETE", `/${encodeURIComponent(eventId)}`, undefined, [404, 410]),
  };
}
export type GcalClient = ReturnType<typeof makeClient>;
