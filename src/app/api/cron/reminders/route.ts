import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { planReminders, nextStatus, type Draft } from "@/lib/reminders";
import { dateInTz } from "@/lib/time";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

// Creates today's reminders and delivers everything that is due. Safe to call as often as you like:
// reminders are de-duplicated by key and each is delivered once.
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET is not set; the reminder job is switched off." }, { status: 503 });
  if (!authorised(req)) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  const db = createAdminClient();
  if (!db) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set." }, { status: 503 });

  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  const pushOn = !!(pub && priv);
  if (pushOn) webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", pub!, priv!);

  const now = new Date();
  const stats = { created: 0, delivered: 0, push_sent: 0, failed: 0 };
  const { data: users } = await db.from("user_settings").select("owner_id, timezone");

  // 1) Plan: what deserves a reminder right now.
  for (const u of users ?? []) {
    const today = dateInTz(now, u.timezone ?? "Asia/Karachi");
    const open = ["not_started", "in_progress", "waiting"];
    const [{ data: dueToday }, { data: overdue }, { data: meetings }, { data: commitments }] = await Promise.all([
      db.from("tasks").select("id, title").eq("owner_id", u.owner_id).is("deleted_at", null).in("status", open).eq("current_deadline", today).limit(50),
      db.from("tasks").select("id, title, current_deadline").eq("owner_id", u.owner_id).is("deleted_at", null).in("status", open).lt("current_deadline", today).limit(50),
      db.from("meetings").select("id, title, starts_at").eq("owner_id", u.owner_id).is("deleted_at", null).eq("status", "scheduled")
        .gte("starts_at", now.toISOString()).lte("starts_at", new Date(now.getTime() + 3600000).toISOString()).limit(20),
      db.from("commitments").select("id, description, due_date, follow_up_date").eq("owner_id", u.owner_id).is("deleted_at", null).in("status", ["pending", "in_progress"])
        .or(`due_date.lte.${today},follow_up_date.lte.${today}`).limit(30),
    ]);
    const drafts: Draft[] = planReminders({ now, today, dueToday: dueToday ?? [], overdue: (overdue ?? []) as never, meetingsSoon: meetings ?? [], commitments: commitments ?? [] });
    for (const d of drafts) {
      const { error } = await db.from("reminders").insert({ owner_id: u.owner_id, ...d, channels: pushOn ? ["in_app", "push"] : ["in_app"] });
      if (!error) stats.created++;
      else if (error.code !== "23505") stats.failed++; // 23505 = already planned earlier, which is fine
    }
  }

  // 2) Deliver: everything pending and due.
  const { data: due } = await db.from("reminders").select("id, owner_id, title, body, kind, channels, attempts, task_id, meeting_id, commitment_id")
    .eq("status", "pending").lte("remind_at", now.toISOString()).order("remind_at").limit(100);
  for (const r of due ?? []) {
    const link = r.meeting_id ? `/meetings/${r.meeting_id}` : r.task_id ? `/tasks/${r.task_id}` : r.commitment_id ? "/commitments" : "/";
    let delivered = false, lastError: string | null = null;
    const { data: existing } = await db.from("notifications").select("id").eq("reminder_id", r.id).maybeSingle();
    if (existing) delivered = true;
    else {
      const { error } = await db.from("notifications").insert({ owner_id: r.owner_id, reminder_id: r.id, kind: r.kind, title: r.title, body: r.body, link });
      if (error) lastError = error.message; else { delivered = true; stats.delivered++; }
    }
    if (delivered && pushOn && (r.channels as string[]).includes("push")) {
      const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth_secret").eq("owner_id", r.owner_id);
      for (const s of subs ?? []) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_secret } }, JSON.stringify({ title: r.title, body: r.body ?? "", url: link }), { TTL: 3600 });
          stats.push_sent++;
          await db.from("push_subscriptions").update({ last_used_at: now.toISOString() }).eq("id", s.id);
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id); // device unsubscribed
          else lastError = `push: ${code ?? "error"}`; // in-app copy is already delivered
        }
      }
    }
    const status = nextStatus(r.attempts, delivered);
    if (status === "failed") stats.failed++;
    await db.from("reminders").update({ status, attempts: r.attempts + 1, last_error: lastError, sent_at: delivered ? now.toISOString() : null }).eq("id", r.id);
  }
  return NextResponse.json({ ok: true, push_configured: pushOn, ...stats });
}
