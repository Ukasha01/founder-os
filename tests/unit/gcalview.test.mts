import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { breaker } from "../../src/lib/ai/breaker.ts";
import { makeClient, reminderSpec } from "../../src/lib/gcal.ts";
import { buildUserEvent, daySegments, normalizeEvent } from "../../src/lib/gcal-view.ts";
import { pullGoogleAlerts } from "../../src/lib/gcal-pull.ts";

const TZ = "Asia/Karachi";
const NOW = new Date("2026-11-27T07:00:00Z");   // 12:00 Karachi

test("normalise: timed, all-day, mirrored and cancelled events", () => {
  const e = normalizeEvent({ id: "a", summary: "Call", start: { dateTime: "2026-11-27T09:00:00Z" }, end: { dateTime: "2026-11-27T10:30:00Z" } }, TZ)!;
  assert.equal(e.startLocal, "2026-11-27T14:00"); assert.equal(e.endLocal, "2026-11-27T15:30"); assert.equal(e.startMin, 840); assert.equal(e.endMin, 930); assert.equal(e.source, null);
  const d = normalizeEvent({ id: "b", summary: "Trip", start: { date: "2026-12-01" }, end: { date: "2026-12-04" } }, TZ)!;
  assert.equal(d.allDay, true); assert.equal(d.startDate, "2026-12-01"); assert.equal(d.endDate, "2026-12-03");   // Google's end is exclusive
  const m = normalizeEvent({ id: "c", summary: "⏰ x", start: { dateTime: "2026-11-27T09:00:00+00:00" }, end: { dateTime: "2026-11-27T09:15:00+00:00" }, extendedProperties: { private: { fosSource: "reminder", fosId: "r1" } } }, TZ)!;
  assert.equal(m.source, "reminder"); assert.equal(m.sourceId, "r1");
  assert.equal(normalizeEvent({ id: "z", status: "cancelled", start: { date: "2026-11-27" }, end: { date: "2026-11-28" } }, TZ), null);
  assert.equal(normalizeEvent({ id: "z", summary: "no times" }, TZ), null);
  assert.equal(normalizeEvent({ id: "z", start: { date: "2026-11-27" }, end: { date: "2026-11-28" } }, TZ)!.title, "(no title)");
});

test("day segments: overnight events split, midnight end, zero length, range clip", () => {
  const night = normalizeEvent({ id: "n", summary: "Late", start: { dateTime: "2026-11-27T17:00:00Z" }, end: { dateTime: "2026-11-27T21:00:00Z" } }, TZ)!;   // 22:00 -> 02:00
  assert.deepEqual(daySegments(night, "2026-11-27", "2026-11-29").map((s) => [s.date, s.startMin, s.endMin]), [["2026-11-27", 1320, 1440], ["2026-11-28", 0, 120]]);
  const toMidnight = normalizeEvent({ id: "m", summary: "x", start: { dateTime: "2026-11-27T17:00:00Z" }, end: { dateTime: "2026-11-27T19:00:00Z" } }, TZ)!;   // 22:00 -> 00:00
  assert.deepEqual(daySegments(toMidnight, "2026-11-27", "2026-11-29").map((s) => s.date), ["2026-11-27"]);
  const zero = normalizeEvent({ id: "z", summary: "x", start: { dateTime: "2026-11-27T09:00:00Z" }, end: { dateTime: "2026-11-27T09:00:00Z" } }, TZ)!;
  assert.equal(daySegments(zero, "2026-11-27", "2026-11-27")[0].endMin - 840, 30);
  const trip = normalizeEvent({ id: "t", summary: "Trip", start: { date: "2026-12-01" }, end: { date: "2026-12-04" } }, TZ)!;
  assert.deepEqual(daySegments(trip, "2026-12-02", "2026-12-10").map((s) => s.date), ["2026-12-02", "2026-12-03"]);
  assert.deepEqual(daySegments(trip, "2026-11-01", "2026-11-30"), []);
});

test("building an event from the app form", () => {
  const t = buildUserEvent({ title: "Gym", notes: "legs", allDay: false, startLocal: "2026-11-28T18:00", endLocal: "2026-11-28T19:00", tz: TZ });
  assert.deepEqual(t.start, { dateTime: "2026-11-28T18:00:00", timeZone: TZ }); assert.deepEqual(t.reminders.overrides.map((o) => o.minutes), [10, 0]);
  const a = buildUserEvent({ title: "Eid", notes: "", allDay: true, startLocal: "2026-12-01T00:00", endLocal: "2026-12-02T00:00", tz: TZ });
  assert.deepEqual(a.start, { date: "2026-12-01" }); assert.deepEqual(a.end, { date: "2026-12-03" }); assert.deepEqual(a.reminders.overrides, []);
  const bad = buildUserEvent({ title: "x", notes: "", allDay: true, startLocal: "2026-12-05T00:00", endLocal: "2026-12-01T00:00", tz: TZ });
  assert.deepEqual(bad.end, { date: "2026-12-06" });   // an end before the start becomes a one-day event
});

test("reminders: heads-up only when there is room", () => {
  const far = reminderSpec({ id: "1", title: "x", remind_at: "2026-11-27T09:00:00Z" }, TZ, NOW, "u"); const near = reminderSpec({ id: "2", title: "x", remind_at: "2026-11-27T07:05:00Z" }, TZ, NOW, "u");
  assert.ok("spec" in far && "spec" in near); assert.deepEqual(far.spec.popups, [10, 0]); assert.deepEqual(near.spec.popups, [0]);
});

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const cfg = { calendarId: "cal@group", clientEmail: "bot@p.iam.gserviceaccount.com", privateKey };
function fakeFetch(items: unknown[], log: { url: string; method: string; body?: string }[]) {
  return (async (url: string, init?: RequestInit) => {
    if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
    log.push({ url: String(url), method: init?.method ?? "GET", body: init?.body as string | undefined });
    if ((init?.method ?? "GET") === "GET") return new Response(JSON.stringify({ items }), { status: 200 });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return new Response(init?.body as string, { status: 200 });
  }) as unknown as typeof fetch;
}

test("client: list, create, patch, remove talk to the right endpoints", async () => {
  breaker.reset("gcal"); const log: { url: string; method: string; body?: string }[] = [];
  const c = makeClient(cfg, fakeFetch([{ id: "e1", summary: "A" }], log));
  const l = await c.list("2026-11-27T00:00:00Z", "2026-11-28T00:00:00Z"); assert.ok(l.ok && l.items.length === 1);
  assert.match(log[0].url, /singleEvents=true/); assert.match(log[0].url, /timeMin=2026-11-27/);
  const cr = await c.create({ summary: "B" }); assert.ok(cr.ok && cr.item.summary === "B");
  assert.ok((await c.patch("e1", { summary: "C" })).ok); assert.equal(log.at(-1)!.method, "PATCH");
  assert.ok((await c.remove("e1")).ok); assert.equal(log.at(-1)!.method, "DELETE");
});

// Minimal stand-in for the reminders table.
function fakeDb(existing: { id: string; dedupe_key: string; status: string; remind_at: string }[]) {
  const rows = [...existing]; const inserted: Record<string, unknown>[] = [];
  const db = { from: () => ({
    insert: async (r: Record<string, unknown>) => { if (rows.some((x) => x.dedupe_key === r.dedupe_key)) return { error: { code: "23505" } }; inserted.push(r); rows.push({ id: `n${rows.length}`, dedupe_key: r.dedupe_key as string, status: "pending", remind_at: r.remind_at as string }); return { error: null }; },
    select: () => { const q: Record<string, unknown> = {}; const chain = { eq: () => chain, like: () => chain, gt: () => Promise.resolve({ data: rows.filter((x) => x.status === "pending" && x.dedupe_key.startsWith("gcal:")) }) }; return Object.assign(q, chain); },
    update: (patch: Record<string, unknown>) => ({ eq: (_c: string, id: string) => ({ eq: async () => { const r = rows.find((x) => x.id === id); if (r) r.status = patch.status as string; return { error: null }; } }) }),
  }) };
  return { db: db as never, rows, inserted };
}

test("pull: Google-made events become reminders once; moved or deleted ones are cancelled; mirrors and all-day are skipped", async () => {
  breaker.reset("gcal"); const log: { url: string; method: string }[] = [];
  const items = [
    { id: "g1", summary: "Dentist", start: { dateTime: "2026-11-27T09:00:00Z" }, end: { dateTime: "2026-11-27T10:00:00Z" } },
    { id: "g2", summary: "Holiday", start: { date: "2026-11-28" }, end: { date: "2026-11-29" } },
    { id: "g3", summary: "⏰ mine", start: { dateTime: "2026-11-27T09:00:00Z" }, end: { dateTime: "2026-11-27T09:15:00Z" }, extendedProperties: { private: { fosSource: "reminder", fosId: "r" } } },
  ];
  const { db, rows, inserted } = fakeDb([{ id: "old", dedupe_key: "gcal:g9:1", status: "pending", remind_at: "2026-11-27T11:00:00Z" }]);
  const gc = makeClient(cfg, fakeFetch(items, log));
  const a = await pullGoogleAlerts(db, gc, NOW, "owner", TZ, ["in_app", "push"]);
  assert.equal(a.created, 1); assert.equal(inserted[0].title, "Dentist"); assert.equal(inserted[0].remind_at, "2026-11-27T09:00:00.000Z"); assert.equal(a.cancelled, 1);
  assert.equal(rows.find((r) => r.id === "old")!.status, "cancelled");
  const b = await pullGoogleAlerts(db, gc, NOW, "owner", TZ, ["in_app"]);   // second run: nothing new
  assert.equal(b.created, 0);
});
