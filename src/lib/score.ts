// Daily performance score. Pure and transparent: every category reports its weight, whether it had data,
// the ratio achieved and the points, so the UI can show exactly why the number is what it is.
//
// Rules (from the spec):
//  * Cancelled tasks are excluded. Rescheduled tasks are counted separately and are neither success nor failure.
//  * Missing data is not zero: a category with nothing to measure is "not available" and its weight is
//    redistributed across the available categories (total = earned / available weight * 100).
//  * Working more hours than planned earns no extra credit (ratio is capped at 1).

export type Weights = { tasks: number; hours: number; kpis: number; habits: number; planning: number };
export const DEFAULT_WEIGHTS: Weights = { tasks: 40, hours: 20, kpis: 15, habits: 15, planning: 10 };
export type Category = keyof Weights;

export type ScoreInput = {
  tasksPlanned: number;        // non-cancelled tasks planned for the day (due that day), excluding ones moved away
  tasksCompleted: number;      // of those, completed
  tasksRescheduled: number;    // moved to another day: recorded only
  tasksCancelled: number;      // excluded
  plannedMinutes: number;      // sum of estimates of planned tasks
  actualMinutes: number;       // time logged that day
  kpiRatios: number[];         // per KPI with data and a target: actual/target (already direction-adjusted), may exceed 1
  habitsExpected: number;      // habits scheduled that day, excluding skipped
  habitsDone: number;          // done counts 1, partial counts 0.5
  dayPlanned: boolean;
  reviewDone: boolean;
};

export type CategoryResult = {
  weight: number;
  available: boolean;
  ratio: number | null;        // 0..1
  points: number;              // weight * ratio (0 if unavailable)
  explanation: string;
};
export type ScoreResult = {
  total: number | null;        // null when nothing could be measured
  categories: Record<Category, CategoryResult>;
  rescheduled: number;
  cancelled: number;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

export function validateWeights(w: Weights): string | null {
  const vals = Object.values(w);
  if (vals.some((v) => !Number.isFinite(v) || v < 0)) return "Weights must be zero or more.";
  if (Math.round(vals.reduce((a, b) => a + b, 0) * 1000) / 1000 !== 100) return "Weights must add up to 100.";
  return null;
}

export function computeScore(i: ScoreInput, w: Weights = DEFAULT_WEIGHTS): ScoreResult {
  const mk = (weight: number, ratio: number | null, explanation: string): CategoryResult => ({
    weight, available: ratio !== null, ratio: ratio === null ? null : round1(ratio * 1000) / 1000,
    points: ratio === null ? 0 : round1(weight * ratio), explanation,
  });
  const tasks = i.tasksPlanned > 0
    ? mk(w.tasks, clamp01(i.tasksCompleted / i.tasksPlanned), `${i.tasksCompleted} of ${i.tasksPlanned} planned tasks completed`)
    : mk(w.tasks, null, "No tasks were planned, so this is not counted");
  const hours = i.plannedMinutes > 0
    ? mk(w.hours, clamp01(i.actualMinutes / i.plannedMinutes), `${i.actualMinutes} of ${i.plannedMinutes} planned minutes worked (extra time earns no bonus)`)
    : mk(w.hours, null, "No planned time (add estimates to tasks), so this is not counted");
  const kpis = i.kpiRatios.length > 0
    ? mk(w.kpis, clamp01(i.kpiRatios.reduce((a, b) => a + clamp01(b), 0) / i.kpiRatios.length), `${i.kpiRatios.length} KPI(s) with data and a target`)
    : mk(w.kpis, null, "No KPI data with a target, so this is not counted (missing data is not zero)");
  const habits = i.habitsExpected > 0
    ? mk(w.habits, clamp01(i.habitsDone / i.habitsExpected), `${i.habitsDone} of ${i.habitsExpected} habits done (partial counts half; skipped excluded)`)
    : mk(w.habits, null, "No habits scheduled, so this is not counted");
  const planning = mk(w.planning, (i.dayPlanned ? 0.5 : 0) + (i.reviewDone ? 0.5 : 0),
    `${i.dayPlanned ? "Day planned" : "Day not planned"}, ${i.reviewDone ? "review completed" : "review not completed"}`);

  const categories = { tasks, hours, kpis, habits, planning };
  const avail = Object.values(categories).filter((c) => c.available && c.weight > 0);
  const availWeight = avail.reduce((a, c) => a + c.weight, 0);
  const earned = avail.reduce((a, c) => a + c.points, 0);
  return {
    total: availWeight > 0 ? round1((earned / availWeight) * 100) : null,
    categories, rescheduled: i.tasksRescheduled, cancelled: i.tasksCancelled,
  };
}
