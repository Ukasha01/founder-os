"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { zonedToUtc } from "@/lib/time";
import { isDuplicate } from "@/lib/tasks";

const uuid = z.string().uuid();
const opt = (n: number) => z.string().trim().max(n).optional().transform((v) => v || null);
const optUuid = z.string().uuid().optional().or(z.literal("")).transform((v) => v || null);
const localDt = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use a valid date and time.").optional().or(z.literal("")).transform((v) => v || null);

function go(path: string, error?: string): never {
  revalidatePath("/", "layout");
  redirect(error ? `${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}` : path);
}
async function tzOf(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.from("user_settings").select("timezone").maybeSingle();
  return data?.timezone ?? "Asia/Karachi";
}

export async function createMeeting(formData: FormData) {
  const p = z.object({
    title: z.string().trim().min(1, "Title is required.").max(300),
    workspace_id: optUuid, starts: localDt, ends: localDt, location: opt(300), agenda: opt(10000),
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) go("/meetings", p.error.issues[0].message);
  const d = p.data!;
  const supabase = await createClient();
  const tz = await tzOf(supabase);
  const starts_at = d.starts ? zonedToUtc(d.starts, tz) : null;
  const ends_at = d.ends ? zonedToUtc(d.ends, tz) : null;
  if (starts_at && ends_at && ends_at < starts_at) go("/meetings", "End must be after start.");
  const { data, error } = await supabase.from("meetings").insert({
    title: d.title, workspace_id: d.workspace_id, location: d.location, agenda: d.agenda,
    starts_at: starts_at?.toISOString() ?? null, ends_at: ends_at?.toISOString() ?? null,
  }).select("id").single();
  if (error) go("/meetings", error.message);
  go(`/meetings/${data!.id}`);
}

export async function updateMeeting(formData: FormData) {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) go("/meetings", "Invalid meeting.");
  const back = `/meetings/${id.data}`;
  const p = z.object({
    title: z.string().trim().min(1, "Title is required.").max(300),
    status: z.enum(["scheduled", "held", "cancelled"]),
    starts: localDt, ends: localDt, location: opt(300), agenda: opt(10000), notes: opt(20000), decisions: opt(10000),
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) go(back, p.error.issues[0].message);
  const d = p.data!;
  const supabase = await createClient();
  const tz = await tzOf(supabase);
  const starts_at = d.starts ? zonedToUtc(d.starts, tz) : null;
  const ends_at = d.ends ? zonedToUtc(d.ends, tz) : null;
  if (starts_at && ends_at && ends_at < starts_at) go(back, "End must be after start.");
  const { error } = await supabase.from("meetings").update({
    title: d.title, status: d.status, location: d.location, agenda: d.agenda, notes: d.notes, decisions: d.decisions,
    starts_at: starts_at?.toISOString() ?? null, ends_at: ends_at?.toISOString() ?? null,
  }).eq("id", id.data!);
  go(back, error?.message);
}

export async function deleteMeeting(formData: FormData) {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) go("/meetings", "Invalid meeting.");
  if (formData.get("confirm") !== "yes") go(`/meetings/${id.data}`, "Tick “Confirm delete” first.");
  const supabase = await createClient();
  const { error } = await supabase.from("meetings").update({ deleted_at: new Date().toISOString() }).eq("id", id.data!);
  go(error ? `/meetings/${id.data}` : "/meetings", error?.message);
}

export async function addAttendee(formData: FormData) {
  const p = z.object({ meeting_id: uuid, person_id: uuid }).safeParse(Object.fromEntries(formData));
  if (!p.success) go("/meetings", "Choose a person.");
  const back = `/meetings/${p.data!.meeting_id}`;
  const supabase = await createClient();
  const { error } = await supabase.from("meeting_attendees").insert(p.data!);
  if (error && !isDuplicate(error)) go(back, error.message);
  go(back);
}

export async function removeAttendee(formData: FormData) {
  const p = z.object({ meeting_id: uuid, person_id: uuid }).safeParse(Object.fromEntries(formData));
  if (!p.success) go("/meetings", "Invalid attendee.");
  const supabase = await createClient();
  const { error } = await supabase.from("meeting_attendees").delete()
    .eq("meeting_id", p.data!.meeting_id).eq("person_id", p.data!.person_id);
  go(`/meetings/${p.data!.meeting_id}`, error?.message);
}

// Follow-up task for a meeting (linked back through the title only; keeps tasks independent of meetings).
export async function createMeetingFollowUp(formData: FormData) {
  const p = z.object({
    meeting_id: uuid, title: z.string().trim().min(1, "Title is required.").max(500),
    workspace_id: uuid, deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).transform((v) => v || null),
    client_request_id: uuid,
  }).safeParse(Object.fromEntries(formData));
  const back = `/meetings/${formData.get("meeting_id")}`;
  if (!p.success) go(back, p.error.issues[0].message);
  const d = p.data!;
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").insert({
    workspace_id: d.workspace_id, title: d.title, current_deadline: d.deadline, client_request_id: d.client_request_id,
  });
  if (error && !isDuplicate(error)) go(back, error.message);
  go(back);
}
