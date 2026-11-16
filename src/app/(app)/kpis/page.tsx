import { NewPanel } from "@/components/new-panel";
import { createClient } from "@/lib/supabase/server";
import { input, card } from "@/lib/ui";
import { addDays, dateInTz, startOfMonth, startOfWeek, addMonths } from "@/lib/time";
import { archiveKpi, createKpi, recordKpi } from "./actions";
import { SubmitButton } from "@/components/submit-button";

function periodRange(period: string, today: string): [string, string] {
  if (period === "day") return [today, today];
  if (period === "week") { const s = startOfWeek(today, 1); return [s, addDays(s, 6)]; }
  if (period === "month") { const s = startOfMonth(today); return [s, addDays(addMonths(s, 1), -1)]; }
  if (period === "quarter") { const m = Number(today.slice(5, 7)); const q = Math.floor((m - 1) / 3) * 3 + 1; const s = `${today.slice(0, 4)}-${String(q).padStart(2, "0")}-01`; return [s, addDays(addMonths(s, 3), -1)]; }
  return [`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`];
}

export default async function KpisPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const [{ data: settings }, { data: workspaces }, { data: kpis }] = await Promise.all([
    supabase.from("user_settings").select("timezone").maybeSingle(),
    supabase.from("workspaces").select("id, name").is("archived_at", null).order("sort_order"),
    supabase.from("kpi_definitions").select("id, workspace_id, name, unit, target_value, direction, period, aggregation").is("archived_at", null).order("name"),
  ]);
  const today = dateInTz(new Date(), settings?.timezone ?? "Asia/Karachi");
  const ids = (kpis ?? []).map((k) => k.id);
  const { data: entries } = ids.length
    ? await supabase.from("kpi_entries").select("kpi_id, period_start, period_end, actual_value, note").in("kpi_id", ids).order("period_start", { ascending: false }).limit(1000)
    : { data: [] as { kpi_id: string; period_start: string; period_end: string; actual_value: number; note: string | null }[] };
  const wsName = new Map((workspaces ?? []).map((w) => [w.id, w.name]));

  return (
    <div className="max-w-3xl">
      <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">KPIs</h1>
      <p className="text-sm text-neutral-500">A KPI with no entry for the current period shows “no data”, never zero.</p>
      {error && <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <ul className="mt-4 flex flex-col gap-3">
        {!kpis?.length && <li className="text-neutral-500">No KPIs yet. Add one below.</li>}
        {kpis?.map((k) => {
          const [from, to] = periodRange(k.period, today);
          const mine = (entries ?? []).filter((e) => e.kpi_id === k.id);
          const inPeriod = mine.filter((e) => e.period_start >= from && e.period_end <= to);
          let current: number | null = null;
          if (inPeriod.length) {
            const vals = inPeriod.map((e) => Number(e.actual_value));
            current = k.aggregation === "sum" ? vals.reduce((a, b) => a + b, 0) : k.aggregation === "average" ? vals.reduce((a, b) => a + b, 0) / vals.length : Number(inPeriod[0].actual_value);
          }
          const target = k.target_value === null ? null : Number(k.target_value);
          const pct = current !== null && target ? Math.round((k.direction === "lower_is_better" ? target / (current || 1) : current / target) * 100) : null;
          return (
            <li key={k.id} className={card}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{k.name} <span className="text-xs font-normal text-neutral-500">· {wsName.get(k.workspace_id)} · per {k.period}</span></span>
                <span className="text-sm">{current === null ? <span className="text-neutral-500">no data this {k.period}</span> : <>{Math.round(current * 100) / 100}{k.unit ? ` ${k.unit}` : ""}{target !== null ? ` of ${target}` : ""}{pct !== null ? ` (${pct}%)` : ""}</>}</span>
              </div>
              <form action={recordKpi} className="mt-2 flex flex-wrap items-end gap-2">
                <input type="hidden" name="kpi_id" value={k.id} />
                <label className="flex flex-col gap-1 text-xs">From<input type="date" name="period_start" defaultValue={from} required className={input} /></label>
                <label className="flex flex-col gap-1 text-xs">To<input type="date" name="period_end" defaultValue={to} required className={input} /></label>
                <label className="flex flex-col gap-1 text-xs">Value<input type="number" step="any" name="actual_value" required className={`${input} w-28`} /></label>
                <label className="flex min-w-32 flex-1 flex-col gap-1 text-xs">Note<input name="note" maxLength={500} className={input} /></label>
                <SubmitButton variant="secondary">Record</SubmitButton>
              </form>
              {mine.length > 0 && (
                <ul className="mt-2 text-xs text-neutral-600">
                  {mine.slice(0, 5).map((e) => <li key={`${e.period_start}-${e.period_end}`}>{e.period_start}{e.period_end !== e.period_start ? ` → ${e.period_end}` : ""}: {Number(e.actual_value)}{k.unit ? ` ${k.unit}` : ""}{e.note ? ` · ${e.note}` : ""}</li>)}
                </ul>
              )}
              <form action={archiveKpi} className="mt-1 text-right"><input type="hidden" name="id" value={k.id} /><button className="text-xs underline">Archive</button></form>
            </li>
          );
        })}
      </ul>

      <NewPanel label="New KPI">
      <form action={createKpi} className={`${card} grid gap-2 sm:grid-cols-2`}>
        <label className="flex flex-col gap-1 text-xs">Workspace<select name="workspace_id" required className={input}>{workspaces?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-xs">Name (e.g. Orders, Revenue)<input name="name" required maxLength={200} className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Unit<input name="unit" className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Target (optional)<input type="number" step="any" name="target_value" className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Better when<select name="direction" className={input}><option value="higher_is_better">Higher</option><option value="lower_is_better">Lower</option></select></label>
        <label className="flex flex-col gap-1 text-xs">Period<select name="period" defaultValue="week" className={input}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="quarter">Quarter</option><option value="year">Year</option></select></label>
        <label className="flex flex-col gap-1 text-xs">Combine entries by<select name="aggregation" className={input}><option value="sum">Sum</option><option value="latest">Latest</option><option value="average">Average</option></select></label>
        <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="show_on_dashboard" /> Show on dashboard</label>
        <div><SubmitButton variant="primary">Add KPI</SubmitButton></div>
      </form>
      </NewPanel>
    </div>
  );
}
