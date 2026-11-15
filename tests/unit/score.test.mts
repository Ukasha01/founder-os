import assert from "node:assert/strict";
import { computeScore, validateWeights, DEFAULT_WEIGHTS, type ScoreInput } from "../../src/lib/score.ts";

const base: ScoreInput = { tasksPlanned: 0, tasksCompleted: 0, tasksRescheduled: 0, tasksCancelled: 0, plannedMinutes: 0, actualMinutes: 0, kpiRatios: [], habitsExpected: 0, habitsDone: 0, dayPlanned: false, reviewDone: false };

// Perfect day
let r = computeScore({ ...base, tasksPlanned: 4, tasksCompleted: 4, plannedMinutes: 240, actualMinutes: 240, kpiRatios: [1], habitsExpected: 2, habitsDone: 2, dayPlanned: true, reviewDone: true });
assert.equal(r.total, 100);
// Missing data is not zero: only planning available, planned+reviewed => 100, not dragged down
r = computeScore({ ...base, dayPlanned: true, reviewDone: true });
assert.equal(r.total, 100);
assert.equal(r.categories.tasks.available, false);
assert.equal(r.categories.kpis.available, false);
// Nothing measurable at all, nothing planned or reviewed => planning is available at 0, so total 0 (a real zero: nothing was planned)
r = computeScore(base);
assert.equal(r.total, 0);
// Zero weight on the only available category => null (nothing measurable)
r = computeScore(base, { tasks: 50, hours: 50, kpis: 0, habits: 0, planning: 0 });
assert.equal(r.total, null);
// Half tasks done, everything else unavailable except planning (planned only)
r = computeScore({ ...base, tasksPlanned: 4, tasksCompleted: 2, dayPlanned: true });
// tasks 40*0.5=20 of 40; planning 10*0.5=5 of 10 => 25/50 = 50
assert.equal(r.total, 50);
// Overtime earns no bonus
r = computeScore({ ...base, plannedMinutes: 100, actualMinutes: 400 });
assert.equal(r.categories.hours.ratio, 1);
// KPI over target is capped; lower ratios average
r = computeScore({ ...base, kpiRatios: [2, 0.5] });
assert.equal(r.categories.kpis.ratio, 0.75);
// Rescheduled and cancelled are recorded, not scored
r = computeScore({ ...base, tasksPlanned: 2, tasksCompleted: 2, tasksRescheduled: 3, tasksCancelled: 5 });
assert.equal(r.rescheduled, 3); assert.equal(r.cancelled, 5);
assert.equal(r.categories.tasks.ratio, 1);
// Custom weights change the result transparently
const heavyTasks = { tasks: 80, hours: 5, kpis: 5, habits: 5, planning: 5 };
r = computeScore({ ...base, tasksPlanned: 1, tasksCompleted: 1, habitsExpected: 1, habitsDone: 0 }, heavyTasks);
// tasks 80 earned of 80, habits 0 of 5, planning 0 of 5 => 80/90
assert.equal(r.total, 88.9);
// Weight validation
assert.equal(validateWeights(DEFAULT_WEIGHTS), null);
assert.ok(validateWeights({ ...DEFAULT_WEIGHTS, tasks: 50 }));
assert.ok(validateWeights({ ...DEFAULT_WEIGHTS, tasks: -10, hours: 70 }));
console.log("score tests passed");
