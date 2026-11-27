import { addDays, dateInTz, zonedToUtc } from "./time.ts";

export type DailyRule = { id: string; title: string; at_time: string; weekdays: number[] | null };
export type Occurrence = { key: string; title: string; at: Date; date: string };

// The reminders a repeating rule owes right now: today's and tomorrow's occurrence, skipping any that are already more than
// five minutes in the past (a missed run is not replayed hours later). Keys are stable, so planning twice creates nothing new.
export function dailyOccurrences(rules: DailyRule[], now: Date, tz: string, graceMs = 5 * 60_000): Occurrence[] {
  const today = dateInTz(now, tz);
  const out: Occurrence[] = [];
  for (const r of rules) {
    for (const date of [today, addDays(today, 1)]) {
      const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (r.weekdays && r.weekdays.length && !r.weekdays.includes(wd)) continue;
      const at = zonedToUtc(`${date}T${r.at_time.slice(0, 5)}`, tz);
      if (Number.isNaN(at.getTime()) || at.getTime() < now.getTime() - graceMs) continue;
      out.push({ key: `custom:daily:${r.id}:${date}`, title: r.title, at, date });
    }
  }
  return out;
}
