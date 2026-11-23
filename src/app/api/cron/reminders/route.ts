import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { planReminders, nextStatus, naggable, nextNagAt, NAG_MINUTES, type Draft } from "@/lib/reminders";
import { dateInTz, zonedToUtc } from "@/lib/time";
import { tgSend, tgToken } from "@/lib/telegram";
import { emailOn, sendEmail, worthEmailing } from "@/lib/email";
import { makeClient, parseGcalEnv, type GcalClient } from "@/lib/gcal";
import { syncGoogle } from "@/lib/gcal-sync";

let gcalClient: { key: string; client: GcalClient } | null = null;   // reused between warm invocations so the Google token is cached

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

  // Loaded on demand: the library is CommonJS, so take its default export if the bundler adds one.
  const wp = await import("web-push");
  const webpush = (wp as unknown as { default?: typeof wp }).default ?? wp;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  const pushOn = !!(pub && priv);
  if (pushOn) webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", pub!, priv!);

  const now = new Date();
  const stats: Record<string, number> = { created: 0, delivered: 0, push_sent: 0, failed: 0 };
  const { data: users } = await db.from("user_settings").select("owner_id, timezone");

  // 1) Plan: what deserves a reminder right now.
  for (const u of users ?? []) {
    const today = dateInTz(now, u.timezone ?? "Asia/Karachi");
    const open = ["not_started", "in_progress", "waiting"];
    const winFrom = new Date(now.getTime() - 11 * 60000).toISOString(), winTo = new Date(now.getTime() + 11 * 60000).toISOString();
    const tz = u.timezone ?? "Asia/Karachi";
    const [{ data: dueToday }, { data: overdue }, { data: meetings }, { data: commitments }, { data: events }, { data: timed }] = await Promise.all([
      db.from("tasks").select("id, title").eq("owner_id", u.owner_id).is("deleted_at", null).in("status", open).eq("current_deadline", today).limit(50),
      db.from("tasks").select("id, title, current_deadline").eq("owner_id", u.owner_id).is("deleted_at", null).in("status", open).lt("current_deadline", today).limit(50),
      db.from("meetings").select("id, title, starts_at").eq("owner_id", u.owner_id).is("deleted_at", null).eq("status", "scheduled")
        .gte("starts_at", winFrom).lte("starts_at", winTo).limit(20),
      db.from("commitments").select("id, description, due_date, follow_up_date").eq("owner_id", u.owner_id).is("deleted_at", null).in("status", ["pending", "in_progress"])
        .or(`due_date.lte.${today},follow_up_date.lte.${today}`).limit(30),
      db.from("calendar_events").select("id, title, start_at, location").eq("owner_id", u.owner_id).is("deleted_at", null).neq("status", "cancelled").eq("all_day", false)
        .gte("start_at", winFrom).lte("start_at", winTo).limit(30),
      db.from("tasks").select("id, title, due_time").eq("owner_id", u.owner_id).is("deleted_at", null).in("status", open).eq("current_deadline", today).not("due_time", "is", null).limit(30),
    ]);
    const drafts: Draft[] = planReminders({ now, today, dueToday: dueToday ?? [], overdue: (overdue ?? []) as never, meetingsSoon: meetings ?? [], commitments: commitments ?? [],
      events: (events ?? []).map((e) => ({ id: e.id, title: e.title, starts_at: e.start_at, location: e.location })),
      timedTasks: (timed ?? []).map((t) => ({ id: t.id, title: t.title, due_at: zonedToUtc(`${today}T${String(t.due_time).slice(0, 5)}`, tz).toISOString() })) });
    for (const d of drafts) {
      const { error } = await db.from("reminders").insert({ owner_id: u.owner_id, ...d, channels: pushOn ? ["in_app", "push"] : ["in_app"] });
      if (!error) stats.created++;
      else if (error.code !== "23505") stats.failed++; // 23505 = already planned earlier, which is fine
    }
  }

  type Payload = { title: string; body: string; url: string; rid: string; nag?: number };
  const pushAll = async (ownerId: string, payload: Payload): Promise<string | null> => {
    let err: string | null = null;
    const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth_secret").eq("owner_id", ownerId);
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_secret } }, JSON.stringify(payload), { TTL: 900, urgency: "high" });
        stats.push_sent++;
        await db.from("push_subscriptions").update({ last_used_at: now.toISOString() }).eq("id", s.id);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id); // device unsubscribed
        else err = `push: ${code ?? "error"}`; // in-app copy is already delivered
      }
    }
    return err;
  };
  const backups = async (ownerId: string, title: string, body: string | null, link: string, email: boolean) => {
    if (tgToken()) {
      const { data: tg } = await db.from("telegram_links").select("chat_id").eq("owner_id", ownerId).not("chat_id", "is", null).maybeSingle();
      if (tg?.chat_id) { const t = await tgSend(Number(tg.chat_id), `${title}${body ? `\n${body}` : ""}`); if (t.ok) stats.telegram_sent = (stats.telegram_sent ?? 0) + 1; }
    }
    if (email && emailOn()) {
      const to = process.env.REMINDER_EMAIL_TO || (await db.auth.admin.getUserById(ownerId)).data.user?.email;
      if (to) { const m = await sendEmail(to, `Reminder: ${title}`, `${title}${body ? `\n${body}` : ""}\n\nOpen Founder OS: ${process.env.NEXT_PUBLIC_APP_URL ?? ""}${link}`); if (m.ok) stats.email_sent = (stats.email_sent ?? 0) + 1; else console.error(`[reminder email] ${m.error}`); }
    }
  };

  // 2) Deliver: everything pending and due.
  const { data: due } = await db.from("reminders").select("id, owner_id, title, body, kind, channels, attempts, task_id, meeting_id, commitment_id, event_id")
    .eq("status", "pending").lte("remind_at", now.toISOString()).order("remind_at").limit(100);
  for (const r of due ?? []) {
    const link = r.meeting_id ? `/meetings/${r.meeting_id}` : r.event_id ? "/calendar" : r.task_id ? `/tasks/${r.task_id}` : r.commitment_id ? "/commitments" : "/";
    let delivered = false, lastError: string | null = null;
    const { data: existing } = await db.from("notifications").select("id").eq("reminder_id", r.id).maybeSingle();
    if (existing) delivered = true;
    else {
      const { error } = await db.from("notifications").insert({ owner_id: r.owner_id, reminder_id: r.id, kind: r.kind, title: r.title, body: r.body, link });
      if (error) lastError = error.message; else { delivered = true; stats.delivered++; }
    }
    if (delivered && pushOn && (r.channels as string[]).includes("push")) lastError = (await pushAll(r.owner_id, { title: r.title, body: r.body ?? "", url: link, rid: r.id })) ?? lastError;
    // Backup channels reach a locked phone even when the phone maker blocks browser push (email only for reminders that matter).
    if (delivered && r.attempts === 0) await backups(r.owner_id, r.title, r.body, link, worthEmailing(r.kind, r.title));
    const status = nextStatus(r.attempts, delivered);
    if (status === "failed") stats.failed++;
    const first = delivered ? nextNagAt(now, 0) : null;
    await db.from("reminders").update({ status, attempts: r.attempts + 1, last_error: lastError, sent_at: delivered ? now.toISOString() : null, ...(delivered && r.attempts === 0 && naggable(r.kind, r.title) && first ? { next_nag_at: first.toISOString() } : {}) }).eq("id", r.id);
  }

  // 3) Nag: an important reminder nobody has acknowledged is sent again, and from the first repeat it is also emailed.
  const { data: nags } = await db.from("reminders").select("id, owner_id, title, body, kind, nag_count, task_id, meeting_id, commitment_id, event_id")
    .eq("status", "sent").is("acked_at", null).not("next_nag_at", "is", null).lte("next_nag_at", now.toISOString()).lt("nag_count", NAG_MINUTES.length).limit(50);
  for (const r of nags ?? []) {
    const link = r.meeting_id ? `/meetings/${r.meeting_id}` : r.event_id ? "/calendar" : r.task_id ? `/tasks/${r.task_id}` : r.commitment_id ? "/commitments" : "/";
    const title = `Still pending: ${r.title}`;
    if (pushOn) await pushAll(r.owner_id, { title, body: r.body ?? "Tap Done when handled, or Snooze.", url: link, rid: r.id, nag: r.nag_count + 1 });
    await backups(r.owner_id, title, r.body, link, r.nag_count === 1);   // email once more on the second repeat, not on every one
    const nxt = nextNagAt(now, r.nag_count + 1);
    await db.from("reminders").update({ nag_count: r.nag_count + 1, next_nag_at: nxt ? nxt.toISOString() : null }).eq("id", r.id);
    stats.nagged = (stats.nagged ?? 0) + 1;
  }
  // 4) Google Calendar mirror (optional). Never allowed to affect the delivery above.
  const g = parseGcalEnv(process.env);
  if (g.on) {
    try {
      const key = `${g.cfg.clientEmail}:${g.cfg.calendarId}`;
      if (gcalClient?.key !== key) gcalClient = { key, client: makeClient(g.cfg) };
      const tzByOwner = new Map((users ?? []).map((u) => [u.owner_id as string, (u.timezone as string | null) ?? "Asia/Karachi"]));
      const r = await syncGoogle(db, gcalClient.client, now, process.env.NEXT_PUBLIC_APP_URL ?? "", tzByOwner);
      stats.gcal_created = r.created; stats.gcal_updated = r.updated; stats.gcal_deleted = r.deleted; stats.gcal_failed = r.failed;
    } catch { console.error("[gcal] sync step failed"); stats.gcal_error = 1; }
  }
  return NextResponse.json({ ok: true, push_configured: pushOn, google_calendar: g.on ? "on" : g.reason, ...stats });
}
