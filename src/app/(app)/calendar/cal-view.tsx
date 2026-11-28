"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { GEvent, DaySegment } from "@/lib/gcal-view";
import { addDays } from "@/lib/time";
import { btn, btnPrimary, input } from "@/lib/ui";
import { deleteEvent, saveEvent } from "./gactions";

export type CalEvent = GEvent & { segs: DaySegment[] };
export type Extra = { key: string; date: string; time: string; title: string; href?: string };
type Props = { view: "day" | "week" | "month" | "agenda"; date: string; today: string; from: string; to: string; nowMin: number; events: CalEvent[]; extras: Extra[]; googleOn: boolean };
type Editing = { id?: string; title: string; notes: string; allDay: boolean; startLocal: string; endLocal: string; source: GEvent["source"]; sourceId: string | null } | null;

const H = 56;                                   // pixels per hour in the time grid
const pad = (n: number) => String(n).padStart(2, "0");
const mm = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
const dayName = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...o, timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));

const tone = (e: GEvent) => e.source === "reminder" ? "border-amber-300 bg-amber-100 text-amber-900" : e.source === "task" ? "border-ws-violet/40 bg-ws-violet-tint text-ws-violet-ink" : "border-ws-blue/40 bg-ws-blue-tint text-ws-blue-ink";
const label = (e: GEvent) => e.source === "reminder" ? "Reminder" : e.source === "task" ? "Task" : "Event";

// Side-by-side lanes for events that overlap in time.
function lanes(list: { ev: CalEvent; seg: DaySegment }[]) {
  const sorted = [...list].sort((a, b) => a.seg.startMin - b.seg.startMin || b.seg.endMin - a.seg.endMin);
  const out: { ev: CalEvent; seg: DaySegment; lane: number; of: number }[] = [];
  let group: typeof out = [], groupEnd = -1, laneEnds: number[] = [];
  const flush = () => { for (const g of group) g.of = laneEnds.length; out.push(...group); group = []; laneEnds = []; groupEnd = -1; };
  for (const it of sorted) {
    if (it.seg.startMin >= groupEnd && group.length) flush();
    let lane = laneEnds.findIndex((end) => end <= it.seg.startMin);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.seg.endMin); } else laneEnds[lane] = it.seg.endMin;
    group.push({ ...it, lane, of: 1 });
    groupEnd = Math.max(groupEnd, it.seg.endMin);
  }
  flush();
  return out;
}

export function CalView({ view, date, today, from, to, nowMin, events, extras, googleOn }: Props) {
  const router = useRouter();
  const [edit, setEdit] = useState<Editing>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const dlg = useRef<HTMLDialogElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const days = useMemo(() => { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }, [from, to]);
  const byDay = useMemo(() => {
    const m = new Map<string, { ev: CalEvent; seg: DaySegment }[]>();
    for (const ev of events) for (const seg of ev.segs) m.set(seg.date, [...(m.get(seg.date) ?? []), { ev, seg }]);
    return m;
  }, [events]);
  const extrasByDay = useMemo(() => { const m = new Map<string, Extra[]>(); for (const x of extras) m.set(x.date, [...(m.get(x.date) ?? []), x]); return m; }, [extras]);

  useEffect(() => { const d = dlg.current; if (!d) return; if (edit) { if (!d.open) d.showModal(); } else if (d.open) d.close(); }, [edit]);
  // Open the time grid on the working day: from 08:00 (or the first event, if earlier), and keep "now" in view late in the day.
  useEffect(() => {
    if (!scroller.current) return;
    const firstEvent = events.flatMap((e) => e.segs.filter((x) => !x.allDay).map((x) => x.startMin)).reduce((m, v) => Math.min(m, v), 8 * 60);
    let top = Math.max(0, firstEvent - 30);
    if (today >= from && today <= to && nowMin > top + 10 * 60) top = nowMin - 9 * 60;
    scroller.current.scrollTop = (top / 60) * H;
  }, [events, from, to, today, nowMin]);

  const openNew = (d: string, min = 9 * 60) => {
    const s = Math.min(min, 23 * 60);
    setError("");
    setEdit({ title: "", notes: "", allDay: false, startLocal: `${d}T${mm(s)}`, endLocal: s + 60 >= 1440 ? `${d}T23:59` : `${d}T${mm(s + 60)}`, source: null, sourceId: null });
  };
  const openEvent = (e: GEvent) => { setError(""); setEdit({ id: e.id, title: e.title, notes: e.description, allDay: e.allDay, startLocal: e.startLocal, endLocal: e.allDay ? `${e.endDate}T00:00` : e.endLocal, source: e.source, sourceId: e.sourceId }); };

  const save = (f: FormData) => {
    if (!edit) return;
    const allDay = f.get("allDay") === "on";
    const startLocal = allDay ? `${String(f.get("startDate"))}T00:00` : String(f.get("start"));
    const endLocal = allDay ? `${String(f.get("endDate") || f.get("startDate"))}T00:00` : String(f.get("end") || "");
    start(async () => {
      const r = await saveEvent({ id: edit.id, title: String(f.get("title") ?? ""), notes: String(f.get("notes") ?? ""), allDay, startLocal, endLocal });
      if (r.ok) { setEdit(null); router.refresh(); } else setError(r.error);
    });
  };
  const remove = () => {
    if (!edit?.id) return;
    if (!window.confirm("Delete this event? It is removed from Google Calendar too.")) return;
    start(async () => { const r = await deleteEvent(edit.id!); if (r.ok) { setEdit(null); router.refresh(); } else setError(r.error); });
  };

  const chip = (e: CalEvent, seg: DaySegment) => (
    <button key={e.id + seg.date} type="button" onClick={() => openEvent(e)} className={`block w-full truncate rounded-lg border px-2 py-1 text-left text-xs font-medium transition hover:-translate-y-px hover:shadow-card active:scale-[.98] ${tone(e)}`}>
      {!seg.allDay && <span className="mr-1 tabular opacity-80">{mm(seg.startMin)}</span>}{e.title}
    </button>
  );

  // ---------- views
  const list = (
    <div className="flex flex-col gap-3">
      {days.filter((d) => view === "day" || (byDay.get(d)?.length ?? 0) + (extrasByDay.get(d)?.length ?? 0) > 0 || d === today).map((d) => {
        const items = [...(byDay.get(d) ?? [])].sort((a, b) => Number(b.seg.allDay) - Number(a.seg.allDay) || a.seg.startMin - b.seg.startMin);
        const ex = extrasByDay.get(d) ?? [];
        return (
          <section key={d} className={`rounded-2xl border bg-surface p-3 shadow-card ${d === today ? "border-accent" : "border-line"}`}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{dayName(d, { weekday: "long", day: "numeric", month: "short" })}{d === today && <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-[11px] text-on-accent">Today</span>}</h2>
              {googleOn && <button type="button" onClick={() => openNew(d)} className="grid h-7 w-7 place-items-center rounded-full bg-tint text-lg leading-none transition hover:bg-accent hover:text-on-accent active:scale-90" aria-label={`Add event on ${d}`}>+</button>}
            </div>
            {items.length + ex.length === 0 ? <p className="mt-1 text-sm text-neutral-500">Nothing scheduled.</p> : (
              <ul className="mt-2 flex flex-col gap-1.5">
                {items.map(({ ev, seg }) => (
                  <li key={ev.id + seg.date}>
                    <button type="button" onClick={() => openEvent(ev)} className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition hover:-translate-y-px hover:shadow-card active:scale-[.99] ${tone(ev)}`}>
                      <span className="w-20 shrink-0 text-xs font-semibold tabular">{seg.allDay ? "All day" : `${mm(seg.startMin)}–${mm(seg.endMin % 1440)}`}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{ev.title}</span>
                      <span className="shrink-0 text-[11px] opacity-70">{label(ev)}</span>
                    </button>
                  </li>
                ))}
                {ex.map((x) => (
                  <li key={x.key} className="flex items-center gap-3 rounded-xl border border-line bg-black/[.03] px-3 py-2 text-sm">
                    <span className="w-20 shrink-0 text-xs tabular text-neutral-500">{x.time}</span>
                    {x.href ? <Link href={x.href} className="min-w-0 flex-1 truncate hover:underline">{x.title}</Link> : <span className="min-w-0 flex-1 truncate">{x.title}</span>}
                    <span className="shrink-0 text-[11px] text-neutral-500">Due</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {view === "agenda" && days.every((d) => (byDay.get(d)?.length ?? 0) + (extrasByDay.get(d)?.length ?? 0) === 0) && <p className="text-neutral-500">Nothing in the next 30 days.</p>}
    </div>
  );

  const late = days.flatMap((d) => (byDay.get(d) ?? []).filter((x) => !x.seg.allDay && x.seg.startMin >= 20 * 60 && (d >= today)));
  const lateCount = late.length;
  const lateTitle = late.slice(0, 2).map((x) => `${mm(x.seg.startMin)} ${x.ev.title}`).join(", ") + (late.length > 2 ? "…" : "");
  const cols = days.length;
  const grid = (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <div className="grid border-b border-line" style={{ gridTemplateColumns: `3rem repeat(${cols}, minmax(0, 1fr))` }}>
        <div />
        {days.map((d) => (
          <div key={d} className={`border-l border-line px-2 py-2 text-center ${d === today ? "bg-accent/10" : ""}`}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{dayName(d, { weekday: "short" })}</p>
            <p className={`mx-auto mt-0.5 grid h-8 w-8 place-items-center rounded-full text-base font-semibold ${d === today ? "bg-accent text-on-accent shadow-glow" : ""}`}>{Number(d.slice(8))}</p>
          </div>
        ))}
      </div>
      {days.some((d) => (byDay.get(d) ?? []).some((x) => x.seg.allDay) || (extrasByDay.get(d)?.length ?? 0) > 0) && (
        <div className="grid border-b border-line" style={{ gridTemplateColumns: `3rem repeat(${cols}, minmax(0, 1fr))` }}>
          <div className="px-1 py-1 text-[10px] text-neutral-500">all day</div>
          {days.map((d) => (
            <div key={d} className="flex min-w-0 flex-col gap-1 border-l border-line p-1">
              {(byDay.get(d) ?? []).filter((x) => x.seg.allDay).map(({ ev, seg }) => chip(ev, seg))}
              {(extrasByDay.get(d) ?? []).map((x) => <span key={x.key} className="block truncate rounded-lg border border-line bg-black/[.03] px-2 py-1 text-xs">{x.href ? <Link href={x.href} className="hover:underline">Due: {x.title}</Link> : x.title}</span>)}
            </div>
          ))}
        </div>
      )}
      {lateCount > 0 && (
        <button type="button" onClick={() => scroller.current?.scrollTo({ top: 24 * H, behavior: "smooth" })} className="flex w-full items-center justify-center gap-2 border-b border-line bg-tint px-3 py-1.5 text-xs font-semibold transition hover:bg-accent hover:text-on-accent">
          {lateCount} later event{lateCount > 1 ? "s" : ""} (after 20:00): {lateTitle} ↓
        </button>
      )}
      <div ref={scroller} className="relative max-h-[640px] overflow-y-auto">
        <div className="relative grid" style={{ gridTemplateColumns: `3rem repeat(${cols}, minmax(0, 1fr))`, height: 24 * H }}>
          <div className="relative">{Array.from({ length: 24 }, (_, h) => <span key={h} className="absolute right-1 -translate-y-1/2 text-[10px] tabular text-neutral-500" style={{ top: h * H }}>{h === 0 ? "" : mm(h * 60)}</span>)}</div>
          {days.map((d) => (
            <div key={d} className="relative border-l border-line" style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${H - 1}px, var(--color-line) ${H - 1}px, var(--color-line) ${H}px)` }}
              onClick={(e) => { if (!googleOn || e.target !== e.currentTarget) return; const r = e.currentTarget.getBoundingClientRect(); openNew(d, Math.floor(((e.clientY - r.top) / H) * 2) * 30); }}>
              {d === today && <span aria-hidden className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-rose-500" style={{ top: (nowMin / 60) * H }}><span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-rose-500" /></span>}
              {lanes((byDay.get(d) ?? []).filter((x) => !x.seg.allDay)).map(({ ev, seg, lane, of }) => (
                <button key={ev.id + seg.date} type="button" onClick={() => openEvent(ev)} title={ev.title}
                  className={`absolute overflow-hidden rounded-lg border px-1.5 py-0.5 text-left text-xs leading-tight shadow-card transition hover:z-20 hover:-translate-y-px hover:shadow-pop active:scale-[.98] ${tone(ev)}`}
                  style={{ top: (seg.startMin / 60) * H, height: Math.max(22, ((seg.endMin - seg.startMin) / 60) * H - 2), left: `calc(${(lane / of) * 100}% + 2px)`, width: `calc(${100 / of}% - 4px)` }}>
                  <span className="block truncate font-semibold">{ev.title}</span>
                  {seg.endMin - seg.startMin >= 40 && <span className="block truncate opacity-80 tabular">{mm(seg.startMin)}–{mm(seg.endMin % 1440)}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const month = (
    <div className="grid grid-cols-7 gap-1.5">
      {days.slice(0, 7).map((d) => <p key={"h" + d} className="px-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{dayName(d, { weekday: "short" })}</p>)}
      {days.map((d) => {
        const its = byDay.get(d) ?? [], ex = extrasByDay.get(d) ?? [];
        return (
          <div key={d} className={`min-h-[4.5rem] rounded-xl border p-1.5 text-xs shadow-card transition hover:-translate-y-px hover:shadow-pop ${d === today ? "border-accent bg-accent/10" : "border-line bg-surface"} ${d.slice(0, 7) !== date.slice(0, 7) ? "opacity-50" : ""}`}>
            <Link href={`/calendar?view=day&date=${d}`} className="font-semibold hover:underline">{Number(d.slice(8))}</Link>
            <div className="mt-1 hidden flex-col gap-0.5 md:flex">
              {its.slice(0, 3).map(({ ev, seg }) => chip(ev, seg))}
              {its.length + ex.length > 3 && <span className="text-neutral-500">+{its.length + ex.length - 3} more</span>}
            </div>
            <div className="mt-1 flex flex-wrap gap-0.5 md:hidden">{its.slice(0, 4).map(({ ev }) => <span key={ev.id} className={`h-1.5 w-1.5 rounded-full ${ev.source === "reminder" ? "bg-amber-500" : ev.source === "task" ? "bg-ws-violet" : "bg-ws-blue"}`} />)}</div>
          </div>
        );
      })}
    </div>
  );

  const readOnly = edit?.source === "task";
  return (
    <div>
      {googleOn && <div className="mb-3 flex justify-end"><button type="button" onClick={() => openNew(date >= from && date <= to ? date : today)} className={btnPrimary}>+ Add event</button></div>}
      {view === "month" ? month : view === "agenda" ? list : (<><div className="hidden md:block">{grid}</div><div className="md:hidden">{list}</div></>)}

      <dialog ref={dlg} onClose={() => setEdit(null)} onClick={(e) => { if (e.target === dlg.current) setEdit(null); }}
        className="m-auto w-[min(30rem,calc(100vw-1.5rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-black/40 backdrop:backdrop-blur-[2px]">
        {edit && (
          <form action={save} key={edit.id ?? `${edit.startLocal}`} className="flex flex-col gap-3 p-5">
            <h2 className="text-lg font-semibold tracking-tight">{edit.id ? (readOnly ? "Task event" : "Edit event") : "New event"}</h2>
            {edit.source === "reminder" && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">This is a Founder OS reminder. You can change its title and time here.</p>}
            {readOnly && <p className="rounded-lg bg-ws-violet-tint p-2 text-xs text-ws-violet-ink">This comes from a task. Change its due date or time on the task.{edit.sourceId && <> <Link className="underline" href={`/tasks/${edit.sourceId}`}>Open task</Link></>}</p>}
            <label className="flex flex-col gap-1 text-sm">Title<input name="title" required maxLength={300} defaultValue={edit.title} readOnly={readOnly} autoFocus className={input} /></label>
            {edit.source !== "reminder" && <AllDayFields edit={edit} readOnly={readOnly} />}
            {edit.source === "reminder" && <label className="flex flex-col gap-1 text-sm">Time<input type="datetime-local" name="start" required defaultValue={edit.startLocal} className={input} /></label>}
            {edit.source !== "reminder" && edit.source !== "task" && <label className="flex flex-col gap-1 text-sm">Notes<textarea name="notes" rows={3} maxLength={4000} defaultValue={edit.notes} className={input} /></label>}
            {!edit.id && <p className="text-xs text-neutral-500">Alerts: 10 minutes before and on time, on your phone calendar and as a Founder OS notification.</p>}
            {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-800">{error}</p>}
            <div className="flex items-center gap-2">
              {edit.id && !readOnly && <button type="button" onClick={remove} disabled={pending} className="rounded-[10px] px-3 py-2 text-sm font-medium text-rose-800 hover:bg-rose-50">Delete</button>}
              <span className="flex-1" />
              <button type="button" className={btn} onClick={() => setEdit(null)}>{readOnly ? "Close" : "Cancel"}</button>
              {!readOnly && <button className={btnPrimary} disabled={pending}>{pending ? "Saving…" : "Save"}</button>}
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}

function AllDayFields({ edit, readOnly }: { edit: NonNullable<Editing>; readOnly: boolean }) {
  const [allDay, setAllDay] = useState(edit.allDay);
  return (
    <>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allDay" checked={allDay} disabled={readOnly} onChange={(e) => setAllDay(e.target.checked)} />All day</label>
      {allDay ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm">Start<input type="date" name="startDate" required defaultValue={edit.startLocal.slice(0, 10)} readOnly={readOnly} className={input} /></label>
          <label className="flex flex-col gap-1 text-sm">End<input type="date" name="endDate" defaultValue={edit.endLocal.slice(0, 10)} readOnly={readOnly} className={input} /></label>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm">Start<input type="datetime-local" name="start" required defaultValue={edit.startLocal} readOnly={readOnly} className={input} /></label>
          <label className="flex flex-col gap-1 text-sm">End<input type="datetime-local" name="end" required defaultValue={edit.endLocal} readOnly={readOnly} className={input} /></label>
        </div>
      )}
    </>
  );
}
