import type { SupabaseClient } from "@supabase/supabase-js";
import type { GcalClient } from "./gcal.ts";
import { normalizeEvent } from "./gcal-view.ts";
import { timeInTz } from "./time.ts";

// Events made in Google Calendar itself (phone, web) never pass through the app, so nothing here would alert you about them.
// Each minute we look at the next 36 hours and give every such event an ordinary Founder OS reminder at its start time,
// which then reaches the laptop, the phone, email and the nag-until-done buttons like any other reminder.
// Moved or deleted events cancel their pending reminder. Items the app mirrored itself (reminders, tasks) are skipped.
export type PullStats = { created: number; cancelled: number; failed: number };

export async function pullGoogleAlerts(db: SupabaseClient, gc: GcalClient, now: Date, owner: string, tz: string, channels: string[]): Promise<PullStats> {
  const st: PullStats = { created: 0, cancelled: 0, failed: 0 };
  const from = new Date(now.getTime() - 2 * 60_000), to = new Date(now.getTime() + 36 * 3600_000);
  const r = await gc.list(from.toISOString(), to.toISOString());
  if (!r.ok) { st.failed++; return st; }
  const wanted = new Map<string, { title: string; start: Date }>();
  for (const raw of r.items) {
    const ev = normalizeEvent(raw, tz);
    if (!ev || ev.allDay || ev.source || !raw.start?.dateTime) continue;
    const start = new Date(raw.start.dateTime);
    if (start < from || start > to) continue;
    wanted.set(`gcal:${ev.id}:${start.getTime()}`, { title: ev.title, start });
  }
  for (const [key, w] of wanted) {
    const { error } = await db.from("reminders").insert({ owner_id: owner, kind: "custom", title: w.title, body: `Calendar event at ${timeInTz(w.start, tz)}`, remind_at: w.start.toISOString(), channels, dedupe_key: key });
    if (!error) st.created++; else if (error.code !== "23505") st.failed++;
  }
  const { data: pending } = await db.from("reminders").select("id, dedupe_key").eq("owner_id", owner).eq("status", "pending").like("dedupe_key", "gcal:%").gt("remind_at", now.toISOString());
  for (const p of pending ?? []) {
    if (wanted.has(p.dedupe_key as string)) continue;
    const { error } = await db.from("reminders").update({ status: "cancelled" }).eq("id", p.id).eq("status", "pending");
    if (!error) st.cancelled++;
  }
  return st;
}
