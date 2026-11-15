import type { SupabaseClient } from "@supabase/supabase-js";
import { computeScore, DEFAULT_WEIGHTS, type ScoreInput, type ScoreResult, type Weights } from "./score";
import { isScheduled, type EntryStatus, type Frequency } from "./habits";

export type DayData = { input: ScoreInput; result: ScoreResult; weights: Weights; review: { plan_completed_at: string | null; review_completed_at: string | null; wins: string | null; blockers: string | null; tomorrow_plan: string | null } | null };

// Gathers the measured facts for one local date and scores them. Read-only.
export async function loadDay(supabase: SupabaseClient, date: string): Promise<DayData> {
  const [{ data: st }, { data: tasks }, { data: time }, { data: kpis }, { data: habits }, { data: rev }] = await Promise.all([
    supabase.from("user_settings").select("scoring_weights").maybeSingle(),
    supabase.from("tasks").select("status, current_deadline, original_deadline, estimated_minutes").is("deleted_at", null)
      .or(`current_deadline.eq.${date},original_deadline.eq.${date}`).limit(1000),
    supabase.from("time_entries").select("duration_minutes").eq("entry_date", date).limit(1000),
    supabase.from("kpi_definitions").select("id, target_value, direction").is("archived_at", null).not("target_value", "is", null),
    supabase.from("habits").select("id, frequency_type, weekdays, weekly_target, start_date").is("archived_at", null),
    supabase.from("daily_reviews").select("plan_completed_at, review_completed_at, wins, blockers, tomorrow_plan").eq("review_date", date).maybeSingle(),
  ]);
  const weights = (st?.scoring_weights as Weights | undefined) ?? DEFAULT_WEIGHTS;

  const dueToday = (tasks ?? []).filter((t) => t.current_deadline === date);
  const movedAway = (tasks ?? []).filter((t) => t.original_deadline === date && t.current_deadline !== date && t.status !== "cancelled");
  const cancelled = dueToday.filter((t) => t.status === "cancelled").length;
  const planned = dueToday.filter((t) => t.status !== "cancelled");

  const kIds = (kpis ?? []).map((k) => k.id);
  const [{ data: kEntries }, { data: hEntries }] = await Promise.all([
    kIds.length ? supabase.from("kpi_entries").select("kpi_id, actual_value, period_start, period_end").in("kpi_id", kIds).lte("period_start", date).gte("period_end", date) : Promise.resolve({ data: [] as { kpi_id: string; actual_value: number }[] }),
    (habits ?? []).length ? supabase.from("habit_entries").select("habit_id, status").eq("entry_date", date) : Promise.resolve({ data: [] as { habit_id: string; status: EntryStatus }[] }),
  ]);
  const kpiRatios: number[] = [];
  for (const k of kpis ?? []) {
    const e = (kEntries ?? []).find((x) => x.kpi_id === k.id);
    if (!e) continue;
    const target = Number(k.target_value), actual = Number(e.actual_value);
    if (!target) continue;
    kpiRatios.push(k.direction === "lower_is_better" ? (actual > 0 ? target / actual : 1) : actual / target);
  }
  let habitsExpected = 0, habitsDone = 0;
  const hMap = new Map((hEntries ?? []).map((e) => [e.habit_id, e.status as EntryStatus]));
  for (const h of habits ?? []) {
    const d = { frequency_type: h.frequency_type as Frequency, weekdays: h.weekdays, weekly_target: h.weekly_target, start_date: h.start_date };
    const s = hMap.get(h.id);
    if (h.frequency_type === "weekly_target" ? s === undefined : !isScheduled(d, date)) continue; // weekly-target habits only count on days they were logged
    if (s === "skipped") continue;
    habitsExpected++;
    if (s === "done") habitsDone++; else if (s === "partial") habitsDone += 0.5;
  }
  const input: ScoreInput = {
    tasksPlanned: planned.length, tasksCompleted: planned.filter((t) => t.status === "completed").length,
    tasksRescheduled: movedAway.length, tasksCancelled: cancelled,
    plannedMinutes: planned.reduce((n, t) => n + (t.estimated_minutes ?? 0), 0),
    actualMinutes: (time ?? []).reduce((n, e) => n + (e.duration_minutes ?? 0), 0),
    kpiRatios, habitsExpected, habitsDone,
    dayPlanned: !!rev?.plan_completed_at, reviewDone: !!rev?.review_completed_at,
  };
  return { input, result: computeScore(input, weights), weights, review: rev ?? null };
}
