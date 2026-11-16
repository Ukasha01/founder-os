import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { STATUS_LABEL, PRIORITY_LABEL, STATUS_STYLE, PRIORITY_STYLE, badge, formatMinutes, input, card, wsStyle } from "@/lib/ui";
import { addTimeEntry, createTask, deleteTask, moveTask, rescheduleTask, updateTask } from "../actions";
import { SubmitButton } from "@/components/submit-button";

type Activity = { id: string; action: string; field: string | null; old_value: unknown; new_value: unknown; reason: string | null; source: string; created_at: string };

function describe(a: Activity): string {
  const fmt = (v: unknown) => (v === null || v === undefined ? "none" : typeof v === "object" ? JSON.stringify(v) : String(v));
  if (a.action === "created") return "Task created";
  if (a.action === "rescheduled") return `Deadline moved from ${fmt(a.old_value)} to ${fmt(a.new_value)}`;
  if (a.action === "deleted") return "Deleted";
  if (a.action === "restored") return "Restored";
  return `${a.field} changed from ${fmt(a.old_value)} to ${fmt(a.new_value)}`;
}

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();

  const { data: task } = await supabase.from("task_overview").select("*").eq("id", id).maybeSingle();
  if (!task) notFound();

  const [{ data: children }, { data: parent }, { data: workspaces }, { data: entries }, { data: activity }, { data: prog }] =
    await Promise.all([
      supabase.from("task_overview").select("id, title, status, priority, current_deadline, is_overdue, child_count")
        .eq("parent_task_id", id).order("created_at"),
      task.parent_task_id
        ? supabase.from("tasks").select("id, title").eq("id", task.parent_task_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("workspaces").select("id, name, color").is("archived_at", null).order("sort_order"),
      supabase.from("time_entries").select("id, duration_minutes, entry_date, note").eq("task_id", id)
        .order("entry_date", { ascending: false }).limit(20),
      supabase.from("task_activity").select("id, action, field, old_value, new_value, reason, source, created_at")
        .eq("task_id", id).order("created_at", { ascending: false }).limit(50),
      supabase.rpc("get_task_progress", { p_task_ids: [id] }),
    ]);

  const progress = (prog as { progress_percent: number }[] | null)?.[0]?.progress_percent;
  const back = `/tasks/${id}`;
  const ws = workspaces?.find((w) => w.id === task.workspace_id);
  const wsName = ws?.name ?? "Workspace";
  const c = wsStyle(ws?.color);

  return (
    <div className="max-w-3xl">
      <p className="text-sm text-neutral-500">
        <Link href="/tasks" className="underline">Tasks</Link>
        {parent && <> / <Link href={`/tasks/${parent.id}`} className="underline">{parent.title}</Link></>}
      </p>
      <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.02em]">{task.title}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={`${badge} ${c.tint} ${c.ink}`}><span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${c.dot}`} />{wsName}</span>
        <span className={`${badge} ${STATUS_STYLE[task.status]}`}>{STATUS_LABEL[task.status]}</span>
        <span className={`${badge} ${PRIORITY_STYLE[task.priority]}`}>{PRIORITY_LABEL[task.priority]}</span>
        {task.current_deadline && <span className={`${badge} ${task.is_overdue ? "bg-rose-100 text-rose-800" : "bg-neutral-100 text-neutral-600"}`}>{task.is_overdue ? "Overdue " : "Due "}{task.current_deadline}</span>}
      </div>
      {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}

      <section className={`${card} mt-5 border-l-4 ${c.edge}`}>
        <form action={updateTask} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={id} />
          <label className="flex flex-col gap-1 text-xs">Status
            <select name="status" defaultValue={task.status} className={input}>
              {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">Priority
            <select name="priority" defaultValue={task.priority} className={input}>
              {Object.entries(PRIORITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs">Title
            <input name="title" defaultValue={task.title} maxLength={500} className={input} />
          </label>
          <label className="flex flex-col gap-1 text-xs">Estimate (min)
            <input type="number" name="estimated_minutes" min={0} defaultValue={task.estimated_minutes ?? ""} className={`${input} w-28`} />
          </label>
          <SubmitButton variant="primary">Save</SubmitButton>
        </form>
        <p className="mt-3 text-sm text-neutral-600">
          {task.child_count > 0 && <>Subtasks: {task.child_count}{progress !== undefined && progress !== null ? ` · ${progress}% of subtasks done` : ""} · </>}
          {task.estimated_minutes ? <>Estimated: {formatMinutes(task.estimated_minutes)} · </> : null}Logged: {formatMinutes(task.actual_minutes)}
        </p>
      </section>

      <section className={`${card} mt-4`}>
        <h2 className="font-medium">Deadline</h2>
        <p className={`text-sm ${task.is_overdue ? "font-medium text-red-700" : "text-neutral-600"}`}>
          {task.current_deadline ? `${task.is_overdue ? "Overdue · " : ""}Due ${task.current_deadline}` : "No deadline set"}
          {task.original_deadline && task.original_deadline !== task.current_deadline && (
            <span className="text-neutral-500"> (originally {task.original_deadline})</span>
          )}
        </p>
        {task.is_overdue && <p className="text-xs text-neutral-500">Being overdue never changes the task&apos;s status. You decide.</p>}
        <form action={rescheduleTask} className="mt-2 flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={id} />
          <label className="flex flex-col gap-1 text-xs">{task.current_deadline ? "Reschedule to" : "Set deadline"}
            <input type="date" name="new_deadline" required className={input} />
          </label>
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs">Reason (optional)
            <input name="reason" maxLength={500} className={input} />
          </label>
          <SubmitButton variant="secondary">{task.current_deadline ? "Reschedule" : "Set"}</SubmitButton>
        </form>
      </section>

      <section className={`${card} mt-4`}>
        <h2 className="font-medium">Subtasks</h2>
        <ul className="mt-2 flex flex-col gap-1.5">
          {children?.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-tint px-3 py-2 text-sm">
              <Link href={`/tasks/${c.id}`} className="font-medium hover:underline">{c.title}</Link>
              <span className={`${badge} ${STATUS_STYLE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
              {c.child_count > 0 && <span className="text-xs text-neutral-500">{c.child_count} subtasks</span>}
              {c.current_deadline && <span className={`${badge} ${c.is_overdue ? "bg-rose-100 text-rose-800" : "bg-neutral-100 text-neutral-600"}`}>{c.is_overdue ? "Overdue " : "Due "}{c.current_deadline}</span>}
            </li>
          ))}
          {!children?.length && <li className="text-sm text-neutral-500">No subtasks yet.</li>}
        </ul>
        <form action={createTask} className="mt-3 flex gap-2">
          <input type="hidden" name="client_request_id" value={crypto.randomUUID()} />
          <input type="hidden" name="parent_task_id" value={id} />
          <input type="hidden" name="return_to" value={back} />
          <input name="title" required maxLength={500} placeholder="Add a subtask" aria-label="Add a subtask" className={`${input} flex-1`} />
          <SubmitButton variant="secondary">Add</SubmitButton>
        </form>
      </section>

      <details className={`${card} mt-4`}>
        <summary className="cursor-pointer font-medium">Time <span className="font-normal text-neutral-500">· {formatMinutes(task.actual_minutes)} logged</span></summary>
        <form action={addTimeEntry} className="mt-2 flex flex-wrap items-end gap-2">
          <input type="hidden" name="task_id" value={id} />
          <input type="hidden" name="client_request_id" value={crypto.randomUUID()} />
          <label className="flex flex-col gap-1 text-xs">Minutes worked
            <input type="number" name="minutes" min={1} max={1440} required className={`${input} w-28`} />
          </label>
          <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs">Note (optional)
            <input name="note" maxLength={500} className={input} />
          </label>
          <SubmitButton variant="secondary">Log time</SubmitButton>
        </form>
        <ul className="mt-3 text-sm text-neutral-600">
          {entries?.map((e) => (
            <li key={e.id}>{e.entry_date} · {formatMinutes(e.duration_minutes ?? 0)}{e.note ? ` · ${e.note}` : ""}</li>
          ))}
        </ul>
      </details>

      <details className={`${card} mt-4`}>
        <summary className="cursor-pointer font-medium">History</summary>
        <ul className="mt-2 flex flex-col gap-1 text-sm text-neutral-600">
          {(activity as Activity[] | null)?.map((a) => (
            <li key={a.id}>
              <span className="text-xs text-neutral-400">{new Date(a.created_at).toLocaleString("en-GB", { timeZone: "Asia/Karachi" })}</span>{" "}
              {describe(a)}{a.reason ? ` — ${a.reason}` : ""}
            </li>
          ))}
        </ul>
      </details>

      <details className={`${card} mt-4`}>
        <summary className="cursor-pointer font-medium">Move or delete</summary>
        <div className="mt-3 flex flex-wrap items-end gap-6">
        <form action={moveTask} className="flex items-end gap-2">
          <input type="hidden" name="id" value={id} />
          <label className="flex flex-col gap-1 text-xs">Move to workspace (with its subtasks)
            <select name="workspace_id" defaultValue={task.workspace_id} className={input}>
              {workspaces?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <SubmitButton variant="secondary">Move</SubmitButton>
        </form>
        <form action={deleteTask} className="flex items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="confirm" value="yes" /> Confirm delete (includes subtasks)</label>
          <SubmitButton variant="secondary">Delete</SubmitButton>
        </form>
        </div>
      </details>
    </div>
  );
}
