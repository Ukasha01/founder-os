"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();
function go(error?: string): never {
  revalidatePath("/", "layout");
  redirect(error ? `/time?error=${encodeURIComponent(error)}` : "/time");
}

// Only one timer can run at a time (enforced by the database too).
export async function startTimer(formData: FormData) {
  const p = z.object({
    task_id: z.string().uuid().optional().or(z.literal("")).transform((v) => v || null),
    workspace_id: z.string().uuid().optional().or(z.literal("")).transform((v) => v || null),
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) go("Invalid timer request.");
  const supabase = await createClient();
  let workspace_id = p.data!.workspace_id;
  if (p.data!.task_id) {
    const { data: t } = await supabase.from("tasks").select("workspace_id").eq("id", p.data!.task_id).maybeSingle();
    if (!t) go("Task not found.");
    workspace_id = t.workspace_id;
  }
  if (!workspace_id) go("Choose a task or a workspace to track time against.");
  const { error } = await supabase.from("time_entries").insert({
    workspace_id, task_id: p.data!.task_id, started_at: new Date().toISOString(), source: "timer",
  });
  if (error) go(error.code === "23505" ? "A timer is already running. Stop it first." : error.message);
  go();
}

// Stopping fills in the end time; the database computes the duration.
export async function stopTimer(formData: FormData) {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) go("Invalid timer.");
  const supabase = await createClient();
  const { error } = await supabase.from("time_entries")
    .update({ ended_at: new Date().toISOString() }).eq("id", id.data!).is("ended_at", null);
  go(error?.message);
}

export async function logManual(formData: FormData) {
  const p = z.object({
    workspace_id: uuid,
    minutes: z.coerce.number().int("Whole minutes only.").min(1, "Enter at least 1 minute.").max(1440, "A day has 1,440 minutes."),
    note: z.string().trim().max(500).optional().transform((v) => v || null),
    client_request_id: uuid,
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) go(p.error.issues[0].message);
  const supabase = await createClient();
  const { error } = await supabase.from("time_entries").insert({
    workspace_id: p.data!.workspace_id, duration_minutes: p.data!.minutes, note: p.data!.note,
    source: "manual", client_request_id: p.data!.client_request_id,
  });
  if (error && error.code !== "23505") go(error.message);
  go();
}
