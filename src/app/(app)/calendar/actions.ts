"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { WEEKDAY_KEYS, zonedToUtc } from "@/lib/time";

const uuid = z.string().uuid();
const dtLocal = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Enter a valid date and time.");

function go(back: string, error?: string): never {
  revalidatePath("/calendar");
  const safe = back.startsWith("/calendar") && !back.includes("//") ? back : "/calendar";
  const sep = safe.includes("?") ? "&" : "?";
  redirect(error ? `${safe}${sep}error=${encodeURIComponent(error)}` : safe);
}

export async function createEvent(formData: FormData) {
  const back = String(formData.get("return_to") ?? "/calendar");
  const p = z.object({
    title: z.string().trim().min(1, "Title is required.").max(300),
    event_type: z.enum(["meeting", "class", "appointment", "time_block", "other"]),
    workspace_id: z.string().uuid().optional().or(z.literal("")).transform((v) => v || null),
    start: dtLocal,
    end: dtLocal.optional().or(z.literal("")).transform((v) => v || null),
    is_fixed: z.string().optional(),
    client_request_id: uuid,
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) go(back, p.error.issues[0].message);
  const d = p.data!;

  const supabase = await createClient();
  const { data: s } = await supabase.from("user_settings").select("timezone").maybeSingle();
  const tz = s?.timezone ?? "Asia/Karachi";
  const start = zonedToUtc(d.start, tz);
  const end = d.end ? zonedToUtc(d.end, tz) : null;
  if (end && end < start) go(back, "The end must be after the start.");

  const { error } = await supabase.from("calendar_events").insert({
    title: d.title, event_type: d.event_type, workspace_id: d.workspace_id,
    start_at: start.toISOString(), end_at: end?.toISOString() ?? null,
    is_fixed: d.is_fixed === "on", client_request_id: d.client_request_id,
  });
  if (error && error.code !== "23505") go(back, error.message);
  go(back);
}

// Events created from meetings are edited on the meeting (Phase 3), so only standalone ones are removable here.
export async function deleteEvent(formData: FormData) {
  const back = String(formData.get("return_to") ?? "/calendar");
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) go(back, "Invalid event.");
  if (formData.get("confirm") !== "yes") go(back, "Tick “Confirm delete” first.");
  const supabase = await createClient();
  const { error } = await supabase.from("calendar_events")
    .update({ deleted_at: new Date().toISOString() }).eq("id", id.data!).is("meeting_id", null);
  go(back, error?.message);
}

// Available working hours per weekday. Empty = not configured, so no overload warnings are shown.
export async function saveCapacity(formData: FormData) {
  const back = String(formData.get("return_to") ?? "/calendar");
  const capacity: Record<string, number> = {};
  for (const k of WEEKDAY_KEYS) {
    const raw = String(formData.get(k) ?? "").trim();
    if (raw === "") continue;
    const h = Number(raw);
    if (!Number.isFinite(h) || h < 0 || h > 24) go(back, "Hours must be between 0 and 24.");
    capacity[k] = Math.round(h * 60);
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) go(back, "Not signed in.");
  const { error } = await supabase.from("user_settings").update({ daily_capacity_minutes: capacity }).eq("owner_id", user.id);
  go(back, error?.message);
}
