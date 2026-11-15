"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { validateWeights, type Weights } from "@/lib/score";

function go(error?: string, ok?: string): never {
  revalidatePath("/", "layout");
  redirect(`/settings${error ? `?error=${encodeURIComponent(error)}` : ok ? `?saved=${encodeURIComponent(ok)}` : ""}`);
}

export async function saveWeights(formData: FormData) {
  const n = (k: string) => Number(formData.get(k));
  const w: Weights = { tasks: n("tasks"), hours: n("hours"), kpis: n("kpis"), habits: n("habits"), planning: n("planning") };
  const bad = validateWeights(w);
  if (bad) go(bad);
  const supabase = await createClient();
  const { error } = await supabase.from("user_settings").update({ scoring_weights: w }).not("owner_id", "is", null);
  go(error?.message, "Score weights saved. Past reviews keep the weights they used.");
}

export async function saveGeneral(formData: FormData) {
  const p = z.object({ timezone: z.string().min(1).max(100), week_starts_on: z.coerce.number().int().min(0).max(6) }).safeParse(Object.fromEntries(formData));
  if (!p.success) go("Invalid settings.");
  try { new Intl.DateTimeFormat("en", { timeZone: p.data!.timezone }); } catch { go("Unknown timezone (example: Asia/Karachi)."); }
  const supabase = await createClient();
  const { error } = await supabase.from("user_settings").update(p.data!).not("owner_id", "is", null);
  go(error?.message, "Settings saved.");
}
