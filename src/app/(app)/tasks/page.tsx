import Link from "next/link";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { buildTree, type TaskRow } from "@/lib/tasks";
import { PRIORITY_LABEL, input, btnPrimary } from "@/lib/ui";
import { createTask } from "./actions";
import { TaskTree, type Progress } from "./task-tree";

const LIMIT = 1000;

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const wsFilter = z.string().uuid().safeParse(sp.workspace).data;
  const supabase = await createClient();

  const { data: workspaces } = await supabase
    .from("workspaces").select("id, name").is("archived_at", null).order("sort_order");

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

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Tasks{current ? ` · ${current.name}` : ""}</h1>
      {(sp.error || error) && (
        <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{sp.error ?? error?.message}</p>
      )}

      <nav aria-label="Workspace filter" className="mt-3 flex flex-wrap gap-2 text-sm">
        <Link href="/tasks" className={`rounded-full border px-3 py-1 ${!wsFilter ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"}`}>All</Link>
        {workspaces?.map((w) => (
          <Link key={w.id} href={`/tasks?workspace=${w.id}`}
            className={`rounded-full border px-3 py-1 ${wsFilter === w.id ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"}`}>{w.name}</Link>
        ))}
      </nav>

      <form action={createTask} className="mt-5 flex flex-wrap items-end gap-2">
        <input type="hidden" name="client_request_id" value={crypto.randomUUID()} />
        <input type="hidden" name="return_to" value={wsFilter ? `/tasks?workspace=${wsFilter}` : "/tasks"} />
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs">New task
          <input name="title" required maxLength={500} placeholder="What needs doing?" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs">Workspace
          <select name="workspace_id" defaultValue={wsFilter ?? ""} required className={input}>
            <option value="" disabled>Choose…</option>
            {workspaces?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">Priority
          <select name="priority" defaultValue="normal" className={input}>
            {Object.entries(PRIORITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">Deadline
          <input type="date" name="deadline" className={input} />
        </label>
        <button className={btnPrimary}>Add</button>
      </form>

      <div className="mt-6">
        {tree.length ? <TaskTree nodes={tree} progress={progress} /> : <p className="text-neutral-500">No tasks yet. Add one above or convert an Inbox item.</p>}
        {tasks.length >= LIMIT && <p className="mt-3 text-xs text-amber-800">Showing the first {LIMIT} tasks. Use a workspace filter to see the rest.</p>}
      </div>
    </div>
  );
}
