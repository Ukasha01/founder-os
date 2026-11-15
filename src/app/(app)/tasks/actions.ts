"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isDuplicate } from "@/lib/tasks";

const uuid = z.string().uuid();
const optionalUuid = z.string().uuid().optional().or(z.literal("")).transform((v) => v || null);
const optionalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.").optional().or(z.literal("")).transform((v) => v || null);
const status = z.enum(["not_started", "in_progress", "waiting", "completed", "cancelled"]);
const priority = z.enum(["critical", "high", "normal", "low"]);

// Only same-site paths under /tasks are accepted as redirect targets.
function safePath(v: FormDataEntryValue | null, fallback: string): string {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/tasks") && !s.includes("//") ? s : fallback;
}
function go(path: string, error?: string): never {
  revalidatePath("/", "layout");
  const sep = path.includes("?") ? "&" : "?";
  redirect(error ? `${path}${sep}error=${encodeURIComponent(error)}` : path);
}

export async function createTask(formData: FormData) {
  const back = safePath(formData.get("return_to"), "/tasks");
  const p = z.object({
    title: z.string().trim().min(1, "Title is required.").max(500, "Title is too long."),
    workspace_id: optionalUuid,
    parent_task_id: optionalUuid,
    priority: priority.default("normal"),
    deadline: optionalDate,
    client_request_id: uuid,
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) go(back, p.error.issues[0].message);
  const d = p.data!;

  const supabase = await createClient();
  let workspace_id = d.workspace_id;
  if (d.parent_task_id) {
    // A subtask always lives in its parent's workspace.
    const { data: parent } = await supabase.from("tasks").select("workspace_id").eq("id", d.parent_task_id).maybeSingle();
    if (!parent) go(back, "Parent task not found.");
    workspace_id = parent.workspace_id;
  }
  if (!workspace_id) go(back, "Choose a workspace.");

  const { error } = await supabase.from("tasks").insert({
    workspace_id, parent_task_id: d.parent_task_id, title: d.title, priority: d.priority,
    current_deadline: d.deadline, client_request_id: d.client_request_id,
  });
  if (error && !isDuplicate(error)) go(back, error.message);
  go(back);
}

// Status/priority/title changes. Nothing here (or in the database) changes status because of dates.
export async function updateTask(formData: FormData) {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) go("/tasks", "Invalid task.");
  const back = `/tasks/${id.data}`;
  const patch: Record<string, string | number | null> = {};
  const s = status.safeParse(formData.get("status"));
  const pr = priority.safeParse(formData.get("priority"));
  const t = z.string().trim().min(1).max(500).safeParse(formData.get("title"));
  if (s.success) patch.status = s.data;
  if (pr.success) patch.priority = pr.data;
  if (t.success) patch.title = t.data;
  // Estimated duration in minutes; blank clears it.
  const est = formData.get("estimated_minutes");
  if (typeof est === "string") {
    if (est.trim() === "") patch.estimated_minutes = null;
    else {
      const n = Number(est);
      if (!Number.isInteger(n) || n < 0 || n > 100000) go(back, "Estimate must be a whole number of minutes.");
      patch.estimated_minutes = n;
    }
  }
  if (!Object.keys(patch).length) go(back, "Nothing to update.");
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").update(patch).eq("id", id.data!);
  go(back, error?.message);
}

// Moves the current deadline; the original deadline is kept and the change is logged with the reason.
export async function rescheduleTask(formData: FormData) {
  const id = uuid.safeParse(formData.get("id"));
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a new date.").safeParse(formData.get("new_deadline"));
  if (!id.success) go("/tasks", "Invalid task.");
  const back = `/tasks/${id.data}`;
  if (!date.success) go(back, date.error.issues[0].message);
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500) || null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("reschedule_task", {
    p_task_id: id.data, p_new_deadline: date.data, p_reason: reason,
  });
  go(back, error?.message);
}

export async function addTimeEntry(formData: FormData) {
  const p = z.object({
    task_id: uuid,
    minutes: z.coerce.number().int("Whole minutes only.").min(1, "Enter at least 1 minute.").max(1440, "A day has 1,440 minutes."),
    note: z.string().trim().max(500).optional(),
    client_request_id: uuid,
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) go("/tasks", p.error.issues[0].message);
  const d = p.data!;
  const back = `/tasks/${d.task_id}`;
  const supabase = await createClient();
  const { data: task } = await supabase.from("tasks").select("workspace_id").eq("id", d.task_id).maybeSingle();
  if (!task) go(back, "Task not found.");
  const { error } = await supabase.from("time_entries").insert({
    task_id: d.task_id, workspace_id: task.workspace_id, duration_minutes: d.minutes,
    note: d.note || null, source: "manual", client_request_id: d.client_request_id,
  });
  if (error && !isDuplicate(error)) go(back, error.message);
  go(back);
}

export async function moveTask(formData: FormData) {
  const id = uuid.safeParse(formData.get("id"));
  const ws = uuid.safeParse(formData.get("workspace_id"));
  if (!id.success || !ws.success) go("/tasks", "Choose a workspace.");
  const back = `/tasks/${id.data}`;
  const supabase = await createClient();
  const { error } = await supabase.rpc("move_task_to_workspace", { p_task_id: id.data, p_workspace_id: ws.data });
  go(back, error?.message);
}

// Soft-deletes the task and its whole subtree, only after explicit confirmation.
export async function deleteTask(formData: FormData) {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) go("/tasks", "Invalid task.");
  const back = `/tasks/${id.data}`;
  if (formData.get("confirm") !== "yes") go(back, "Tick “Confirm delete” first.");
  const supabase = await createClient();
  const { data: subtree, error: e1 } = await supabase.rpc("get_task_subtree", { p_root: id.data });
  if (e1) go(back, e1.message);
  const ids: string[] = (subtree ?? []).map((r: { id: string }) => r.id);
  if (!ids.length) go("/tasks", "Task not found.");
  const { error } = await supabase.from("tasks").update({ deleted_at: new Date().toISOString() }).in("id", ids);
  if (error) go(back, error.message);
  go("/tasks");
}
