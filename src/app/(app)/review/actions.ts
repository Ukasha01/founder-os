"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loadDay } from "@/lib/dayscore";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
function go(path: string, error?: string): never {
  revalidatePath("/", "layout");
  redirect(error ? `${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}` : path);
}

export async function markPlanned(formData: FormData) {
  const d = date.safeParse(formData.get("date"));
  if (!d.success) go("/review", "Invalid date.");
  const back = `/review?date=${d.data}`;
  const supabase = await createClient();
  const { error } = await supabase.from("daily_reviews").upsert({ review_date: d.data, plan_completed_at: new Date().toISOString() }, { onConflict: "owner_id,review_date" });
  go(back, error?.message);
}

// Saves the reflection and, when completing, freezes the score with the weights used that day.
export async function saveReview(formData: FormData) {
  const p = z.object({
    date, complete: z.string().optional(),
    wins: z.string().trim().max(5000).optional(), blockers: z.string().trim().max(5000).optional(), tomorrow_plan: z.string().trim().max(5000).optional(),
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) go("/review", "Invalid review.");
  const d = p.data!;
  const back = `/review?date=${d.date}`;
  const supabase = await createClient();
  const row: Record<string, unknown> = { review_date: d.date, wins: d.wins || null, blockers: d.blockers || null, tomorrow_plan: d.tomorrow_plan || null };
  if (d.complete === "yes") {
    row.review_completed_at = new Date().toISOString();
    // First persist completion so the score sees it, then compute and snapshot.
    const { error: e0 } = await supabase.from("daily_reviews").upsert(row, { onConflict: "owner_id,review_date" });
    if (e0) go(back, e0.message);
    const day = await loadDay(supabase, d.date);
    const { error } = await supabase.from("daily_reviews").update({
      score_total: day.result.total, score_breakdown: day.result.categories, weights_snapshot: day.weights,
      planned_minutes: day.input.plannedMinutes, actual_minutes: day.input.actualMinutes,
      rescheduled_count: day.input.tasksRescheduled, cancelled_count: day.input.tasksCancelled,
    }).eq("review_date", d.date);
    go(back, error?.message);
  }
  const { error } = await supabase.from("daily_reviews").upsert(row, { onConflict: "owner_id,review_date" });
  go(back, error?.message);
}
