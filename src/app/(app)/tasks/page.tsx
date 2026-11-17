import Link from "next/link";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaces } from "@/lib/data";
import { buildTree, type TaskRow } from "@/lib/tasks";
import { PRIORITY_LABEL, input, card, wsStyle } from "@/lib/ui";
import { createTask } from "./actions";
import { TaskTree, type Progress, type WsMap } from "./task-tree";
import { NewPanel } from "@/components/new-panel";
import { SubmitButton } from "@/components/submit-button";

const LIMIT = 1000;

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const wsFilter = z.string().uuid().safeParse(sp.workspace).data;
  const supabase = await createClient();

  const { data: workspaces } = await getWorkspaces().then((data) => ({ data }));

  let q = supabase.from("task_overview")
    .select("id, parent_task_id, workspace_id, title, status, priority, current_deadline, original_deadline, child_count, actual_minutes, is_overdue")
    .order("created_at").limit(LIMIT);
  if (wsFilter) q = q.eq("workspace_id", wsFilter);
  const { data: rows, error } = await q;

  const tasks = (rows ?? []) as TaskRow[];
  // Progress is calculated only for tasks that have subtasks and are on screen.
  const parentIds = tasks.filter((t) => t.child_count > 0).map((t) => t.id).slice(0, 500);
  const progress: Progress = {};
  if (parentIds.length) {
    const { data } = await supabase.rpc("get_task_progress", { p_task_ids: parentIds });
    for (const r of (data ?? []) as { task_id: string; progress_percent: number }[]) {
      progress[r.task_id] = Number(r.progress_percent);
    }
  }
  const tree = buildTree(tasks);
  const current = workspaces?.find((w) => w.id === wsFilter);
  const wsMap: WsMap = Object.fromEntries((workspaces ?? []).map((w) => [w.id, { name: w.name, color: w.color }]));
  const open = tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled").length;

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">{current ? current.name : "All tasks"}</h1>
          <p className="text-sm text-neutral-500">{open} open of {tasks.length}. Tick the circle to finish a task; open it for subtasks, deadlines and time.</p>
        </div>
      </div>
      {(sp.error || error) && (
        <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{sp.error ?? error?.message}</p>
      )}

      <nav aria-label="Workspace filter" className="mt-4 flex flex-wrap gap-2 text-sm">
        <Link href="/tasks" className={`rounded-full px-3.5 py-1.5 font-medium transition ${!wsFilter ? "bg-ink text-white" : "bg-surface text-neutral-600 ring-1 ring-line hover:ring-line-strong"}`}>All</Link>
        {workspaces?.map((w) => {
          const c = wsStyle(w.color);
          const on = wsFilter === w.id;
          return (
            <Link key={w.id} href={`/tasks?workspace=${w.id}`}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-medium transition ${on ? `${c.tint} ${c.ink} ring-2 ring-current` : "bg-surface text-neutral-600 ring-1 ring-line hover:ring-line-strong"}`}>
              <span className={`h-2 w-2 rounded-full ${c.dot}`} />{w.name}
            </Link>
          );
        })}
      </nav>

      <NewPanel label="New task" open={tasks.length === 0}>
        <form action={createTask} className={`${card} flex flex-wrap items-end gap-3`}>
          <input type="hidden" name="client_request_id" value={crypto.randomUUID()} />
          <input type="hidden" name="return_to" value={wsFilter ? `/tasks?workspace=${wsFilter}` : "/tasks"} />
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm font-medium">Task
            <input name="title" required maxLength={500} placeholder="What needs doing?" className={input} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Workspace
            <select name="workspace_id" defaultValue={wsFilter ?? ""} required className={input}>
              <option value="" disabled>Choose…</option>
              {workspaces?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Priority
            <select name="priority" defaultValue="normal" className={input}>
              {Object.entries(PRIORITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">Deadline
            <input type="date" name="deadline" className={input} />
          </label>
          <SubmitButton variant="primary">Add task</SubmitButton>
        </form>
      </NewPanel>

      <div className="mt-6">
        {tree.length ? <TaskTree nodes={tree} progress={progress} ws={wsMap} showWorkspace={!wsFilter} /> : (
          <div className="rounded-2xl border border-dashed border-line-strong bg-surface/60 p-8 text-center">
            <p className="font-medium">Nothing here yet</p>
            <p className="mt-1 text-sm text-neutral-500">Add a task above, or capture something with the Capture button and sort it from the Inbox.</p>
          </div>
        )}
        {tasks.length >= LIMIT && <p className="mt-3 text-xs text-amber-800">Showing the first {LIMIT} tasks. Use a workspace filter to see the rest.</p>}
      </div>
    </div>
  );
}
