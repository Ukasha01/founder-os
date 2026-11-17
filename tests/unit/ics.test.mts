import test from "node:test";
import assert from "node:assert/strict";
import { buildIcs, escapeText, fold } from "../../src/lib/ics.ts";

test("escapes special characters", () => { assert.equal(escapeText("a,b;c\\d\ne"), "a\\,b\;c\\\\d\\ne"); });
test("folds long lines at 75 octets without splitting characters", () => {
  const f = fold("SUMMARY:" + "ا".repeat(60));
  for (const part of f.split("\r\n")) assert.ok(new TextEncoder().encode(part).length <= 75);
  assert.equal(f.replace(/\r\n /g, ""), "SUMMARY:" + "ا".repeat(60));
});
test("timed and all-day events", () => {
  const ics = buildIcs([
    { uid: "a@x", title: "Demo, call", start: "2026-11-20T10:00:00Z", end: "2026-11-20T11:00:00Z", stampedAt: "2026-11-17T00:00:00Z" },
    { uid: "b@x", title: "Report due", start: "2026-11-30", allDay: true, stampedAt: "2026-11-17T00:00:00Z" },
    { uid: "c@x", title: "No end", start: "2026-11-21T09:00:00Z", end: null, stampedAt: "2026-11-17T00:00:00Z" },
  ]);
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(ics.includes("DTSTART:20261120T100000Z") && ics.includes("DTEND:20261120T110000Z"));
  assert.ok(ics.includes("SUMMARY:Demo\\, call"));
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20261130") && ics.includes("DTEND;VALUE=DATE:20261201"));
  assert.ok(ics.includes("DTEND:20261121T093000Z"));
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 3);
});
