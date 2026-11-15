import assert from "node:assert/strict";
import { zonedToUtc, dateInTz, addDays, startOfWeek, addMonths, rangeUtc, weekday } from "../../src/lib/time.ts";
// Karachi is UTC+5 all year
assert.equal(zonedToUtc("2026-11-15T14:30", "Asia/Karachi").toISOString(), "2026-11-15T09:30:00.000Z");
assert.equal(dateInTz(new Date("2026-11-14T20:30:00Z"), "Asia/Karachi"), "2026-11-15"); // crosses midnight
// DST zone: London winter (UTC+0) and summer (UTC+1)
assert.equal(zonedToUtc("2026-01-10T09:00", "Europe/London").toISOString(), "2026-01-10T09:00:00.000Z");
assert.equal(zonedToUtc("2026-07-10T09:00", "Europe/London").toISOString(), "2026-07-10T08:00:00.000Z");
// New York spring-forward day: 2026-03-08, 12:00 local is EDT (UTC-4)
assert.equal(zonedToUtc("2026-03-08T12:00", "America/New_York").toISOString(), "2026-03-08T16:00:00.000Z");
// A DST day is 23 hours long
const r = rangeUtc("2026-03-08", "2026-03-08", "America/New_York");
assert.equal((r.end.getTime() - r.start.getTime()) / 3600000, 23);
assert.equal(addDays("2026-02-28", 1), "2026-03-01");
assert.equal(addDays("2026-12-31", 1), "2027-01-01");
assert.equal(weekday("2026-11-15"), 0); // Sunday
assert.equal(startOfWeek("2026-11-15", 1), "2026-11-09"); // Monday start
assert.equal(startOfWeek("2026-11-16", 1), "2026-11-16");
assert.equal(startOfWeek("2026-11-15", 0), "2026-11-15"); // Sunday start
assert.equal(addMonths("2026-12-15", 1), "2027-01-01");
console.log("time helpers: all assertions passed");
