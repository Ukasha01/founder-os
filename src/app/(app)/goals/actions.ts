"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();
const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.").optional().or(z.literal("")).transform((v) => v || null);
const optText = z.string().trim().max(2000).optional().transform((v) => v || null);

function go(error?: string): never {
  revalidatePath("/goals");
  redirect(error ? `/goals?error=${encodeURIComponent(error)}` : "/goals");
}

export async function createGoal(formData: FormData) {
  const p = z.object({
    workspace_id: uuid,
    name: z.string().trim().min(1, "Goal name is required.").max(300),
    description: optText,
    start_date: optDate,
    target_date: optDate,
    success_criteria: optText,
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) go(p.error.issues[0].message);
  const supabase = await createClient();
  const { error } = await supabase.from("goals").insert(p.data!);
  go(error ? (error.code === "23514" ? "Target date cannot be before the start date." : error.message) : undefined);
}

// A milestone must be measurable: a numeric target OR a written way to measure it.
export async function addMilestone(formData: FormData) {
  const p = z.object({
    goal_id: uuid,
    title: z.string().trim().min(1, "Milestone title is required.").max(300),
    target_value: z.string().optional().transform((v) => (v && v.trim() !== "" ? Number(v) : null)),
    unit: z.string().trim().max(40).optional().transform((v) => v || null),
    measure_description: optText,
    due_date: optDate,
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) go(p.error.issues[0].message);
  const d = p.data!;
  if (d.target_value !== null && (!Number.isFinite(d.target_value) || d.target_value <= 0)) go("Target must be a number above 0.");
  if (d.target_value === null && !d.measure_description) go("Make it measurable: add a target number or describe how you will measure it.");
  const supabase = await createClient();
  const { error } = await supabase.from("milestones").insert(d);
  go(error?.message);
}

export async function updateMilestone(formData: FormData) {
  const p = z.object({
    id: uuid,
    current_value: z.string().optional().transform((v) => (v && v.trim() !== "" ? Number(v) : null)),
    status: z.enum(["pending", "in_progress", "achieved", "missed", "cancelled"]),
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) go("Invalid milestone update.");
  const d = p.data!;
  const patch: Record<string, unknown> = { status: d.status };
  if (d.current_value !== null) {
    if (!Number.isFinite(d.current_value) || d.current_value < 0) go("Progress must be a number, 0 or more.");
    patch.current_value = d.current_value;
  }
  patch.achieved_at = d.status === "achieved" ? new Date().toISOString() : null;
  const supabase = await createClient();
  const { error } = await supabase.from("milestones").update(patch).eq("id", d.id);
  go(error?.message);
}

export async function setGoalStatus(formData: FormData) {
  const p = z.object({
    id: uuid,
    status: z.enum(["not_started", "active", "achieved", "paused", "abandoned"]),
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) go("Invalid goal update.");
  const supabase = await createClient();
  const { error } = await supabase.from("goals").update({ status: p.data!.status }).eq("id", p.data!.id);
  go(error?.message);
}

// Soft delete, only with the confirmation box ticked.
export async function deleteGoal(formData: FormData) {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) go("Invalid goal.");
  if (formData.get("confirm") !== "yes") go("Tick “Confirm delete” first.");
  const supabase = await createClient();
  const { error } = await supabase.from("goals").update({ deleted_at: new Date().toISOString() }).eq("id", id.data!);
  go(error?.message);
}
