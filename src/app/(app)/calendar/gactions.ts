"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { googleClient } from "@/lib/gcal-server";
import { syncGoogle } from "@/lib/gcal-sync";
import { buildUserEvent, normalizeEvent } from "@/lib/gcal-view";
import { zonedToUtc } from "@/lib/time";

export type CalResult = { ok: true } | { ok: false; error: string };

const local = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Enter a valid date and time.");
const Input = z.object({
  id: z.string().min(1).max(200).optional(),
  title: z.string().trim().min(1, "Title is required.").max(300),
  notes: z.string().max(4000).default(""),
  allDay: z.boolean(),
  startLocal: local,
  endLocal: local.or(z.literal("")).default(""),
});
export type CalInput = z.input<typeof Input>;

async function context() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return null;
  const { data: s } = await supabase.from("user_settings").select("timezone").maybeSingle();
  return { supabase, owner: data.claims.sub as string, tz: s?.timezone ?? "Asia/Karachi" };
}

// Re-runs the mirror straight away so an edited reminder shows its new time at once instead of up to a minute later.
async function syncNow(owner: string, tz: string, client: Parameters<typeof syncGoogle>[1]) {
  const db = createAdminClient();
  if (db) await syncGoogle(db, client, new Date(), process.env.NEXT_PUBLIC_APP_URL ?? "", new Map([[owner, tz]])).catch(() => undefined);
}

export async function saveEvent(raw: CalInput): Promise<CalResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  const g = googleClient();
  if (!g.ok) return { ok: false, error: `Google Calendar is not connected: ${g.reason}` };
  const p = Input.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const d = p.data;
  const endLocal = d.endLocal || d.startLocal;
  if (!d.allDay && zonedToUtc(endLocal, ctx.tz) <= zonedToUtc(d.startLocal, ctx.tz)) return { ok: false, error: "The end must be after the start." };

  if (!d.id) {
    const r = await g.client.create(buildUserEvent({ title: d.title, notes: d.notes, allDay: d.allDay, startLocal: d.startLocal, endLocal, tz: ctx.tz }));
    if (!r.ok) return { ok: false, error: r.message };
    revalidatePath("/calendar");
    return { ok: true };
  }

  const cur = await g.client.get(d.id);
  if (!cur.ok) return { ok: false, error: cur.message };
  const ev = normalizeEvent(cur.item, ctx.tz);
  if (ev?.source === "task") return { ok: false, error: "This event comes from a task. Change its due date or time on the task itself." };
  if (ev?.source === "reminder" && ev.sourceId) {
    const at = zonedToUtc(d.startLocal, ctx.tz);
    if (at.getTime() <= Date.now()) return { ok: false, error: "That time has already passed." };
    const { error } = await ctx.supabase.from("reminders").update({ title: d.title.replace(/^⏰\s*/, ""), remind_at: at.toISOString(), status: "pending", attempts: 0, sent_at: null, acked_at: null, next_nag_at: null, nag_count: 0, last_error: null }).eq("id", ev.sourceId);
    if (error) return { ok: false, error: error.message };
    await syncNow(ctx.owner, ctx.tz, g.client);
    revalidatePath("/calendar");
    return { ok: true };
  }
  const r = await g.client.patch(d.id, buildUserEvent({ title: d.title, notes: d.notes, allDay: d.allDay, startLocal: d.startLocal, endLocal, tz: ctx.tz }));
  if (!r.ok) return { ok: false, error: r.message };
  revalidatePath("/calendar");
  return { ok: true };
}

export async function deleteEvent(id: string): Promise<CalResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  const g = googleClient();
  if (!g.ok) return { ok: false, error: `Google Calendar is not connected: ${g.reason}` };
  if (!id || id.length > 200) return { ok: false, error: "Invalid event." };
  const cur = await g.client.get(id);
  if (cur.ok) {
    const ev = normalizeEvent(cur.item, ctx.tz);
    if (ev?.source === "task") return { ok: false, error: "This event comes from a task. Remove or complete the task instead." };
    if (ev?.source === "reminder" && ev.sourceId) {
      const { error } = await ctx.supabase.from("reminders").delete().eq("id", ev.sourceId);
      if (error) return { ok: false, error: error.message };
      await syncNow(ctx.owner, ctx.tz, g.client);
      revalidatePath("/calendar");
      return { ok: true };
    }
  }
  const r = await g.client.remove(id);
  if (!r.ok) return { ok: false, error: r.message };
  revalidatePath("/calendar");
  return { ok: true };
}
