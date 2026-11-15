"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isDuplicate } from "@/lib/tasks";

const uuid = z.string().uuid();
const optionalUuid = z.string().uuid().optional().or(z.literal("")).transform((v) => v || null);
const optionalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).transform((v) => v || null);
const priority = z.enum(["critical", "high", "normal", "low"]).optional().or(z.literal("")).transform((v) => v || null);

function done(error?: string): never {
  revalidatePath("/", "layout");
  redirect(error ? `/inbox?error=${encodeURIComponent(error)}` : "/inbox");
}

const triage = z.object({ id: uuid, workspace_id: optionalUuid, priority, due_date: optionalDate });

// Saves workspace / priority / deadline on the capture without converting it.
export async function saveTriage(formData: FormData) {
  const p = triage.safeParse(Object.fromEntries(formData));
  if (!p.success) done(p.error.issues[0].message);
  const { id, ...fields } = p.data!;
  const supabase = await createClient();
  const { error } = await supabase.from("quick_capture").update(fields).eq("id", id);
  done(error?.message);
}

// Converts a capture into a task. The capture id doubles as the task's client_request_id,
// so converting twice (double click, retry) can never create two tasks.
export async function convertToTask(formData: FormData) {
  const p = triage.safeParse(Object.fromEntries(formData));
  if (!p.success) done(p.error.issues[0].message);
  const { id, workspace_id, priority: prio, due_date } = p.data!;
  if (!workspace_id) done("Choose a workspace before converting to a task.");

  const supabase = await createClient();
  const { data: cap, error: readErr } = await supabase
    .from("quick_capture").select("raw_text, status, parent_task_id").eq("id", id).maybeSingle();
  if (readErr || !cap) done(readErr?.message ?? "Capture not found.");

  const text: string = cap.raw_text.trim();
  const title = text.length > 500 ? text.slice(0, 497) + "…" : text;
  const { data: task, error } = await supabase.from("tasks").insert({
    workspace_id,
    title,
    description: text.length > 500 ? text : null,
    priority: prio ?? "normal",
    current_deadline: due_date,
    parent_task_id: cap.parent_task_id,
    source: "capture",
    client_request_id: id,
  }).select("id").maybeSingle();

  let taskId = task?.id as string | undefined;
  if (error && isDuplicate(error)) {
    const { data: existing } = await supabase.from("tasks").select("id").eq("client_request_id", id).maybeSingle();
    taskId = existing?.id;
  } else if (error) {
    done(error.message);
  }
  if (!taskId) done("Could not confirm the task was saved.");

  const { error: updErr } = await supabase.from("quick_capture").update({
    status: "processed", workspace_id, priority: prio, due_date,
    converted_entity_type: "task", converted_entity_id: taskId,
  }).eq("id", id);
  if (updErr) done(updErr.message);
  redirect(`/tasks/${taskId}`);
}

export async function archiveCapture(formData: FormData) {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) done("Invalid item.");
  const supabase = await createClient();
  const { error } = await supabase.from("quick_capture").update({ status: "archived" }).eq("id", id.data!);
  done(error?.message);
}

// Soft delete, and only with the explicit confirmation box ticked.
export async function deleteCapture(formData: FormData) {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) done("Invalid item.");
  if (formData.get("confirm") !== "yes") done("Tick “Confirm delete” first.");
  const supabase = await createClient();
  const { error } = await supabase.from("quick_capture").update({ deleted_at: new Date().toISOString() }).eq("id", id.data!);
  done(error?.message);
}
