import { addDays, startOfWeek, weekday } from "./time.ts";

export type Frequency = "daily" | "weekdays" | "weekly_target";
export type HabitDef = { frequency_type: Frequency; weekdays: number[] | null; weekly_target: number | null; start_date: string };
export type EntryStatus = "done" | "partial" | "skipped";
export type Entries = Map<string, EntryStatus>; // date -> status; no entry = not logged

export const PRESETS: { value: string; label: string }[] = [
  { value: "namaz", label: "Namaz" }, { value: "quran", label: "Quran" }, { value: "exercise", label: "Exercise" },
  { value: "reading", label: "Reading" }, { value: "learning", label: "Learning" }, { value: "sleep", label: "Sleep" },
];

// Is the habit expected on this date? (weekly_target habits can be done on any day.)
export function isScheduled(h: HabitDef, date: string): boolean {
  if (date < h.start_date) return false;
  if (h.frequency_type === "weekdays") return (h.weekdays ?? []).includes(weekday(date));
  return true;
}

// Streak of consecutive scheduled days completed ("done"), ending today or yesterday.
// Skipped days are excused: they neither add to nor break a streak. A partial day breaks it.
// Today being unlogged does not break the streak (the day is not over). Past unlogged days do.
// For weekly_target habits the streak counts consecutive weeks that met the target (current week excused until it is met).
export function currentStreak(h: HabitDef, entries: Entries, today: string): number {
  if (h.frequency_type === "weekly_target") return weeklyStreak(h, entries, today, 1);
  let streak = 0;
  for (let d = today, guard = 0; guard < 3660 && d >= h.start_date; d = addDays(d, -1), guard++) {
    if (!isScheduled(h, d)) continue;
    const s = entries.get(d);
    if (s === "skipped") continue;
    if (s === "done") { streak++; continue; }
    if (d === today && s === undefined) continue;
    break;
  }
  return streak;
}

function weeklyStreak(h: HabitDef, entries: Entries, today: string, weekStartsOn: number): number {
  const target = h.weekly_target ?? 1;
  let streak = 0;
  let ws = startOfWeek(today, weekStartsOn);
  const currentWeek = ws;
  for (let guard = 0; guard < 520 && addDays(ws, 6) >= h.start_date; guard++, ws = addDays(ws, -7)) {
    let done = 0;
    for (let i = 0; i < 7; i++) if (entries.get(addDays(ws, i)) === "done") done++;
    if (done >= target) streak++;
    else if (ws !== currentWeek) break;
  }
  return streak;
}

// Share of expected completions achieved in [from, to] (inclusive), capped at today. Skipped days are excluded.
// Returns null when nothing was expected (no data is not 0%).
export function consistency(h: HabitDef, entries: Entries, from: string, to: string, today: string): number | null {
  const end = to > today ? today : to;
  if (h.frequency_type === "weekly_target") {
    const target = h.weekly_target ?? 1;
    let expected = 0, done = 0;
    for (let d = from < h.start_date ? h.start_date : from; d <= end; d = addDays(d, 1)) {
      const s = entries.get(d);
      if (s === "done") done++;
    }
    const weeks = (Date.parse(end) - Date.parse(from < h.start_date ? h.start_date : from)) / 86400000 / 7 + 1 / 7;
    expected = Math.max(target * Math.max(weeks, 0), 0);
    if (expected <= 0) return null;
    return Math.min(100, Math.round((done / expected) * 100));
  }
  let expected = 0, done = 0;
  for (let d = from; d <= end; d = addDays(d, 1)) {
    if (!isScheduled(h, d)) continue;
    const s = entries.get(d);
    if (s === "skipped") continue;
    expected++;
    if (s === "done") done++;
    else if (s === "partial") done += 0.5;
  }
  return expected === 0 ? null : Math.round((done / expected) * 100);
}
