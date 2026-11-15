"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { dateInTz } from "@/lib/time";
import { materializeRecurring } from "@/lib/materialize";

const uuid = z.string().uuid();
function go(error?: string): never {
  revalidatePath("/", "layout");
  redirect(error ? `/recurring?error=${encodeURIComponent(error)}` : "/recurring");
}
async function today() {
  const supabase = await createClient();
  const { data } = await supabase.from("user_settings").select("timezone").maybeSingle();
  return { supabase, today: dateInTz(new Date(), data?.timezone ?? "Asia/Karachi") };
}

export async function createRule(formData: FormData) {
  const wd = formData.getAll("weekdays").map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  const times = String(formData.get("times") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (times.some((t) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) go("Times must look like 09:00, 18:30 (comma separated).");
  const p = z.object({
    workspace_id: uuid, title: z.string().trim().min(1, "Title is required.").max(300),
    freq: z.enum(["daily", "weekly", "monthly"]), interval_count: z.coerce.number().int().min(1).max(365),
    monthday: z.coerce.number().int().min(1).max(31).optional().or(z.literal("")),
    priority: z.enum(["critical", "high", "normal", "low"]),
    estimated_minutes: z.coerce.number().int().min(0).max(100000).optional().or(z.literal("")),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a start date."),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) go(p.error.issues[0].message);
  const d = p.data!;
  if (d.end_date && d.end_date < d.start_date) go("End date must not be before the start date.");
  const { supabase, today: t } = await today();
  const { error } = await supabase.from("recurrence_rules").insert({
    workspace_id: d.workspace_id, name: d.title, target_kind: "task", freq: d.freq, interval_count: d.interval_count,
    by_weekday: d.freq === "weekly" && wd.length ? wd : null,
    by_monthday: d.freq === "monthly" && d.monthday ? [Number(d.monthday)] : null,
    times_of_day: times.length ? times : null, start_date: d.start_date, end_date: d.end_date || null,
    template: { title: d.title, priority: d.priority, estimated_minutes: d.estimated_minutes === "" || d.estimated_minutes === undefined ? null : Number(d.estimated_minutes) },
  });
  if (error) go(error.message);
  await materializeRecurring(supabase, t);
  go();
}

export async function setPaused(formData: FormData) {
  const p = z.object({ id: uuid, paused: z.enum(["true", "false"]) }).safeParse(Object.fromEntries(formData));
  if (!p.success) go("Invalid request.");
  const { supabase, today: t } = await today();
  const { error } = await supabase.from("recurrence_rules").update({ is_paused: p.data!.paused === "true" }).eq("id", p.data!.id);
  if (error) go(error.message);
  if (p.data!.paused === "false") await materializeRecurring(supabase, t); // resume: from today forward, no back-fill
  go();
}

export async function deleteRule(formData: FormData) {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) go("Invalid rule.");
  if (formData.get("confirm") !== "yes") go("Tick “Confirm delete” first. Tasks already created are kept.");
  const supabase = await createClient();
  // Detach created tasks first (keeps them), then remove the rule.
  const { error: e1 } = await supabase.from("tasks").update({ recurrence_rule_id: null, occurrence_date: null }).eq("recurrence_rule_id", id.data!);
  if (e1) go(e1.message);
  const { error } = await supabase.from("recurrence_rules").delete().eq("id", id.data!);
  go(error?.message);
}

// Skip one occurrence: cancel that task (excluded from the score) and remember so it is not regenerated.
export async function skipOccurrence(formData: FormData) {
  const id = uuid.safeParse(formData.get("task_id"));
  if (!id.success) go("Invalid task.");
  const supabase = await createClient();
  const { data: t } = await supabase.from("tasks").select("recurrence_rule_id, occurrence_date, occurrence_index").eq("id", id.data!).maybeSingle();
  if (!t?.recurrence_rule_id || !t.occurrence_date) go("That task is not a recurring occurrence.");
  const { error: e1 } = await supabase.from("recurrence_exceptions").upsert(
    { rule_id: t.recurrence_rule_id, occurrence_date: t.occurrence_date, occurrence_index: t.occurrence_index, kind: "skipped" },
    { onConflict: "rule_id,occurrence_date,occurrence_index" });
  if (e1) go(e1.message);
  const { error } = await supabase.from("tasks").update({ status: "cancelled" }).eq("id", id.data!);
  go(error?.message);
}
