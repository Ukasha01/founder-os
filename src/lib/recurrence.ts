import { addDays, startOfWeek, weekday } from "./time.ts";

export type Rule = {
  freq: "daily" | "weekly" | "monthly";
  interval_count: number;
  by_weekday: number[] | null;     // 0=Sun..6=Sat
  by_monthday: number[] | null;    // 1..31 (clamped to the month's last day)
  times_of_day: string[] | null;   // "HH:MM"; several occurrences per day
  start_date: string;
  end_date: string | null;
  is_paused: boolean;
};
export type Occurrence = { date: string; index: number; time: string | null };
export type Exception = { occurrence_date: string; occurrence_index: number; kind: "skipped" | "rescheduled" };

const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
function lastDayOfMonth(y: number, m: number) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

// Occurrences of a rule with date in [from, to]. Pure: the caller decides what to do about exceptions and existing rows.
// weekly with no weekdays chosen repeats on the start date's weekday. Weeks start on Monday for the interval count.
// monthly with no days chosen repeats on the start date's day-of-month; days past month end clamp to the last day.
export function occurrences(r: Rule, from: string, to: string): Occurrence[] {
  if (r.is_paused) return [];
  const out: Occurrence[] = [];
  const times: (string | null)[] = r.times_of_day?.length ? [...r.times_of_day].sort() : [null];
  const first = from < r.start_date ? r.start_date : from;
  const last = r.end_date && r.end_date < to ? r.end_date : to;
  const n = Math.max(1, r.interval_count);
  const startWeek = startOfWeek(r.start_date, 1);
  for (let d = first, guard = 0; d <= last && guard < 3700; d = addDays(d, 1), guard++) {
    let hit = false;
    if (r.freq === "daily") hit = dayDiff(r.start_date, d) % n === 0;
    else if (r.freq === "weekly") {
      const days = r.by_weekday?.length ? r.by_weekday : [weekday(r.start_date)];
      hit = days.includes(weekday(d)) && (dayDiff(startWeek, startOfWeek(d, 1)) / 7) % n === 0;
    } else {
      const [y, m, dd] = d.split("-").map(Number);
      const [sy, sm, sd] = r.start_date.split("-").map(Number);
      const monthsApart = (y - sy) * 12 + (m - sm);
      const days = r.by_monthday?.length ? r.by_monthday : [sd];
      hit = monthsApart >= 0 && monthsApart % n === 0 && days.some((x) => Math.min(x, lastDayOfMonth(y, m)) === dd);
    }
    if (hit) times.forEach((t, i) => out.push({ date: d, index: i, time: t }));
  }
  return out;
}

// Drop occurrences the user skipped or individually rescheduled away.
export function withoutExceptions(list: Occurrence[], ex: Exception[]): Occurrence[] {
  const blocked = new Set(ex.map((e) => `${e.occurrence_date}#${e.occurrence_index}`));
  return list.filter((o) => !blocked.has(`${o.date}#${o.index}`));
}
