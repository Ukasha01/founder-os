import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { addDays, addMonths, dateInTz, isDateString, rangeUtc, startOfMonth, startOfWeek, timeInTz } from "@/lib/time";
import { btn } from "@/lib/ui";
import { googleClient } from "@/lib/gcal-server";
import { daySegments, normalizeEvent } from "@/lib/gcal-view";
import { CalView, type CalEvent, type Extra } from "./cal-view";

type View = "day" | "week" | "month" | "agenda";

// Your Founder OS Google calendar, live: what you see here is what is in Google, and what you change here changes in Google.
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: settings } = await supabase.from("user_settings").select("timezone, week_starts_on").maybeSingle();
  const tz = settings?.timezone ?? "Asia/Karachi";
  const wso = settings?.week_starts_on ?? 1;
  const now = new Date();
  const today = dateInTz(now, tz);
  const nowMin = Number(timeInTz(now, tz).slice(0, 2)) * 60 + Number(timeInTz(now, tz).slice(3, 5));
  const view: View = (["day", "week", "month", "agenda"] as const).find((v) => v === sp.view) ?? "week";
  const date = isDateString(sp.date) ? sp.date : today;

  let from: string, to: string, prev: string, next: string;
  if (view === "day") { from = to = date; prev = addDays(date, -1); next = addDays(date, 1); }
  else if (view === "week") { from = startOfWeek(date, wso); to = addDays(from, 6); prev = addDays(date, -7); next = addDays(date, 7); }
  else if (view === "month") { const m = startOfMonth(date); from = startOfWeek(m, wso); to = addDays(startOfWeek(addMonths(m, 1), wso), -1); prev = addMonths(m, -1); next = addMonths(m, 1); }
  else { from = date; to = addDays(date, 29); prev = addDays(date, -30); next = addDays(date, 30); }
  const { start, end } = rangeUtc(from, to, tz);

  // Google is the source for the calendar itself. Tasks with a due date but no time, and older in-app events, are shown beside it (read-only).
  const g = googleClient();
  let googleError: string | null = g.ok ? null : g.reason;
  const events: CalEvent[] = [];
  const [gl, { data: legacy }, { data: deadlines }] = await Promise.all([
    g.ok ? g.client.list(addDays(from, -1) + "T00:00:00Z", addDays(to, 2) + "T00:00:00Z") : Promise.resolve(null),
    supabase.from("calendar_events").select("id, title, start_at, all_day").is("deleted_at", null).neq("status", "cancelled").gte("start_at", start.toISOString()).lt("start_at", end.toISOString()).order("start_at").limit(200),
    supabase.from("task_overview").select("id, title, current_deadline").in("status", ["not_started", "in_progress", "waiting"]).is("due_time", null).gte("current_deadline", from).lte("current_deadline", to).limit(200),
  ]);
  if (gl && !gl.ok) googleError = gl.message;
  if (gl?.ok) for (const raw of gl.items) {
    const ev = normalizeEvent(raw, tz);
    if (!ev) continue;
    const segs = daySegments(ev, from, to);
    if (segs.length) events.push({ ...ev, segs });
  }
  const extras: Extra[] = [
    ...(legacy ?? []).map((e) => ({ key: `e${e.id}`, date: dateInTz(new Date(e.start_at), tz), time: e.all_day ? "All day" : timeInTz(new Date(e.start_at), tz), title: e.title })),
    ...(deadlines ?? []).map((t) => ({ key: `t${t.id}`, date: t.current_deadline as string, time: "Due", title: t.title as string, href: `/tasks/${t.id}` })),
  ];

  const base = (v: string, d: string) => `/calendar?view=${v}&date=${d}`;
  const fmtDay = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));
  const title = view === "month" ? new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(startOfMonth(date) + "T00:00:00Z")) : view === "day" ? fmtDay(date) : `${fmtDay(from)} – ${fmtDay(to)}`;

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">Calendar</h1>
        <p className="text-xs text-neutral-500">{g.ok && !googleError ? `Live from Google Calendar · ${tz}` : `Times in ${tz}`}</p>
      </div>
      {googleError && <p role="alert" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Google Calendar is not available right now: {googleError} Showing only items stored in Founder OS.</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <div className="flex gap-1 rounded-full bg-tint p-1">
          {(["day", "week", "month", "agenda"] as const).map((v) => (
            <Link key={v} href={base(v, date)} className={`rounded-full px-3 py-1 capitalize transition ${v === view ? "bg-surface font-semibold shadow-card" : "text-neutral-600 hover:text-ink"}`}>{v}</Link>
          ))}
        </div>
        <Link href={base(view, prev)} className={btn} aria-label="Previous">‹</Link>
        <Link href={base(view, today)} className={btn}>Today</Link>
        <Link href={base(view, next)} className={btn} aria-label="Next">›</Link>
        <span className="font-semibold">{title}</span>
      </div>

      <div className="mt-4">
        <CalView view={view} date={date} today={today} from={from} to={to} nowMin={nowMin} events={events} extras={extras} googleOn={g.ok && !googleError} />
      </div>
      <p className="mt-3 text-xs text-neutral-500">Blue: events. Amber: Founder OS reminders. Violet: tasks with a due time. Grey rows: tasks due that day and older in-app events.</p>
    </div>
  );
}
