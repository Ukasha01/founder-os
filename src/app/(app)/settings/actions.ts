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

// Stores this device's Web Push subscription (from the browser) so reminders can reach it.
const sub = z.object({
  endpoint: z.string().url().max(2000).refine((u) => u.startsWith("https://"), "Push endpoint must be https."),
  p256dh: z.string().min(10).max(500), auth: z.string().min(5).max(500), label: z.string().max(100).optional(),
});
export async function savePushSubscription(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const p = sub.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("push_subscriptions").upsert(
    { endpoint: p.data.endpoint, p256dh: p.data.p256dh, auth_secret: p.data.auth, device_label: p.data.label ?? null }, { onConflict: "endpoint" });
  return error ? { ok: false, error: error.message } : { ok: true };
}
export async function removePushSubscription(endpoint: string): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  return { ok: !error };
}

export async function markNotificationsRead() {
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  revalidatePath("/", "layout");
}
