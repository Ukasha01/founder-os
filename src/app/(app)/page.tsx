import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { materializeRecurring } from "@/lib/materialize";
import { loadDay } from "@/lib/dayscore";
import { addDays } from "@/lib/time";

// Dashboard: every widget reads real data; nothing is faked. Empty states say so.
export default async function HomePage() {
  const supabase = await createClient();
  const { data: settings } = await supabase.from("user_settings").select("timezone").maybeSingle();
  const { data: profile } = await supabase.from("profiles").select("display_name").maybeSingle();
  const { data: workspaces } = await supabase
    .from("workspaces").select("id, name, description").is("archived_at", null).order("sort_order");

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
    supabase.from("task_overview").select("id, title, priority").in("status", open).in("priority", ["critical", "high"]).order("current_deadline", { nullsFirst: false }).limit(3),
  ]);
  const { data: dueToday } = await supabase.from("task_overview")
    .select("id, title, priority").eq("current_deadline", today).in("status", open).limit(10);
  const { data: overdue } = await supabase.from("task_overview")
    .select("id, title, current_deadline").eq("is_overdue", true).order("current_deadline").limit(10);
  const { count: inbox } = await supabase.from("quick_capture")
    .select("id", { count: "exact", head: true }).eq("status", "inbox").is("deleted_at", null);
  const { data: todayTime } = await supabase.from("time_entries").select("duration_minutes").eq("entry_date", today);
  const minutesToday = (todayTime ?? []).reduce((n: number, e: { duration_minutes: number | null }) => n + (e.duration_minutes ?? 0), 0);
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: tz }).format(now)) % 24;
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: tz }).format(now);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">{greeting}{profile?.display_name ? `, ${profile.display_name}` : ""}</h1>
      <p className="text-neutral-500">{date}</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <section className="rounded-lg border border-neutral-200 p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Due today</h2>
          <ul className="mt-2 text-sm">
            {dueToday?.map((t) => <li key={t.id}><Link href={`/tasks/${t.id}`} className="hover:underline">{t.title}</Link></li>)}
            {!dueToday?.length && <li className="text-neutral-500">Nothing due today.</li>}
          </ul>
        </section>
        <section className="rounded-lg border border-neutral-200 p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Overdue</h2>
          <ul className="mt-2 text-sm">
            {overdue?.map((t) => <li key={t.id}><Link href={`/tasks/${t.id}`} className="text-red-700 hover:underline">{t.title}</Link> <span className="text-xs text-neutral-500">{t.current_deadline}</span></li>)}
            {!overdue?.length && <li className="text-neutral-500">Nothing overdue.</li>}
          </ul>
        </section>
        <section className="rounded-lg border border-neutral-200 p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Inbox</h2>
          <p className="mt-2 text-sm"><Link href="/inbox" className="underline">{inbox ?? 0} item{inbox === 1 ? "" : "s"} to sort</Link></p>
        </section>
        <section className="rounded-lg border border-neutral-200 p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Time logged today</h2>
          <p className="mt-2 text-sm">{Math.floor(minutesToday / 60)}h {minutesToday % 60}m</p>
        </section>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <section className="rounded-lg border border-neutral-200 p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Top priorities</h2>
          <ul className="mt-2 text-sm">
            {topTasks?.map((t) => <li key={t.id}><Link href={`/tasks/${t.id}`} className="hover:underline">{t.title}</Link></li>)}
            {!topTasks?.length && <li className="text-neutral-500">No critical or high tasks open.</li>}
          </ul>
        </section>
        <section className="rounded-lg border border-neutral-200 p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Today&apos;s score</h2>
          <p className="mt-2 text-sm"><Link href="/review" className="underline">{day.result.total === null ? "No data yet" : `${day.result.total} / 100 so far`}</Link></p>
        </section>
        <section className="rounded-lg border border-neutral-200 p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Meetings (next 36h)</h2>
          <ul className="mt-2 text-sm">
            {meetingsNext?.map((m) => <li key={m.id}><Link href={`/meetings/${m.id}`} className="hover:underline">{m.title}</Link> <span className="text-xs text-neutral-500">{new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short", timeZone: tz }).format(new Date(m.starts_at!))}</span></li>)}
            {!meetingsNext?.length && <li className="text-neutral-500">None.</li>}
          </ul>
        </section>
        <section className="rounded-lg border border-neutral-200 p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Commitments to watch</h2>
          <ul className="mt-2 text-sm">
            {commitDue?.map((c) => <li key={c.id}><Link href="/commitments" className="hover:underline">{c.description}</Link> <span className="text-xs text-neutral-500">{c.due_date ? `due ${c.due_date}` : `follow up ${c.follow_up_date}`}</span></li>)}
            {!commitDue?.length && <li className="text-neutral-500">Nothing due soon.</li>}
          </ul>
        </section>
        <section className="rounded-lg border border-neutral-200 p-4 sm:col-span-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Habits today</h2>
          <p className="mt-2 text-sm"><Link href="/habits" className="underline">{day.input.habitsExpected === 0 ? "No habits scheduled" : `${day.input.habitsDone} of ${day.input.habitsExpected} done`}</Link></p>
        </section>
      </div>

      <h2 className="mt-8 mb-3 text-sm font-medium uppercase tracking-wide text-neutral-500">Workspaces</h2>
      {workspaces && workspaces.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {workspaces.map((w) => (
            <li key={w.id}>
              <Link href={`/workspaces/${w.id}`} className="block rounded-lg border border-neutral-200 p-4 hover:border-neutral-400">
                <span className="font-medium">{w.name}</span>
                {w.description && <span className="mt-1 block text-sm text-neutral-500">{w.description}</span>}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-neutral-500">No workspaces found. Check that the database migrations ran.</p>
      )}
    </div>
  );
}
