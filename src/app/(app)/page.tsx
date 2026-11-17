import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { materializeRecurring } from "@/lib/materialize";
import { loadDay } from "@/lib/dayscore";
import { addDays } from "@/lib/time";
import { isScheduled, type Frequency } from "@/lib/habits";
import { wsStyle, card, badge, PRIORITY_STYLE, PRIORITY_LABEL } from "@/lib/ui";
import { TaskCheck } from "@/components/task-check";
import { toggleTaskDone } from "./tasks/actions";
import { toggleHabitToday } from "./habits/actions";
import { markNotificationsRead } from "./settings/actions";
import { SubmitButton } from "@/components/submit-button";

// Dashboard: every widget reads real data; nothing is faked. Empty states say so.
export default async function HomePage() {
  const supabase = await createClient();
  const { data: settings } = await supabase.from("user_settings").select("timezone").maybeSingle();
  const { data: profile } = await supabase.from("profiles").select("display_name").maybeSingle();
  const { data: workspaces } = await supabase
    .from("workspaces").select("id, name, description, color").is("archived_at", null).order("sort_order");

  const tz = settings?.timezone ?? "Asia/Karachi";
  // "Today" in the user's timezone (same rule the database uses for overdue).
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  // Create upcoming recurring tasks (idempotent). A failure must never break the dashboard.
  try { await materializeRecurring(supabase, today); } catch { /* ignored */ }
  const open = ["not_started", "in_progress", "waiting"];
  const dayEnd = new Date(new Date().getTime() + 36 * 3600 * 1000).toISOString();
  const [{ data: meetingsNext }, { data: commitDue }, day, { data: topTasks }] = await Promise.all([
    supabase.from("meetings").select("id, title, starts_at").is("deleted_at", null).eq("status", "scheduled")
      .gte("starts_at", new Date().toISOString()).lte("starts_at", dayEnd).order("starts_at").limit(5),
    supabase.from("commitments").select("id, description, due_date, follow_up_date").is("deleted_at", null).in("status", ["pending", "in_progress"])
      .or(`due_date.lte.${addDays(today, 2)},follow_up_date.lte.${today}`).order("due_date").limit(5),
    loadDay(supabase, today),
    supabase.from("task_overview").select("id, title, priority, workspace_id").in("status", open).in("priority", ["critical", "high"]).order("current_deadline", { nullsFirst: false }).limit(3),
  ]);
  const { data: dueToday } = await supabase.from("task_overview")
    .select("id, title, priority, workspace_id").eq("current_deadline", today).in("status", open).limit(10);
  const { data: overdue } = await supabase.from("task_overview")
    .select("id, title, current_deadline, workspace_id").eq("is_overdue", true).order("current_deadline").limit(10);
  const { count: inbox } = await supabase.from("quick_capture")
    .select("id", { count: "exact", head: true }).eq("status", "inbox").is("deleted_at", null);
  const { data: todayTime } = await supabase.from("time_entries").select("duration_minutes").eq("entry_date", today);
  const minutesToday = (todayTime ?? []).reduce((n: number, e: { duration_minutes: number | null }) => n + (e.duration_minutes ?? 0), 0);
  const { data: habitRows } = await supabase.from("habits").select("id, name, frequency_type, weekdays, weekly_target, start_date").is("archived_at", null).order("created_at");
  const { data: habitToday } = await supabase.from("habit_entries").select("habit_id, status").eq("entry_date", today);
  const hStatus = new Map((habitToday ?? []).map((e) => [e.habit_id, e.status as string]));
  const todaysHabits = (habitRows ?? []).filter((h) =>
    h.frequency_type === "weekly_target" || isScheduled({ frequency_type: h.frequency_type as Frequency, weekdays: h.weekdays, weekly_target: h.weekly_target, start_date: h.start_date }, today));
  const wsColor = new Map((workspaces ?? []).map((w) => [w.id, w.color as string | null]));
  const seen = new Set<string>();
  type FocusTask = { id: string; title: string; workspace_id: string; tag: string; tagClass: string };
  const focus: FocusTask[] = [];
  for (const t of overdue ?? []) if (!seen.has(t.id)) { seen.add(t.id); focus.push({ id: t.id, title: t.title, workspace_id: t.workspace_id, tag: `Overdue ${t.current_deadline}`, tagClass: "bg-rose-100 text-rose-800" }); }
  for (const t of dueToday ?? []) if (!seen.has(t.id)) { seen.add(t.id); focus.push({ id: t.id, title: t.title, workspace_id: t.workspace_id, tag: "Due today", tagClass: "bg-amber-100 text-amber-800" }); }
  for (const t of topTasks ?? []) if (!seen.has(t.id)) { seen.add(t.id); focus.push({ id: t.id, title: t.title, workspace_id: t.workspace_id, tag: PRIORITY_LABEL[t.priority] + " priority", tagClass: PRIORITY_STYLE[t.priority] }); }
  const habitsDoneCount = todaysHabits.filter((h) => hStatus.get(h.id) === "done").length;
  const fmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: tz });
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: tz }).format(now)) % 24;
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: tz }).format(now);

  const { data: unread } = await supabase.from("notifications").select("id, title, body, link").is("read_at", null).order("created_at", { ascending: false }).limit(5);
  const total = day.result.total;
  const ring = total === null ? "bg-neutral-100 text-neutral-500" : total >= 70 ? "bg-emerald-100 text-emerald-800" : total >= 40 ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800";
  const head2 = "text-[15px] font-semibold";

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">{greeting}{profile?.display_name ? `, ${profile.display_name}` : ""}</h1>
          <p className="text-neutral-500">{date}</p>
        </div>
        <Link href="/review" className={`rounded-full px-4 py-2 text-sm font-semibold transition hover:brightness-95 ${ring}`}>
          {total === null ? "Day score: no data yet" : `Day score ${total}/100`}
        </Link>
      </div>

      {unread && unread.length > 0 && (
        <section className="mt-5 rounded-2xl bg-amber-50 p-4">
          <div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold text-amber-900">Reminders</h2>
            <form action={markNotificationsRead}><SubmitButton>Mark all read</SubmitButton></form></div>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {unread.map((n) => <li key={n.id}><Link href={n.link ?? "/"} className="font-medium text-amber-900 hover:underline">{n.title}</Link>{n.body && <span className="text-amber-800"> · {n.body}</span>}</li>)}
          </ul>
        </section>
      )}

      <div className="mt-5 grid grid-cols-3 gap-2.5">
        <Link href="/inbox" className="rounded-2xl bg-ws-violet-tint p-3.5 transition hover:brightness-95">
          <p className="text-2xl font-semibold text-ws-violet-ink">{inbox ?? 0}</p><p className="text-xs text-ws-violet-ink/80">in inbox to sort</p>
        </Link>
        <Link href="/time" className="rounded-2xl bg-ws-teal-tint p-3.5 transition hover:brightness-95">
          <p className="text-2xl font-semibold text-ws-teal-ink">{Math.floor(minutesToday / 60)}h {minutesToday % 60}m</p><p className="text-xs text-ws-teal-ink/80">logged today</p>
        </Link>
        <Link href="/habits" className="rounded-2xl bg-ws-orange-tint p-3.5 transition hover:brightness-95">
          <p className="text-2xl font-semibold text-ws-orange-ink">{habitsDoneCount}/{todaysHabits.length}</p><p className="text-xs text-ws-orange-ink/80">habits done</p>
        </Link>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <section className={`${card} lg:col-span-3`}>
          <div className="flex items-center justify-between"><h2 className={head2}>Focus for today</h2><Link href="/tasks" className="text-sm text-neutral-500 hover:text-ink">All tasks</Link></div>
          <ul className="mt-3 flex flex-col gap-2">
            {focus.map((t) => {
              const c = wsStyle(wsColor.get(t.workspace_id));
              return (
                <li key={t.id} className={`flex items-center gap-3 rounded-xl border border-l-4 border-line px-3 py-2.5 ${c.edge}`}>
                  <form action={toggleTaskDone}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="done" value="false" /><TaskCheck done={false} label={t.title} /></form>
                  <Link href={`/tasks/${t.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{t.title}</Link>
                  <span className={`${badge} ${t.tagClass} shrink-0`}>{t.tag}</span>
                </li>
              );
            })}
            {!focus.length && <li className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">Nothing urgent. Pick something from <Link href="/tasks" className="underline">your tasks</Link> or capture a new idea.</li>}
          </ul>
        </section>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <section className={card}>
            <h2 className={head2}>Habits</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {todaysHabits.map((h) => {
                const done = hStatus.get(h.id) === "done";
                return (
                  <li key={h.id} className="flex items-center gap-3">
                    <form action={toggleHabitToday}>
                      <input type="hidden" name="habit_id" value={h.id} /><input type="hidden" name="entry_date" value={today} /><input type="hidden" name="done" value={String(done)} />
                      <TaskCheck done={done} label={h.name} />
                    </form>
                    <span className={done ? "text-neutral-400 line-through" : ""}>{h.name}</span>
                  </li>
                );
              })}
              {!todaysHabits.length && <li className="text-sm text-neutral-500">No habits yet. <Link href="/habits" className="underline">Add one</Link>.</li>}
            </ul>
          </section>
          <section className={card}>
            <h2 className={head2}>Coming up</h2>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {meetingsNext?.map((m) => <li key={m.id} className="flex items-center justify-between gap-2"><Link href={`/meetings/${m.id}`} className="truncate font-medium hover:underline">{m.title}</Link><span className={`${badge} shrink-0 bg-ws-blue-tint text-ws-blue-ink`}>{fmt.format(new Date(m.starts_at!))}</span></li>)}
              {commitDue?.map((c) => <li key={c.id} className="flex items-center justify-between gap-2"><Link href="/commitments" className="truncate hover:underline">{c.description}</Link><span className={`${badge} shrink-0 bg-ws-pink-tint text-ws-pink-ink`}>{c.due_date ? `due ${c.due_date}` : `follow up ${c.follow_up_date}`}</span></li>)}
              {!meetingsNext?.length && !commitDue?.length && <li className="text-neutral-500">No meetings or commitments due soon.</li>}
            </ul>
          </section>
        </div>
      </div>

      <h2 className="mt-8 mb-3 text-[15px] font-semibold">Workspaces</h2>
      {workspaces && workspaces.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((w) => {
            const c = wsStyle(w.color);
            return (
              <li key={w.id}>
                <Link href={`/workspaces/${w.id}`} className={`block rounded-2xl p-4 transition hover:brightness-95 ${c.tint}`}>
                  <span className={`flex items-center gap-2 font-semibold ${c.ink}`}><span className={`h-2.5 w-2.5 rounded-full ${c.dot}`} />{w.name}</span>
                  {w.description && <span className={`mt-1 block text-sm opacity-80 ${c.ink}`}>{w.description}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-neutral-500">No workspaces found. Check that the database migrations ran.</p>
      )}
    </div>
  );
}
