"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export async function saveWeekly(formData: FormData) {
  const p = z.object({
    week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), complete: z.string().optional(), summary: z.string().max(5000),
    wins: z.string().trim().max(5000).optional(), challenges: z.string().trim().max(5000).optional(), next_week_focus: z.string().trim().max(5000).optional(),
  }).safeParse(Object.fromEntries(formData));
  const back = `/review/weekly?week=${formData.get("week_start")}`;
  if (!p.success) redirect(`${back}&error=${encodeURIComponent("Invalid review.")}`);
  const d = p.data!;
  let summary: unknown = {};
  try { summary = JSON.parse(d.summary); } catch { /* keep empty */ }
  const supabase = await createClient();
  const row: Record<string, unknown> = { week_start: d.week_start, wins: d.wins || null, challenges: d.challenges || null, next_week_focus: d.next_week_focus || null };
  if (d.complete === "yes") { row.completed_at = new Date().toISOString(); row.summary = summary; }
  const { error } = await supabase.from("weekly_reviews").upsert(row, { onConflict: "owner_id,week_start" });
  revalidatePath("/review/weekly");
  redirect(error ? `${back}&error=${encodeURIComponent(error.message)}` : back);
}
