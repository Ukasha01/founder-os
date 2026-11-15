// Timezone-aware date helpers. Dates are "YYYY-MM-DD" strings in the user's timezone;
// instants are stored in UTC. No dependencies, so behaviour is easy to test.

function offsetMs(utcMs: number, tz: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(utcMs / 1000) * 1000;
}

/** "2026-11-15T14:30" typed in timezone tz -> the matching UTC instant. */
export function zonedToUtc(local: string, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new Error("Invalid date/time");
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let result = guess - offsetMs(guess, tz);
  result = guess - offsetMs(result, tz); // second pass handles offsets that change near DST
  return new Date(result);
}

export function dateInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
}

export function timeInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Weekday of a date string: 0 = Sunday. */
export function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** First day of the week containing `date`; weekStartsOn: 0 = Sunday, 1 = Monday. */
export function startOfWeek(date: string, weekStartsOn: number): string {
  return addDays(date, -((weekday(date) - weekStartsOn + 7) % 7));
}

export function startOfMonth(date: string): string {
  return date.slice(0, 8) + "01";
}

export function addMonths(date: string, n: number): string {
  const [y, m] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 10);
}

/** UTC range [start, end) covering local days from..to inclusive. */
export function rangeUtc(from: string, toInclusive: string, tz: string): { start: Date; end: Date } {
  return { start: zonedToUtc(`${from}T00:00`, tz), end: zonedToUtc(`${addDays(toInclusive, 1)}T00:00`, tz) };
}

export const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export const isDateString = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
