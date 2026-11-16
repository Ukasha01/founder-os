import Link from "next/link";
import { NewPanel } from "@/components/new-panel";
import { createClient } from "@/lib/supabase/server";
import { input, card, PRIORITY_LABEL } from "@/lib/ui";
import { addDays, dateInTz } from "@/lib/time";
import { createRule, deleteRule, setPaused, skipOccurrence } from "./actions";
import { SubmitButton } from "@/components/submit-button";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function RecurringPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: settings } = await supabase.from("user_settings").select("timezone").maybeSingle();
  const today = dateInTz(new Date(), settings?.timezone ?? "Asia/Karachi");
  const [{ data: rules }, { data: workspaces }, { data: upcoming }] = await Promise.all([
    supabase.from("recurrence_rules").select("id, name, freq, interval_count, by_weekday, by_monthday, times_of_day, start_date, end_date, is_paused").eq("target_kind", "task").order("created_at"),
    supabase.from("workspaces").select("id, name").is("archived_at", null).order("sort_order"),
    supabase.from("tasks").select("id, title, occurrence_date, status").eq("source", "recurrence").is("deleted_at", null)
      .gte("occurrence_date", today).lte("occurrence_date", addDays(today, 7)).neq("status", "cancelled").order("occurrence_date").limit(50),
  ]);
  const describe = (r: NonNullable<typeof rules>[number]) =>
    `${r.freq === "daily" ? (r.interval_count > 1 ? `Every ${r.interval_count} days` : "Daily") : r.freq === "weekly" ? `Every ${r.interval_count > 1 ? r.interval_count + " weeks" : "week"}${r.by_weekday?.length ? " on " + r.by_weekday.map((n: number) => DAYS[n]).join(", ") : ""}` : `Monthly${r.by_monthday?.length ? " on day " + r.by_monthday.join(", ") : ""}`}${r.times_of_day?.length ? " at " + r.times_of_day.map((t: string) => t.slice(0, 5)).join(", ") : ""}`;

  return (
    <div className="max-w-3xl">
      <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">Recurring tasks</h1>
      <p className="text-sm text-neutral-500">Tasks are created for the next 14 days whenever you open the app. Changing or finishing one never changes the series.</p>
      {error && <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <ul className="mt-4 flex flex-col gap-3">
        {!rules?.length && <li className="text-neutral-500">No recurring tasks yet.</li>}
        {rules?.map((r) => (
          <li key={r.id} className={card}>
            <p className="font-medium">{r.name} {r.is_paused && <span className="text-xs font-normal text-amber-700">(paused)</span>}</p>
            <p className="text-sm text-neutral-600">{describe(r)} · from {r.start_date}{r.end_date ? ` to ${r.end_date}` : ""}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <form action={setPaused}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="paused" value={r.is_paused ? "false" : "true"} /><SubmitButton variant="secondary">{r.is_paused ? "Resume" : "Pause"}</SubmitButton></form>
              <form action={deleteRule} className="flex items-center gap-1">
                <input type="hidden" name="id" value={r.id} />
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="confirm" value="yes" /> Confirm delete (keeps created tasks)</label>
                <SubmitButton variant="secondary">Delete</SubmitButton>
              </form>
            </div>
          </li>
        ))}
      </ul>

      <h2 className="mt-6 mb-2 text-[15px] font-semibold">Next 7 days</h2>
      <ul className="text-sm">
        {upcoming?.map((t) => (
          <li key={t.id} className="flex items-center gap-2 py-0.5">
            <span className="text-xs text-neutral-500">{t.occurrence_date}</span>
            <Link href={`/tasks/${t.id}`} className="hover:underline">{t.title}</Link>
            {t.status !== "completed" && <form action={skipOccurrence}><input type="hidden" name="task_id" value={t.id} /><button className="text-xs underline">skip this one</button></form>}
          </li>
        ))}
        {!upcoming?.length && <li className="text-neutral-500">Nothing generated yet.</li>}
      </ul>

      <NewPanel label="New recurring task">
      <form action={createRule} className={`${card} grid gap-2 sm:grid-cols-2`}>
        <label className="flex flex-col gap-1 text-xs sm:col-span-2">Title<input name="title" required maxLength={300} className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Workspace<select name="workspace_id" required className={input}>{workspaces?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-xs">Priority<select name="priority" defaultValue="normal" className={input}>{Object.entries(PRIORITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-xs">Repeats<select name="freq" defaultValue="daily" className={input}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
        <label className="flex flex-col gap-1 text-xs">Every N (days / weeks / months)<input type="number" name="interval_count" min={1} defaultValue={1} className={input} /></label>
        <fieldset className="sm:col-span-2"><legend className="text-xs">Weekdays (weekly only; empty = start date&apos;s weekday)</legend>
          <div className="mt-1 flex flex-wrap gap-3 text-sm">{DAYS.map((n, i) => <label key={n} className="flex items-center gap-1"><input type="checkbox" name="weekdays" value={i} />{n}</label>)}</div>
        </fieldset>
        <label className="flex flex-col gap-1 text-xs">Day of month (monthly only)<input type="number" name="monthday" min={1} max={31} className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Times, several per day (09:00, 18:00)<input name="times" className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Estimate (min)<input type="number" name="estimated_minutes" min={0} className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Starts<input type="date" name="start_date" defaultValue={today} required className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Ends (optional)<input type="date" name="end_date" className={input} /></label>
        <div className="self-end"><SubmitButton variant="primary">Add</SubmitButton></div>
      </form>
      </NewPanel>
    </div>
  );
}
