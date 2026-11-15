import { createClient } from "@/lib/supabase/server";
import { addDays, dateInTz, startOfWeek } from "@/lib/time";
import { formatMinutes, input, btn, btnPrimary, card } from "@/lib/ui";
import { logManual, startTimer, stopTimer } from "./actions";

export default async function TimePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: settings } = await supabase.from("user_settings").select("timezone, week_starts_on").maybeSingle();
  const tz = settings?.timezone ?? "Asia/Karachi";
  const today = dateInTz(new Date(), tz);
  const weekFrom = startOfWeek(today, settings?.week_starts_on ?? 1);

  const [{ data: workspaces }, { data: tasks }, { data: running }, { data: week }] = await Promise.all([
    supabase.from("workspaces").select("id, name").is("archived_at", null).order("sort_order"),
    supabase.from("tasks").select("id, title").is("deleted_at", null).in("status", ["not_started", "in_progress", "waiting"]).order("created_at", { ascending: false }).limit(100),
    supabase.from("time_entries").select("id, started_at, task_id, workspace_id").is("duration_minutes", null).maybeSingle(),
    supabase.from("time_entries").select("workspace_id, duration_minutes, entry_date").gte("entry_date", weekFrom).lte("entry_date", addDays(weekFrom, 6)),
  ]);

  const wsName = new Map((workspaces ?? []).map((w) => [w.id as string, w.name as string]));
  const taskTitle = new Map((tasks ?? []).map((t) => [t.id as string, t.title as string]));
  const sum = (rows: { duration_minutes: number | null; workspace_id: string; entry_date: string }[]) => rows.reduce((n, r) => n + (r.duration_minutes ?? 0), 0);
  const todayMin = sum((week ?? []).filter((r) => r.entry_date === today));
  const weekMin = sum(week ?? []);
  const byWs = new Map<string, number>();
  for (const r of week ?? []) byWs.set(r.workspace_id, (byWs.get(r.workspace_id) ?? 0) + (r.duration_minutes ?? 0));

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Time</h1>
      {error && <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <section className={`${card} mt-5`}>
        <h2 className="font-medium">Timer</h2>
        {running ? (
          <form action={stopTimer} className="mt-2 flex flex-wrap items-center gap-3">
            <input type="hidden" name="id" value={running.id} />
            <p className="text-sm">
              Running since {new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeStyle: "short" }).format(new Date(running.started_at))}
              {" · "}{running.task_id ? taskTitle.get(running.task_id) ?? "a task" : wsName.get(running.workspace_id)}
            </p>
            <button className={btnPrimary}>Stop</button>
          </form>
        ) : (
          <form action={startTimer} className="mt-2 flex flex-wrap items-end gap-2">
            <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs">Task
              <select name="task_id" defaultValue="" className={input}>
                <option value="">No specific task</option>
                {tasks?.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">Workspace (if no task)
              <select name="workspace_id" defaultValue="" className={input}>
                <option value="">—</option>
                {workspaces?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
            <button className={btnPrimary}>Start</button>
          </form>
        )}
      </section>

      <section className={`${card} mt-4`}>
        <h2 className="font-medium">Log time you already worked</h2>
        <form action={logManual} className="mt-2 flex flex-wrap items-end gap-2">
          <input type="hidden" name="client_request_id" value={crypto.randomUUID()} />
          <label className="flex flex-col gap-1 text-xs">Workspace
            <select name="workspace_id" required defaultValue="" className={input}>
              <option value="" disabled>Choose…</option>
              {workspaces?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">Minutes<input type="number" name="minutes" min={1} max={1440} required className={`${input} w-28`} /></label>
          <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs">Note<input name="note" maxLength={500} className={input} /></label>
          <button className={btn}>Log</button>
        </form>
      </section>

      <section className={`${card} mt-4`}>
        <h2 className="font-medium">Totals</h2>
        <p className="mt-1 text-sm">Today: {formatMinutes(todayMin)} · This week: {formatMinutes(weekMin)}</p>
        <ul className="mt-2 text-sm text-neutral-600">
          {[...byWs.entries()].map(([id, m]) => <li key={id}>{wsName.get(id)}: {formatMinutes(m)}</li>)}
          {!byWs.size && <li>Nothing logged this week yet.</li>}
        </ul>
      </section>
    </div>
  );
}
