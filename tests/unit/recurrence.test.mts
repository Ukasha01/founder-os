import assert from "node:assert/strict";
import { occurrences, withoutExceptions, type Rule } from "../../src/lib/recurrence.ts";

const base: Rule = { freq: "daily", interval_count: 1, by_weekday: null, by_monthday: null, times_of_day: null, start_date: "2026-11-02", end_date: null, is_paused: false };
const dates = (r: Rule, f: string, t: string) => occurrences(r, f, t).map((o) => o.date);

assert.deepEqual(dates(base, "2026-11-02", "2026-11-04"), ["2026-11-02", "2026-11-03", "2026-11-04"]);
assert.deepEqual(dates({ ...base, interval_count: 2 }, "2026-11-02", "2026-11-08"), ["2026-11-02", "2026-11-04", "2026-11-06", "2026-11-08"]);
assert.deepEqual(dates(base, "2026-10-01", "2026-11-03"), ["2026-11-02", "2026-11-03"], "never before start");
assert.deepEqual(dates({ ...base, end_date: "2026-11-03" }, "2026-11-02", "2026-11-10"), ["2026-11-02", "2026-11-03"], "stops at end date");
assert.deepEqual(dates({ ...base, is_paused: true }, "2026-11-02", "2026-11-10"), [], "paused generates nothing");
// weekly on Mon/Wed/Fri
assert.deepEqual(dates({ ...base, freq: "weekly", by_weekday: [1, 3, 5] }, "2026-11-02", "2026-11-08"), ["2026-11-02", "2026-11-04", "2026-11-06"]);
// every 2 weeks on Monday from 11-02: 11-02, 11-16, 11-30
assert.deepEqual(dates({ ...base, freq: "weekly", by_weekday: [1], interval_count: 2 }, "2026-11-02", "2026-12-01"), ["2026-11-02", "2026-11-16", "2026-11-30"]);
// weekly default weekday is start date's weekday (Mon)
assert.deepEqual(dates({ ...base, freq: "weekly" }, "2026-11-02", "2026-11-16"), ["2026-11-02", "2026-11-09", "2026-11-16"]);
// monthly on the 31st clamps to month end
assert.deepEqual(dates({ ...base, freq: "monthly", by_monthday: [31], start_date: "2026-01-31" }, "2026-02-01", "2026-04-30"), ["2026-02-28", "2026-03-31", "2026-04-30"]);
// multiple per day get indexes
const multi = occurrences({ ...base, times_of_day: ["18:00", "09:00"] }, "2026-11-02", "2026-11-02");
assert.deepEqual(multi.map((o) => [o.index, o.time]), [[0, "09:00"], [1, "18:00"]]);
// exceptions: skipping one occurrence leaves the others
const list = occurrences(base, "2026-11-02", "2026-11-04");
assert.deepEqual(withoutExceptions(list, [{ occurrence_date: "2026-11-03", occurrence_index: 0, kind: "skipped" }]).map((o) => o.date), ["2026-11-02", "2026-11-04"]);
// resume after pause starts from the window, no backfill
assert.deepEqual(dates(base, "2026-11-15", "2026-11-16"), ["2026-11-15", "2026-11-16"]);
console.log("recurrence tests passed");
