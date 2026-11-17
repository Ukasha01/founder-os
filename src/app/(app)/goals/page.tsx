import { NewPanel } from "@/components/new-panel";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaces } from "@/lib/data";
import { input, card } from "@/lib/ui";
import { addMilestone, createGoal, deleteGoal, setGoalStatus, updateMilestone } from "./actions";
import { SubmitButton } from "@/components/submit-button";

const GOAL_STATUS: Record<string, string> = { not_started: "Not started", active: "Active", achieved: "Achieved", paused: "Paused", abandoned: "Abandoned" };
const MS_STATUS: Record<string, string> = { pending: "Pending", in_progress: "In progress", achieved: "Achieved", missed: "Missed", cancelled: "Cancelled" };

export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const [{ data: workspaces }, { data: goals }, { data: milestones }, { data: progress }] = await Promise.all([
    getWorkspaces().then((data) => ({ data })),
    supabase.from("goals").select("id, workspace_id, name, description, target_date, success_criteria, status").is("deleted_at", null).order("created_at"),
    supabase.from("milestones").select("id, goal_id, title, measure_description, target_value, current_value, unit, due_date, status").order("sort_order").order("created_at"),
    supabase.from("goal_progress").select("goal_id, progress_percent, milestone_count, achieved_count"),
  ]);
  const prog = new Map((progress ?? []).map((p) => [p.goal_id as string, p]));
  const wsName = new Map((workspaces ?? []).map((w) => [w.id as string, w.name as string]));

  return (
    <div className="max-w-3xl">
      <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">Goals</h1>
      <p className="text-sm text-neutral-500">Milestones must be measurable: a target number, or a written way to check it is done.</p>
      {error && <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <NewPanel label="New goal">
      <form action={createGoal} className={`${card} grid gap-2 sm:grid-cols-2`}>
        <label className="flex flex-col gap-1 text-xs sm:col-span-2">Goal
          <input name="name" required maxLength={300} className={input} placeholder="e.g. Run 3 paid pilots" />
        </label>
        <label className="flex flex-col gap-1 text-xs">Workspace
          <select name="workspace_id" required defaultValue="" className={input}>
            <option value="" disabled>Choose…</option>
            {workspaces?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">Success criteria
          <input name="success_criteria" maxLength={2000} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs">Start date<input type="date" name="start_date" className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Target date<input type="date" name="target_date" className={input} /></label>
        <div className="sm:col-span-2"><SubmitButton variant="primary">Add goal</SubmitButton></div>
      </form>
      </NewPanel>

      {!goals?.length && <p className="mt-8 text-neutral-500">No goals yet.</p>}
      <ul className="mt-6 flex flex-col gap-4">
        {goals?.map((g) => {
          const p = prog.get(g.id as string);
          const ms = milestones?.filter((m) => m.goal_id === g.id) ?? [];
          return (
            <li key={g.id} className={card}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-medium">{g.name}</h2>
                <span className="text-xs text-neutral-500">{wsName.get(g.workspace_id as string)} · {GOAL_STATUS[g.status as string]}{g.target_date ? ` · target ${g.target_date}` : ""}</span>
              </div>
              {g.success_criteria && <p className="text-sm text-neutral-600">Success: {g.success_criteria}</p>}
              <p className="mt-1 text-sm">
                {p && p.milestone_count > 0
                  ? <>Progress {p.progress_percent}% ({p.achieved_count} of {p.milestone_count} milestones achieved)</>
                  : <span className="text-neutral-500">No milestones yet, so no progress to show.</span>}
              </p>

              <ul className="mt-3 flex flex-col gap-2">
                {ms.map((m) => (
                  <li key={m.id} className="rounded-md bg-neutral-50 p-2 text-sm">
                    <p className="font-medium">{m.title}{m.due_date ? <span className="font-normal text-neutral-500"> · due {m.due_date}</span> : null}</p>
                    <p className="text-xs text-neutral-500">
                      {m.target_value !== null ? `${m.current_value} of ${m.target_value}${m.unit ? " " + m.unit : ""}` : m.measure_description}
                    </p>
                    <form action={updateMilestone} className="mt-1 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="id" value={m.id} />
                      {m.target_value !== null && (
                        <label className="flex flex-col gap-1 text-xs">Current
                          <input type="number" step="any" min={0} name="current_value" defaultValue={m.current_value} className={`${input} w-28`} />
                        </label>
                      )}
                      <label className="flex flex-col gap-1 text-xs">Status
                        <select name="status" defaultValue={m.status} className={input}>
                          {Object.entries(MS_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </label>
                      <SubmitButton variant="secondary">Update</SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>

              <form action={addMilestone} className="mt-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="goal_id" value={g.id} />
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs">New milestone<input name="title" required maxLength={300} className={input} /></label>
                <label className="flex flex-col gap-1 text-xs">Target<input type="number" step="any" min={0} name="target_value" className={`${input} w-24`} /></label>
                <label className="flex flex-col gap-1 text-xs">Unit<input name="unit" maxLength={40} className={`${input} w-24`} /></label>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs">…or how it is measured<input name="measure_description" maxLength={2000} className={input} /></label>
                <label className="flex flex-col gap-1 text-xs">Due<input type="date" name="due_date" className={input} /></label>
                <SubmitButton variant="secondary">Add</SubmitButton>
              </form>

              <div className="mt-3 flex flex-wrap items-center gap-4">
                <form action={setGoalStatus} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={g.id} />
                  <select name="status" defaultValue={g.status} aria-label="Goal status" className={input}>
                    {Object.entries(GOAL_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <SubmitButton variant="secondary">Set</SubmitButton>
                </form>
                <form action={deleteGoal} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={g.id} />
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="confirm" value="yes" /> Confirm delete</label>
                  <SubmitButton variant="secondary">Delete</SubmitButton>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
