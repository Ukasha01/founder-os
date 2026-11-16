import { createClient } from "@/lib/supabase/server";
import { input, card } from "@/lib/ui";
import { DEFAULT_WEIGHTS, type Weights } from "@/lib/score";
import { saveGeneral, saveWeights } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: s } = await supabase.from("user_settings").select("timezone, week_starts_on, scoring_weights").maybeSingle();
  const w = (s?.scoring_weights as Weights | undefined) ?? DEFAULT_WEIGHTS;
  const fields: [keyof Weights, string][] = [["tasks", "Tasks completed"], ["hours", "Planned hours worked"], ["kpis", "KPIs"], ["habits", "Habits"], ["planning", "Planning and review"]];
  return (
    <div className="max-w-2xl">
      <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">Settings</h1>
      {sp.error && <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{sp.error}</p>}
      {sp.saved && <p role="status" className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-800">{sp.saved}</p>}
      <form action={saveGeneral} className={`${card} mt-4 grid gap-2 sm:grid-cols-2`}>
        <h2 className="font-medium sm:col-span-2">General</h2>
        <label className="flex flex-col gap-1 text-xs">Timezone<input name="timezone" defaultValue={s?.timezone ?? "Asia/Karachi"} className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Week starts on
          <select name="week_starts_on" defaultValue={String(s?.week_starts_on ?? 1)} className={input}>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
        </label>
        <div><SubmitButton variant="primary">Save</SubmitButton></div>
      </form>
      <form action={saveWeights} className={`${card} mt-4 grid gap-2 sm:grid-cols-2`}>
        <h2 className="font-medium sm:col-span-2">Daily score weights (must add up to 100)</h2>
        {fields.map(([k, label]) => <label key={k} className="flex flex-col gap-1 text-xs">{label}<input type="number" name={k} min={0} max={100} step="any" defaultValue={w[k]} className={input} /></label>)}
        <div><SubmitButton variant="primary">Save weights</SubmitButton></div>
      </form>
    </div>
  );
}
