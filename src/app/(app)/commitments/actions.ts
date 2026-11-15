"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isDuplicate } from "@/lib/tasks";

const uuid = z.string().uuid();
const optUuid = z.string().uuid().optional().or(z.literal("")).transform((v) => v || null);
const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.").optional().or(z.literal("")).transform((v) => v || null);

function go(error?: string, qs = ""): never {
  revalidatePath("/", "layout");
  const base = `/commitments${qs}`;
  redirect(error ? `${base}${qs ? "&" : "?"}error=${encodeURIComponent(error)}` : base);
}

// direction: "by_me" = I promised someone, "to_me" = someone promised me. The other party is a person.
export async function createCommitment(formData: FormData) {
  const p = z.object({
    description: z.string().trim().min(1, "Describe the commitment.").max(1000),
    direction: z.enum(["by_me", "to_me"]),
    person_id: uuid.catch(undefined as never),
    due_date: optDate, follow_up_date: optDate, meeting_id: optUuid, workspace_id: optUuid,
    client_request_id: uuid,
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) go(p.error.issues[0].message);
  const d = p.data!;
  if (!d.person_id) go("Choose the other person (add them on the People page first).");
  const supabase = await createClient();
  const { error } = await supabase.from("commitments").insert({
    description: d.description, due_date: d.due_date, follow_up_date: d.follow_up_date,
    meeting_id: d.meeting_id, workspace_id: d.workspace_id, client_request_id: d.client_request_id,
    made_by_person_id: d.direction === "to_me" ? d.person_id : null,
    made_to_person_id: d.direction === "by_me" ? d.person_id : null,
  });
  if (error && !isDuplicate(error)) go(error.message);
  go();
}

export async function setCommitmentStatus(formData: FormData) {
  const p = z.object({ id: uuid, status: z.enum(["pending", "in_progress", "completed", "cancelled"]) }).safeParse(Object.fromEntries(formData));
  if (!p.success) go("Invalid request.");
  const supabase = await createClient();
  const { error } = await supabase.from("commitments").update({ status: p.data!.status }).eq("id", p.data!.id);
  go(error?.message);
}

export async function rescheduleCommitment(formData: FormData) {
  const p = z.object({ id: uuid, due_date: optDate, follow_up_date: optDate }).safeParse(Object.fromEntries(formData));
  if (!p.success) go("Invalid request.");
  const supabase = await createClient();
  const { error } = await supabase.from("commitments").update({ due_date: p.data!.due_date, follow_up_date: p.data!.follow_up_date }).eq("id", p.data!.id);
  go(error?.message);
}

export async function createCommitmentTask(formData: FormData) {
  const p = z.object({ id: uuid, workspace_id: uuid }).safeParse(Object.fromEntries(formData));
  if (!p.success) go("Choose a workspace.");
  const supabase = await createClient();
  const { data: c } = await supabase.from("commitments").select("id, description, due_date, follow_up_date, follow_up_task_id").eq("id", p.data!.id).maybeSingle();
  if (!c) go("Commitment not found.");
  if (c.follow_up_task_id) go("A follow-up task already exists.");
  const { data: t, error } = await supabase.from("tasks").insert({
    workspace_id: p.data!.workspace_id, title: c.description.slice(0, 500),
    current_deadline: c.follow_up_date ?? c.due_date, client_request_id: c.id,
  }).select("id").single();
  if (error && !isDuplicate(error)) go(error.message);
  let taskId = t?.id;
  if (!taskId) {
    const { data: ex } = await supabase.from("tasks").select("id").eq("client_request_id", c.id).maybeSingle();
    taskId = ex?.id;
  }
  if (!taskId) go("Could not create the task.");
  const { error: e2 } = await supabase.from("commitments").update({ follow_up_task_id: taskId }).eq("id", c.id);
  go(e2?.message);
}

export async function deleteCommitment(formData: FormData) {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) go("Invalid request.");
  if (formData.get("confirm") !== "yes") go("Tick “Confirm delete” first.");
  const supabase = await createClient();
  const { error } = await supabase.from("commitments").update({ deleted_at: new Date().toISOString() }).eq("id", id.data!);
  go(error?.message);
}
