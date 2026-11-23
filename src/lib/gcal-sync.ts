import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, zonedToUtc } from "./time.ts";
import { buildEvent, eventIdFor, payloadHash, reminderQualifies, reminderSpec, taskSpec, type EventSpec, type GcalClient } from "./gcal.ts";

// Runs inside the once-a-minute job. It never throws and never blocks reminder delivery: a failure is recorded on the link row
// and retried on the next run (up to 5 attempts per version of the item).
const MAX_CALLS = 20, MAX_ATTEMPTS = 5, TEST_TTL_MS = 20 * 60_000;
const OPEN = ["not_started", "in_progress", "waiting"];

type Link = { id: string; owner_id: string; source_type: "reminder" | "task"; source_id: string; google_event_id: string; payload_hash: string | null; status: string; attempts: number; is_test: boolean; created_at: string };
export type SyncStats = { created: number; updated: number; deleted: number; failed: number; skipped_past: number };

export async function syncGoogle(db: SupabaseClient, gc: GcalClient, now: Date, appUrl: string, tzByOwner: Map<string, string>): Promise<SyncStats> {
  const st: SyncStats = { created: 0, updated: 0, deleted: 0, failed: 0, skipped_past: 0 };
  let calls = 0;
  const tzOf = (o: string) => tzByOwner.get(o) ?? "Asia/Karachi";
  const nowIso = now.toISOString();

  const { data: linkRows } = await db.from("google_calendar_links").select("id, owner_id, source_type, source_id, google_event_id, payload_hash, status, attempts, is_test, created_at").neq("status", "deleted").limit(500);
  const links = new Map<string, Link>(((linkRows ?? []) as Link[]).map((l) => [`${l.source_type}:${l.source_id}`, l]));

  const mark = (l: Link | undefined, owner: string, type: "reminder" | "task", id: string, eventId: string, patch: Record<string, unknown>) =>
    l ? db.from("google_calendar_links").update({ ...patch, updated_at: nowIso }).eq("id", l.id)
      : db.from("google_calendar_links").upsert({ owner_id: owner, source_type: type, source_id: id, google_event_id: eventId, ...patch, updated_at: nowIso }, { onConflict: "source_type,source_id" });   // upsert: an item brought back by Undo reuses its old row

  // A: expired test events (and their rows) are always removed.
  for (const l of links.values()) {
    if (!l.is_test) continue;
    if (now.getTime() - new Date(l.created_at).getTime() > TEST_TTL_MS && calls < MAX_CALLS) {
      calls++; const r = await gc.remove(l.google_event_id);
      if (r.ok) { await db.from("google_calendar_links").delete().eq("id", l.id); st.deleted++; links.delete(`${l.source_type}:${l.source_id}`); }
    }
  }

  // B: what should exist. Reminders in the future that nobody has acknowledged, and open tasks with a due time in the next two weeks.
  const desired: { spec: EventSpec; owner: string }[] = [];
  const { data: rems } = await db.from("reminders").select("id, owner_id, title, remind_at, kind, event_id, task_id, meeting_id, commitment_id, dedupe_key, status, acked_at")
    .gt("remind_at", nowIso).is("acked_at", null).in("status", ["pending", "sent"]).like("dedupe_key", "custom:%").order("remind_at").limit(60);
  for (const r of rems ?? []) {
    if (!reminderQualifies(r)) continue;
    const s = reminderSpec(r, tzOf(r.owner_id), now, appUrl);
    if ("spec" in s) desired.push({ spec: s.spec, owner: r.owner_id }); else st.skipped_past++;
  }
  const today = new Date(now.getTime() + 5 * 3600_000).toISOString().slice(0, 10);   // generous lower bound; exact past-check is per item
  const { data: tasks } = await db.from("tasks").select("id, owner_id, title, current_deadline, due_time, estimated_minutes")
    .is("deleted_at", null).in("status", OPEN).not("due_time", "is", null).gte("current_deadline", addDays(today, -1)).lte("current_deadline", addDays(today, 14)).order("current_deadline").limit(80);
  for (const t of tasks ?? []) {
    const s = taskSpec(t as never, tzOf(t.owner_id), now, appUrl);
    if ("spec" in s) desired.push({ spec: s.spec, owner: t.owner_id }); else st.skipped_past++;
  }

  // C: create or update.
  const wanted = new Set<string>();
  for (const { spec, owner } of desired) {
    const key = `${spec.kind}:${spec.id}`; wanted.add(key);
    const l = links.get(key), body = buildEvent(spec), hash = payloadHash(body), eventId = l?.google_event_id ?? eventIdFor(spec.kind, spec.id);
    if (l && l.status === "synced" && l.payload_hash === hash) continue;                    // already up to date
    if (l && l.status === "failed" && l.payload_hash === hash && l.attempts >= MAX_ATTEMPTS) continue;   // gave up on this version
    if (calls >= MAX_CALLS) break;
    calls++;
    const r = await gc.upsert(eventId, body);
    if (r.ok) { await mark(l, owner, spec.kind, spec.id, eventId, { status: "synced", payload_hash: hash, attempts: 0, last_error: null, synced_at: nowIso }); if (l) st.updated++; else st.created++; }
    else { st.failed++; await mark(l, owner, spec.kind, spec.id, eventId, { status: "failed", payload_hash: hash, attempts: (l && l.payload_hash === hash ? l.attempts : 0) + 1, last_error: r.message }); }
  }

  // D: delete events whose source is gone, finished, acknowledged, cancelled, or no longer has a due time.
  for (const l of links.values()) {
    if (l.is_test || wanted.has(`${l.source_type}:${l.source_id}`) || l.status === "skipped_past") continue;
    if (calls >= MAX_CALLS) break;
    let keep = false;
    if (l.source_type === "reminder") {
      const { data: r } = await db.from("reminders").select("remind_at, acked_at, status").eq("id", l.source_id).maybeSingle();
      keep = !!r && !r.acked_at && r.status !== "cancelled" && new Date(r.remind_at as string).getTime() <= now.getTime();   // already fired: keep as history
    } else {
      const { data: t } = await db.from("tasks").select("deleted_at, status, due_time, current_deadline").eq("id", l.source_id).maybeSingle();
      const stillOpen = !!t && !t.deleted_at && OPEN.includes(t.status as string) && !!t.due_time;
      // Open timed task that is not in the wanted set: keep if its time has passed (history); remove if it was moved beyond the two-week window.
      keep = stillOpen && !(zonedToUtc(`${t!.current_deadline}T${String(t!.due_time).slice(0, 5)}`, tzOf(l.owner_id)).getTime() > now.getTime());
    }
    if (keep) continue;
    calls++; const r = await gc.remove(l.google_event_id);
    if (r.ok) { await db.from("google_calendar_links").update({ status: "deleted", updated_at: nowIso }).eq("id", l.id); st.deleted++; }
    else { st.failed++; await db.from("google_calendar_links").update({ last_error: r.message, updated_at: nowIso }).eq("id", l.id); }
  }
  return st;
}
