import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { breaker } from "../../src/lib/ai/breaker.ts";
import { buildEvent, eventIdFor, makeClient, parseGcalEnv, payloadHash, reminderQualifies, reminderSpec, taskSpec } from "../../src/lib/gcal.ts";
import { syncGoogle } from "../../src/lib/gcal-sync.ts";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const sa = { type: "service_account", client_email: "bot@proj.iam.gserviceaccount.com", private_key: privateKey };
const cfg = { calendarId: "cal@group.calendar.google.com", clientEmail: sa.client_email, privateKey };
const NOW = new Date("2026-11-23T08:00:00Z");   // 13:00 in Karachi

test("env parsing: raw JSON, base64, escaped newlines, and safe failures", () => {
  assert.equal(parseGcalEnv({}).on, false);
  assert.equal(parseGcalEnv({ GOOGLE_CALENDAR_ID: "c", GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(sa) }).on, true);
  assert.equal(parseGcalEnv({ GOOGLE_CALENDAR_ID: "c", GOOGLE_SERVICE_ACCOUNT_JSON_B64: Buffer.from(JSON.stringify(sa)).toString("base64") }).on, true);
  const esc = parseGcalEnv({ GOOGLE_CALENDAR_ID: "c", GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ ...sa, private_key: privateKey.replace(/\n/g, "\\n") }) });
  assert.ok(esc.on && esc.cfg.privateKey.includes("\n"));
  for (const bad of [{ GOOGLE_CALENDAR_ID: "c" }, { GOOGLE_SERVICE_ACCOUNT_JSON: "{}" }, { GOOGLE_CALENDAR_ID: "c", GOOGLE_SERVICE_ACCOUNT_JSON: "not json" }, { GOOGLE_CALENDAR_ID: "c", GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ ...sa, type: "user" }) }, { GOOGLE_CALENDAR_SYNC: "off", GOOGLE_CALENDAR_ID: "c", GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(sa) }]) {
    const r = parseGcalEnv(bad); assert.equal(r.on, false); assert.ok(!JSON.stringify(r).includes("PRIVATE KEY"));
  }
});

test("event id is deterministic and Google-valid; body uses Karachi time and popups", () => {
  assert.equal(eventIdFor("task", "x"), eventIdFor("task", "x")); assert.notEqual(eventIdFor("task", "x"), eventIdFor("reminder", "x"));
  assert.match(eventIdFor("task", "x"), /^[a-v0-9]{5,1024}$/);
  const r = reminderSpec({ id: "r1", title: "Check Gmail", remind_at: "2026-11-23T09:00:00Z" }, "Asia/Karachi", NOW, "https://app");
  assert.ok("spec" in r); const b = buildEvent(r.spec);
  assert.equal(b.start.dateTime, "2026-11-23T14:00:00"); assert.equal(b.start.timeZone, "Asia/Karachi"); assert.equal(b.end.dateTime, "2026-11-23T14:15:00");
  assert.deepEqual(b.reminders, { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] });
  assert.equal(b.extendedProperties.private.fosTest, "0");
  const t = taskSpec({ id: "t1", title: "Report", current_deadline: "2026-11-24", due_time: "14:00:00", estimated_minutes: 60 }, "Asia/Karachi", NOW, "https://app");
  assert.ok("spec" in t); const tb = buildEvent(t.spec);
  assert.equal(tb.start.dateTime, "2026-11-24T14:00:00"); assert.equal(tb.end.dateTime, "2026-11-24T15:00:00"); assert.deepEqual(tb.reminders.overrides.map((o) => o.minutes), [10, 0]);
  assert.equal(payloadHash(b), payloadHash(buildEvent(r.spec)));
});

test("past times are skipped; only user-set reminders qualify", () => {
  assert.deepEqual(reminderSpec({ id: "r", title: "x", remind_at: "2026-11-23T07:59:00Z" }, "Asia/Karachi", NOW, ""), { skip: "past" });
  assert.deepEqual(taskSpec({ id: "t", title: "x", current_deadline: "2026-11-23", due_time: "12:00" }, "Asia/Karachi", NOW, ""), { skip: "past" });
  assert.equal(reminderQualifies({ kind: "custom", dedupe_key: "custom:abc" }), true);
  assert.equal(reminderQualifies({ kind: "custom", dedupe_key: "event:1:x", event_id: "e" }), false);
  assert.equal(reminderQualifies({ kind: "deadline", dedupe_key: "digest:2026" }), false);
  assert.equal(reminderQualifies({ kind: "custom", dedupe_key: "test:123" }), false);
});

// ---- API client with a mocked Google ----
function mockFetch(handler: (url: string, init: RequestInit) => { status: number; body?: unknown }) {
  const calls: { url: string; method: string }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    if (url.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    calls.push({ url, method: init.method ?? "GET" });
    const r = handler(url, init); return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const body = buildEvent({ kind: "reminder", id: "r1", title: "x", start: new Date("2026-11-23T09:00:00Z"), end: new Date("2026-11-23T09:15:00Z"), tz: "Asia/Karachi", url: "", popups: [0] });

test("client: create, 409 becomes update, delete tolerates 404, 429 retries, 403 pauses", async () => {
  breaker.reset();
  let m = mockFetch(() => ({ status: 200 })); assert.deepEqual(await makeClient(cfg, m.f).upsert("e1", body), { ok: true, status: 200 });
  m = mockFetch((_u, i) => ({ status: i.method === "POST" ? 409 : 200 })); assert.equal((await makeClient(cfg, m.f).upsert("e1", body)).ok, true); assert.deepEqual(m.calls.map((c) => c.method), ["POST", "PUT"]);
  m = mockFetch(() => ({ status: 404 })); assert.equal((await makeClient(cfg, m.f).remove("e1")).ok, true);
  let n = 0; m = mockFetch(() => ({ status: ++n < 2 ? 429 : 200 })); assert.equal((await makeClient(cfg, m.f).upsert("e1", body)).ok, true); assert.equal(m.calls.length, 2);
  m = mockFetch(() => ({ status: 403, body: { error: { message: "Forbidden" } } })); const r = await makeClient(cfg, m.f).upsert("e1", body);
  assert.equal(r.ok, false); assert.equal(breaker.open("gcal"), true);
  const again = mockFetch(() => ({ status: 200 })); assert.equal((await makeClient(cfg, again.f).upsert("e2", body)).ok, false); assert.equal(again.calls.length, 0);
  breaker.reset();
});

// ---- sync engine against an in-memory database ----
type R = Record<string, unknown>;
function fakeDb(tables: Record<string, R[]>) {
  const t = (n: string) => (tables[n] ??= []);
  const q = (name: string) => {
    let rows = t(name).slice(); let op: "select" | "update" | "delete" | "insert" | "upsert" = "select"; let patch: R = {};
    const b: Record<string, unknown> = {};
    const f = (fn: (r: R) => boolean) => { rows = rows.filter(fn); return b; };
    Object.assign(b, {
      select: () => b, order: () => b, limit: () => b,
      eq: (c: string, v: unknown) => f((r) => r[c] === v), neq: (c: string, v: unknown) => f((r) => r[c] !== v),
      is: (c: string, v: unknown) => f((r) => (r[c] ?? null) === v), not: (c: string, _o: string, v: unknown) => f((r) => (r[c] ?? null) !== v),
      in: (c: string, v: unknown[]) => f((r) => v.includes(r[c])), gt: (c: string, v: string) => f((r) => String(r[c]) > v), gte: (c: string, v: string) => f((r) => String(r[c]) >= v), lte: (c: string, v: string) => f((r) => String(r[c]) <= v),
      like: (c: string, v: string) => f((r) => String(r[c] ?? "").startsWith(v.replace("%", ""))),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      update: (p: R) => { op = "update"; patch = p; return b; }, delete: () => { op = "delete"; return b; },
      insert: (p: R) => { op = "insert"; t(name).push({ id: `id${t(name).length}`, created_at: NOW.toISOString(), ...p }); return b; },
      upsert: (p: R) => { op = "upsert"; const ex = t(name).find((r) => r.source_type === p.source_type && r.source_id === p.source_id); if (ex) Object.assign(ex, p); else t(name).push({ id: `id${t(name).length}`, created_at: NOW.toISOString(), ...p }); return b; },
      then: (res: (v: unknown) => unknown) => {
        if (op === "update") rows.forEach((r) => Object.assign(r, patch));
        if (op === "delete") tables[name] = t(name).filter((r) => !rows.includes(r));
        return Promise.resolve({ data: op === "select" ? rows : null, error: null }).then(res);
      },
    });
    return b;
  };
  return { from: q } as never;
}
const fakeGc = () => { const log: string[] = []; return { log, gc: { upsert: async (id: string) => { log.push(`up:${id}`); return { ok: true as const }; }, remove: async (id: string) => { log.push(`rm:${id}`); return { ok: true as const }; } } as never }; };
const tz = new Map([["u1", "Asia/Karachi"]]);

test("sync engine: creates once, is idempotent, updates on change, deletes on ack, skips past", async () => {
  const tables: Record<string, R[]> = {
    reminders: [
      { id: "r1", owner_id: "u1", title: "Gmail", remind_at: "2026-11-23T09:00:00Z", kind: "custom", dedupe_key: "custom:1", status: "pending", acked_at: null },
      { id: "r2", owner_id: "u1", title: "Old", remind_at: "2026-11-23T07:00:00Z", kind: "custom", dedupe_key: "custom:2", status: "sent", acked_at: null },
      { id: "r3", owner_id: "u1", title: "Digest", remind_at: "2026-11-23T10:00:00Z", kind: "deadline", dedupe_key: "digest:x", status: "pending", acked_at: null },
    ],
    tasks: [{ id: "t1", owner_id: "u1", title: "Report", current_deadline: "2026-11-24", due_time: "14:00:00", status: "not_started", deleted_at: null, estimated_minutes: null }],
    google_calendar_links: [],
  };
  const db = fakeDb(tables); const g = fakeGc();
  let s = await syncGoogle(db, g.gc, NOW, "https://app", tz);
  assert.equal(s.created, 2); assert.equal(s.skipped_past, 0); assert.equal(tables.google_calendar_links.length, 2);
  s = await syncGoogle(db, g.gc, NOW, "https://app", tz);                          // nothing changed: no new calls
  assert.equal(s.created + s.updated, 0); assert.equal(g.log.length, 2);
  tables.tasks[0].due_time = "16:00:00";                                           // rescheduled: patched, not duplicated
  s = await syncGoogle(db, g.gc, NOW, "https://app", tz); assert.equal(s.updated, 1); assert.equal(tables.google_calendar_links.length, 2);
  tables.reminders[0].acked_at = NOW.toISOString();                                // Done: event removed
  s = await syncGoogle(db, g.gc, NOW, "https://app", tz); assert.equal(s.deleted, 1); assert.ok(g.log.some((l) => l.startsWith("rm:")));
  tables.tasks[0].deleted_at = NOW.toISOString();                                  // task deleted: event removed
  s = await syncGoogle(db, g.gc, NOW, "https://app", tz); assert.equal(s.deleted, 1);
  tables.tasks[0].deleted_at = null;                                               // Undo: comes back with the same event id
  s = await syncGoogle(db, g.gc, NOW, "https://app", tz); assert.equal(s.created, 1); assert.equal(g.log.filter((l) => l === `up:${eventIdFor("task", "t1")}`).length, 3);   // created, rescheduled, brought back: always the same event id
});

test("sync engine: a failing Google call is recorded, retried, and stops after 5 attempts", async () => {
  const tables: Record<string, R[]> = { reminders: [{ id: "r1", owner_id: "u1", title: "x", remind_at: "2026-11-23T09:00:00Z", kind: "custom", dedupe_key: "custom:1", status: "pending", acked_at: null }], tasks: [], google_calendar_links: [] };
  const db = fakeDb(tables); let calls = 0;
  const gc = { upsert: async () => { calls++; return { ok: false as const, status: 500, message: "boom" }; }, remove: async () => ({ ok: true as const }) } as never;
  for (let i = 0; i < 8; i++) await syncGoogle(db, gc, NOW, "", tz);
  assert.equal(calls, 5); assert.equal(tables.google_calendar_links[0].status, "failed"); assert.equal(tables.google_calendar_links[0].last_error, "boom");
});

test("sync engine: expired test events are cleaned up, fresh ones are kept", async () => {
  const old = new Date(NOW.getTime() - 30 * 60_000).toISOString();
  const tables: Record<string, R[]> = { reminders: [], tasks: [], google_calendar_links: [
    { id: "a", owner_id: "u1", source_type: "reminder", source_id: "x1", google_event_id: "ev-old", status: "synced", is_test: true, created_at: old, attempts: 0, payload_hash: null },
    { id: "b", owner_id: "u1", source_type: "reminder", source_id: "x2", google_event_id: "ev-new", status: "synced", is_test: true, created_at: NOW.toISOString(), attempts: 0, payload_hash: null }] };
  const g = fakeGc(); await syncGoogle(fakeDb(tables), g.gc, NOW, "", tz);
  assert.deepEqual(g.log, ["rm:ev-old"]); assert.equal(tables.google_calendar_links.length, 1);
});
