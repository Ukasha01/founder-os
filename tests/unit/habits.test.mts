import assert from "node:assert/strict";
import { currentStreak, consistency, isScheduled, type HabitDef, type Entries, type EntryStatus } from "../../src/lib/habits.ts";

const daily: HabitDef = { frequency_type: "daily", weekdays: null, weekly_target: null, start_date: "2026-11-01" };
const e = (o: Record<string, EntryStatus>): Entries => new Map(Object.entries(o));
// Today = Sun 2026-11-15
assert.equal(currentStreak(daily, e({ "2026-11-14": "done", "2026-11-13": "done", "2026-11-12": "done" }), "2026-11-15"), 3, "unlogged today does not break streak");
assert.equal(currentStreak(daily, e({ "2026-11-15": "done", "2026-11-14": "done", "2026-11-12": "done" }), "2026-11-15"), 2, "missed past day breaks streak");
assert.equal(currentStreak(daily, e({ "2026-11-15": "done", "2026-11-14": "skipped", "2026-11-13": "done" }), "2026-11-15"), 2, "skipped is excused");
assert.equal(currentStreak(daily, e({ "2026-11-15": "done", "2026-11-14": "partial", "2026-11-13": "done" }), "2026-11-15"), 1, "partial breaks streak");
assert.equal(currentStreak(daily, e({}), "2026-11-15"), 0);
// weekdays Mon/Wed/Fri: 2026-11-13 is Fri, 11-11 Wed, 11-09 Mon
const mwf: HabitDef = { frequency_type: "weekdays", weekdays: [1, 3, 5], weekly_target: null, start_date: "2026-11-01" };
assert.equal(isScheduled(mwf, "2026-11-13"), true);
assert.equal(isScheduled(mwf, "2026-11-14"), false);
assert.equal(currentStreak(mwf, e({ "2026-11-13": "done", "2026-11-11": "done", "2026-11-09": "done" }), "2026-11-15"), 3, "off days are ignored");
// start date respected
assert.equal(isScheduled(daily, "2026-10-31"), false);
// consistency: no expected days is null, not 0
assert.equal(consistency(mwf, e({}), "2026-11-14", "2026-11-14", "2026-11-15"), null);
assert.equal(consistency(daily, e({ "2026-11-14": "done", "2026-11-13": "skipped", "2026-11-12": "partial", "2026-11-11": "done" }), "2026-11-11", "2026-11-14", "2026-11-15"), 83, "skipped excluded; partial counts half: 2.5/3");
// future days are not counted as missed
assert.equal(consistency(daily, e({ "2026-11-15": "done" }), "2026-11-15", "2026-11-30", "2026-11-15"), 100);
// weekly target of 3 (Mon-start weeks): week of 11-09 has 3 done, week of 11-02 has 2 done
const wk: HabitDef = { frequency_type: "weekly_target", weekdays: null, weekly_target: 3, start_date: "2026-11-01" };
assert.equal(currentStreak(wk, e({ "2026-11-09": "done", "2026-11-11": "done", "2026-11-13": "done", "2026-11-03": "done", "2026-11-04": "done" }), "2026-11-15"), 1, "last week met, week before missed");
assert.equal(currentStreak(wk, e({ "2026-11-09": "done" }), "2026-11-15"), 0, "week in progress and prior week missed");
console.log("habit tests passed");
