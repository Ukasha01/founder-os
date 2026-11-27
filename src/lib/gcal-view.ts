import { addDays, dateInTz, timeInTz } from "./time.ts";

// Pure helpers for showing and editing the Google calendar inside the app (no server-only imports, so the screen can use them too).

export type RawEvent = {
  id?: string; status?: string; summary?: string; description?: string;
  start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string };
  reminders?: { useDefault?: boolean; overrides?: { method: string; minutes: number }[] };
  extendedProperties?: { private?: Record<string, string> };
};
// One calendar entry as the app shows it. Dates and times are wall-clock values in the user's timezone.
export type GEvent = {
  id: string; title: string; description: string; allDay: boolean;
  startDate: string; endDate: string;          // local dates, end inclusive
  startMin: number; endMin: number;            // minutes after local midnight (timed events)
  startLocal: string; endLocal: string;        // YYYY-MM-DDTHH:mm, for editing
  source: "reminder" | "task" | null; sourceId: string | null; popups: number[];
};
const hm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export function normalizeEvent(raw: RawEvent, tz: string): GEvent | null {
  if (!raw.id || raw.status === "cancelled" || !raw.start || !raw.end) return null;
  const priv = raw.extendedProperties?.private ?? {};
  const source: GEvent["source"] = priv.fosSource === "reminder" ? "reminder" : priv.fosSource === "task" ? "task" : null;
  const base = { id: raw.id, title: (raw.summary ?? "").trim() || "(no title)", description: raw.description ?? "", source, sourceId: source ? (priv.fosId ?? null) : null,
    popups: (raw.reminders?.overrides ?? []).filter((o) => o.method === "popup").map((o) => o.minutes) };
  if (raw.start.date) {
    const endIncl = raw.end.date ? addDays(raw.end.date, -1) : raw.start.date;
    return { ...base, allDay: true, startDate: raw.start.date, endDate: endIncl < raw.start.date ? raw.start.date : endIncl, startMin: 0, endMin: 1440, startLocal: `${raw.start.date}T00:00`, endLocal: `${raw.start.date}T00:00` };
  }
  if (!raw.start.dateTime || !raw.end.dateTime) return null;
  const s = new Date(raw.start.dateTime), e = new Date(raw.end.dateTime);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  const sd = dateInTz(s, tz), st = timeInTz(s, tz), ed = dateInTz(e, tz), et = timeInTz(e, tz);
  return { ...base, allDay: false, startDate: sd, endDate: ed, startMin: hm(st), endMin: hm(et), startLocal: `${sd}T${st}`, endLocal: `${ed}T${et}` };
}

export type DaySegment = { date: string; allDay: boolean; startMin: number; endMin: number };
// The pieces of an event that fall on each day, so a late-night event shows on both days.
export function daySegments(e: GEvent, from: string, to: string): DaySegment[] {
  const out: DaySegment[] = [];
  for (let d = e.startDate; d <= e.endDate && out.length < 400; d = addDays(d, 1)) {
    if (d < from || d > to) continue;
    if (e.allDay) { out.push({ date: d, allDay: true, startMin: 0, endMin: 1440 }); continue; }
    const startMin = d === e.startDate ? e.startMin : 0;
    let endMin = d === e.endDate ? e.endMin : 1440;
    if (d === e.endDate && d !== e.startDate && endMin === 0) continue;   // ends exactly at midnight: nothing on the last day
    if (endMin <= startMin) endMin = Math.min(1440, startMin + 30);       // zero-length events get a visible block
    out.push({ date: d, allDay: false, startMin, endMin });
  }
  return out;
}

export type UserEventInput = { title: string; notes: string; allDay: boolean; startLocal: string; endLocal: string; tz: string };
// The Google body for an event made or edited in the app. Timed events alert 10 minutes before and on time.
export function buildUserEvent(i: UserEventInput) {
  const common = { summary: i.title, description: i.notes, extendedProperties: { private: { fosOrigin: "app" } } };
  if (i.allDay) {
    const sd = i.startLocal.slice(0, 10), ed = (i.endLocal || i.startLocal).slice(0, 10);
    return { ...common, start: { date: sd }, end: { date: addDays(ed < sd ? sd : ed, 1) }, reminders: { useDefault: false, overrides: [] } };
  }
  return { ...common, start: { dateTime: `${i.startLocal}:00`, timeZone: i.tz }, end: { dateTime: `${i.endLocal}:00`, timeZone: i.tz },
    reminders: { useDefault: false, overrides: [10, 0].map((minutes) => ({ method: "popup", minutes })) } };
}
