import Link from "next/link";
import { NewPanel } from "@/components/new-panel";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaces } from "@/lib/data";
import { addDays, addMonths, dateInTz, isDateString, rangeUtc, startOfMonth, startOfWeek, timeInTz, weekday, WEEKDAY_KEYS } from "@/lib/time";
import { formatMinutes, input, btn, card } from "@/lib/ui";
import { createEvent, deleteEvent, saveCapacity } from "./actions";
import { SubmitButton } from "@/components/submit-button";

type View = "day" | "week" | "month" | "agenda";
type Item = { key: string; date: string; time: string; title: string; kind: "event" | "deadline"; href?: string; eventId?: string; minutes: number; fixed: boolean; type: string };

const TYPE_LABEL: Record<string, string> = { meeting: "Meeting", class: "Class", appointment: "Appointment", time_block: "Time block", other: "Other", deadline: "Deadline", recurring_activity: "Recurring" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string; error?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: settings } = await supabase.from("user_settings").select("timezone, week_starts_on, daily_capacity_minutes").maybeSingle();
  const tz = settings?.timezone ?? "Asia/Karachi";
  const wso = settings?.week_starts_on ?? 1;
  const capacity = (settings?.daily_capacity_minutes ?? {}) as Record<string, number>;
  const today = dateInTz(new Date(), tz);
  const view: View = (["day", "week", "month", "agenda"] as const).find((v) => v === sp.view) ?? "week";
  const date = isDateString(sp.date) ? sp.date : today;

  // Visible range in local dates
  let from: string, to: string, prev: string, next: string;
  if (view === "day") { from = to = date; prev = addDays(date, -1); next = addDays(date, 1); }
  else if (view === "week") { from = startOfWeek(date, wso); to = addDays(from, 6); prev = addDays(date, -7); next = addDays(date, 7); }
  else if (view === "month") { const m = startOfMonth(date); from = startOfWeek(m, wso); to = addDays(startOfWeek(addMonths(m, 1), wso), -1); prev = addMonths(m, -1); next = addMonths(m, 1); }
  else { from = date; to = addDays(date, 29); prev = addDays(date, -30); next = addDays(date, 30); }
  const { start, end } = rangeUtc(from, to, tz);

  const [{ data: events }, { data: deadlines }, { data: workspaces }] = await Promise.all([
    supabase.from("calendar_events").select("id, title, event_type, start_at, end_at, is_fixed, all_day, meeting_id")
      .is("deleted_at", null).neq("status", "cancelled").gte("start_at", start.toISOString()).lt("start_at", end.toISOString()).order("start_at"),
    supabase.from("task_overview").select("id, title, current_deadline, estimated_minutes")
      .in("status", ["not_started", "in_progress", "waiting"]).gte("current_deadline", from).lte("current_deadline", to),
    getWorkspaces().then((data) => ({ data })),
  ]);

  const items: Item[] = [];
  for (const e of events ?? []) {
    const s = new Date(e.start_at);
    const minutes = e.end_at ? Math.max(0, Math.round((new Date(e.end_at).getTime() - s.getTime()) / 60000)) : 0;
    items.push({ key: `e${e.id}`, date: dateInTz(s, tz), time: e.all_day ? "All day" : timeInTz(s, tz), title: e.title, kind: "event",
      eventId: e.meeting_id ? undefined : e.id, minutes, fixed: e.is_fixed, type: e.event_type });
  }
  for (const t of deadlines ?? []) {
    items.push({ key: `t${t.id}`, date: t.current_deadline!, time: "Due", title: t.title, kind: "deadline", href: `/tasks/${t.id}`,
      minutes: t.estimated_minutes ?? 0, fixed: false, type: "deadline" });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const byDate = new Map<string, Item[]>();
  for (const i of items) byDate.set(i.date, [...(byDate.get(i.date) ?? []), i]);

  // Planned flexible work (time blocks + estimates of tasks due that day) vs the hours you said are available.
  const warning = (d: string): string | null => {
    const cap = capacity[WEEKDAY_KEYS[weekday(d)]];
    if (cap === undefined) return null;
    const planned = (byDate.get(d) ?? []).filter((i) => !i.fixed && (i.type === "time_block" || i.kind === "deadline")).reduce((n, i) => n + i.minutes, 0);
    return planned > cap ? `Planned ${formatMinutes(planned)} but only ${formatMinutes(cap)} available` : null;
  };

  const base = (v: string, d: string) => `/calendar?view=${v}&date=${d}`;
  const here = base(view, date);
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const fmtDay = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));
  const title = view === "month" ? new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(startOfMonth(date) + "T00:00:00Z")) : view === "day" ? fmtDay(date) : `${fmtDay(from)} – ${fmtDay(to)}`;

  const DayList = ({ d }: { d: string }) => (
    <ul className="text-sm">
      {(byDate.get(d) ?? []).map((i) => (
        <li key={i.key} className="flex flex-wrap items-baseline gap-2 py-0.5">
          <span className="w-14 shrink-0 text-xs text-neutral-500">{i.time}</span>
          {i.href ? <Link href={i.href} className="text-amber-800 hover:underline">{i.title}</Link> : <span>{i.title}</span>}
          <span className="text-xs text-neutral-400">{TYPE_LABEL[i.type] ?? i.type}{i.fixed ? " · fixed" : ""}{i.minutes ? ` · ${formatMinutes(i.minutes)}` : ""}</span>
          {i.eventId && (
            <form action={deleteEvent} className="ml-auto flex items-center gap-1">
              <input type="hidden" name="id" value={i.eventId} /><input type="hidden" name="return_to" value={here} />
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="confirm" value="yes" />Confirm</label>
              <button className="text-xs underline">Delete</button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="max-w-4xl">
      <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">Calendar</h1>
      {sp.error && <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{sp.error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {(["day", "week", "month", "agenda"] as const).map((v) => (
          <Link key={v} href={base(v, date)} className={`rounded-full border px-3 py-1 capitalize ${v === view ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"}`}>{v}</Link>
        ))}
        <span className="mx-2 font-medium">{title}</span>
        <Link href={base(view, prev)} className={btn} aria-label="Previous">‹</Link>
        <Link href={base(view, today)} className={btn}>Today</Link>
        <Link href={base(view, next)} className={btn} aria-label="Next">›</Link>
      </div>
      <p className="mt-1 text-xs text-neutral-500">Task deadlines are shown in amber. Times are in {tz}.</p>

      <div className="mt-4">
        {view === "month" ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
            {days.map((d) => {
              const list = byDate.get(d) ?? [];
              const w = warning(d);
              return (
                <Link key={d} href={base("day", d)} className={`min-h-20 rounded-md border p-2 text-xs ${d === today ? "border-neutral-900" : "border-neutral-200"} ${d.slice(0, 7) !== date.slice(0, 7) ? "opacity-50" : ""}`}>
                  <span className="font-medium">{fmtDay(d)}</span>
                  {w && <span className="block text-red-700">Overloaded</span>}
                  {list.slice(0, 3).map((i) => <span key={i.key} className="block truncate text-neutral-600">{i.title}</span>)}
                  {list.length > 3 && <span className="text-neutral-400">+{list.length - 3} more</span>}
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {days.filter((d) => view !== "agenda" || (byDate.get(d)?.length ?? 0) > 0).map((d) => {
              const w = warning(d);
              return (
                <section key={d} className={`${card} ${d === today ? "border-neutral-900" : ""}`}>
                  <h2 className="text-sm font-medium">{fmtDay(d)}</h2>
                  {w && <p role="status" className="text-xs text-red-700">{w}</p>}
                  {(byDate.get(d)?.length ?? 0) === 0 ? <p className="text-sm text-neutral-400">Nothing scheduled.</p> : <DayList d={d} />}
                </section>
              );
            })}
            {view === "agenda" && items.length === 0 && <p className="text-neutral-500">Nothing in the next 30 days.</p>}
          </div>
        )}
      </div>

      <NewPanel label="Add event">
      <form action={createEvent} className={`${card} grid gap-2 sm:grid-cols-2`}>
        <input type="hidden" name="client_request_id" value={crypto.randomUUID()} />
        <input type="hidden" name="return_to" value={here} />
        <label className="flex flex-col gap-1 text-xs sm:col-span-2">Title<input name="title" required maxLength={300} className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Type
          <select name="event_type" defaultValue="time_block" className={input}>
            <option value="time_block">Time block</option><option value="meeting">Meeting</option><option value="class">Class</option>
            <option value="appointment">Appointment</option><option value="other">Other</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">Workspace
          <select name="workspace_id" defaultValue="" className={input}>
            <option value="">None</option>{workspaces?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">Start<input type="datetime-local" name="start" required defaultValue={`${date}T09:00`} className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">End<input type="datetime-local" name="end" className={input} /></label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="is_fixed" /> Fixed commitment (university, prayers, sleep)</label>
        <div><SubmitButton variant="primary">Add</SubmitButton></div>
      </form>
      </NewPanel>

      <form action={saveCapacity} className={`${card} mt-4`}>
        <input type="hidden" name="return_to" value={here} />
        <h2 className="font-medium">Available working hours per day</h2>
        <p className="text-xs text-neutral-500">Leave blank to skip warnings for that day. Warnings count time blocks and the estimates of tasks due that day.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {WEEKDAY_KEYS.map((k) => (
            <label key={k} className="flex flex-col gap-1 text-xs capitalize">{k}
              <input type="number" name={k} min={0} max={24} step="0.5" defaultValue={capacity[k] !== undefined ? capacity[k] / 60 : ""} className={`${input} w-20`} />
            </label>
          ))}
          <button className={`${btn} self-end`}>Save</button>
        </div>
      </form>
    </div>
  );
}
