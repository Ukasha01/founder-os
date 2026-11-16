import Link from "next/link";
import { NewPanel } from "@/components/new-panel";
import { createClient } from "@/lib/supabase/server";
import { input, btn, btnPrimary, card } from "@/lib/ui";
import { addDays, dateInTz, isDateString } from "@/lib/time";
import { PRESETS, consistency, currentStreak, isScheduled, type EntryStatus, type Frequency } from "@/lib/habits";
import { archiveHabit, createHabit, logHabit } from "./actions";
import { SubmitButton } from "@/components/submit-button";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function HabitsPage({ searchParams }: { searchParams: Promise<{ error?: string; date?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: settings } = await supabase.from("user_settings").select("timezone").maybeSingle();
  const today = dateInTz(new Date(), settings?.timezone ?? "Asia/Karachi");
  const date = isDateString(sp.date) && sp.date <= today ? sp.date : today;

  const [{ data: habits }, { data: entries }] = await Promise.all([
    supabase.from("habits").select("id, name, preset, frequency_type, weekdays, weekly_target, unit, start_date").is("archived_at", null).order("sort_order").order("created_at"),
    supabase.from("habit_entries").select("habit_id, entry_date, status, value").gte("entry_date", addDays(today, -400)),
  ]);
  const byHabit = new Map<string, Map<string, EntryStatus>>();
  const values = new Map<string, number | null>();
  for (const e of entries ?? []) {
    if (!byHabit.has(e.habit_id)) byHabit.set(e.habit_id, new Map());
    byHabit.get(e.habit_id)!.set(e.entry_date, e.status as EntryStatus);
    if (e.entry_date === date) values.set(e.habit_id, e.value);
  }
  const def = (h: NonNullable<typeof habits>[number]) => ({ frequency_type: h.frequency_type as Frequency, weekdays: h.weekdays, weekly_target: h.weekly_target, start_date: h.start_date });

  return (
    <div className="max-w-3xl">
      <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">Habits</h1>
      {sp.error && <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{sp.error}</p>}
      <p className="mt-2 flex items-center gap-3 text-sm">
        <Link href={`/habits?date=${addDays(date, -1)}`} className="underline">← Previous day</Link>
        <strong>{date === today ? `Today · ${date}` : date}</strong>
        {date < today && <Link href={`/habits?date=${addDays(date, 1)}`} className="underline">Next day →</Link>}
        {date !== today && <Link href="/habits" className="underline">Today</Link>}
      </p>

      <ul className="mt-4 flex flex-col gap-3">
        {!habits?.length && <li className="text-neutral-500">No habits yet. Add one below.</li>}
        {habits?.map((h) => {
          const en = byHabit.get(h.id) ?? new Map<string, EntryStatus>();
          const d = def(h);
          const cur = en.get(date);
          const scheduled = isScheduled(d, date);
          const c30 = consistency(d, en, addDays(today, -29), today, today);
          const streak = currentStreak(d, en, today);
          return (
            <li key={h.id} className={card}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{h.name}{h.unit ? <span className="text-xs text-neutral-500"> ({h.unit})</span> : null}</span>
                <span className="text-xs text-neutral-500">
                  {h.frequency_type === "daily" ? "Daily" : h.frequency_type === "weekdays" ? (h.weekdays ?? []).map((n: number) => DAYS[n]).join(" ") : `${h.weekly_target}× a week`}
                  {" · "}streak {streak}{h.frequency_type === "weekly_target" ? " wk" : " d"}{" · "}30-day {c30 === null ? "no data" : `${c30}%`}
                </span>
              </div>
              <p className="mt-1 text-sm text-neutral-600">{cur ? `Logged: ${cur}${values.get(h.id) != null ? ` (${values.get(h.id)})` : ""}` : scheduled || h.frequency_type === "weekly_target" ? "Not logged" : "Not scheduled today"}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {(["done", "partial", "skipped", "clear"] as const).map((s) => (
                  <form key={s} action={logHabit}>
                    <input type="hidden" name="habit_id" value={h.id} /><input type="hidden" name="entry_date" value={date} /><input type="hidden" name="status" value={s} />
                    <button className={s === "done" ? btnPrimary : btn} disabled={s === "clear" && !cur}>{s === "clear" ? "Clear" : s[0].toUpperCase() + s.slice(1)}</button>
                  </form>
                ))}
                <form action={archiveHabit} className="ml-auto"><input type="hidden" name="id" value={h.id} /><button className="text-xs underline">Archive</button></form>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-neutral-500">Skipped days are excused: they do not break a streak or count against you. Past days can be edited any time.</p>

      <NewPanel label="New habit">
      <form action={createHabit} className={`${card} grid gap-2 sm:grid-cols-2`}>
        <input type="hidden" name="start_date" value={today} />
        <label className="flex flex-col gap-1 text-xs">Name<input name="name" required maxLength={200} className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Preset (optional)
          <select name="preset" defaultValue="" className={input}><option value="">Custom</option>{PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs">How often
          <select name="frequency_type" defaultValue="daily" className={input}><option value="daily">Every day</option><option value="weekdays">Selected weekdays</option><option value="weekly_target">X times a week</option></select>
        </label>
        <label className="flex flex-col gap-1 text-xs">Times a week (for “X times a week”)<input type="number" name="weekly_target" min={1} max={7} defaultValue={3} className={input} /></label>
        <fieldset className="sm:col-span-2"><legend className="text-xs">Weekdays (for “Selected weekdays”)</legend>
          <div className="mt-1 flex flex-wrap gap-3 text-sm">{DAYS.map((n, i) => <label key={n} className="flex items-center gap-1"><input type="checkbox" name="weekdays" value={i} />{n}</label>)}</div>
        </fieldset>
        <label className="flex flex-col gap-1 text-xs">Unit (optional: pages, minutes)<input name="unit" className={input} /></label>
        <div className="self-end"><SubmitButton variant="primary">Add habit</SubmitButton></div>
      </form>
      </NewPanel>
    </div>
  );
}
