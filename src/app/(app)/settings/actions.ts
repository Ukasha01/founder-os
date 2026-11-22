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

// Queues a notification due right now; the once-a-minute scheduler delivers it to every registered device within a minute.
export async function sendTestNotification(): Promise<{ ok: boolean; error?: string; devices?: number }> {
  const supabase = await createClient();
  const { count } = await supabase.from("push_subscriptions").select("id", { count: "exact", head: true });
  const { error } = await supabase.from("reminders").insert({ title: "Test notification", body: "If you can see this on your phone or laptop, reminders work.", remind_at: new Date().toISOString(), kind: "custom", channels: ["in_app", "push"], dedupe_key: `test:${Date.now()}` });
  return error ? { ok: false, error: error.message } : { ok: true, devices: count ?? 0 };
}

export async function listPushDevices(): Promise<{ label: string; received: string | null; sent: string | null }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("push_subscriptions").select("device_label, last_received_at, last_used_at").order("created_at");
  return (data ?? []).map((d) => ({ label: /Android|iPhone|Mobile/i.test(d.device_label ?? "") ? "Phone" : "Laptop/computer", received: d.last_received_at, sent: d.last_used_at }));
}

// ---- Telegram backup channel ----
import { randomBytes } from "node:crypto";
import { tgCall, tgSecret, tgSend, tgToken } from "@/lib/telegram";
import { headers } from "next/headers";

export async function telegramStatus(): Promise<{ configured: boolean; linked: boolean }> {
  const supabase = await createClient();
  const { data } = await supabase.from("telegram_links").select("chat_id").maybeSingle();
  return { configured: !!tgToken(), linked: !!data?.chat_id };
}
export async function startTelegramLink(): Promise<{ ok: boolean; error?: string; code?: string; bot?: string }> {
  const token = tgToken(); if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN is not set in Vercel yet." };
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getClaims(); if (!u?.claims) return { ok: false, error: "Not signed in." };
  const me = await tgCall<{ username?: string }>("getMe"); if (!me.ok) return { ok: false, error: `Telegram says: ${me.description ?? "bot token rejected"}` };
  const h = await headers(); const host = h.get("x-forwarded-host") ?? h.get("host");
  const hook = await tgCall("setWebhook", { url: `https://${host}/api/telegram/webhook`, secret_token: tgSecret(token), allowed_updates: ["message"] });
  if (!hook.ok) return { ok: false, error: `Could not connect the bot: ${hook.description}` };
  const code = randomBytes(5).toString("hex").slice(0, 8).toUpperCase();
  const { error } = await supabase.from("telegram_links").upsert({ owner_id: u.claims.sub, link_code: code, chat_id: null, created_at: new Date().toISOString(), linked_at: null }, { onConflict: "owner_id" });
  return error ? { ok: false, error: error.message } : { ok: true, code, bot: me.result?.username };
}
export async function disconnectTelegram(): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase.from("telegram_links").delete().not("owner_id", "is", null);
  return { ok: !error };
}
export async function testTelegram(): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data } = await supabase.from("telegram_links").select("chat_id").maybeSingle();
  if (!data?.chat_id) return { ok: false, error: "Telegram is not connected." };
  const r = await tgSend(Number(data.chat_id), "Test from Founder OS: if you see this, backup reminders work.");
  return r.ok ? { ok: true } : { ok: false, error: r.description ?? "Telegram refused the message." };
}
