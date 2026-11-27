import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaces } from "@/lib/data";
import { card } from "@/lib/ui";
import { addDays, dateInTz, rangeUtc } from "@/lib/time";

const RANGES = [7, 14, 30, 90];
type T = { id: string; title: string; status: string; priority: string | null; workspace_id: string | null; created_at: string; completed_at: string | null; deleted_at: string | null; current_deadline: string | null };
type ListProps = { rows: T[]; at: (t: T) => string; empty: string; tz: string; ws: Map<string, string> };

function List({ rows, at, empty, tz, ws }: ListProps) {
  if (rows.length === 0) return <p className="text-sm text-neutral-600">{empty}</p>;
  const fmt = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  const dayLabel = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
  const groups = new Map<string, T[]>();
  for (const t of rows) { const k = dateInTz(new Date(at(t)), tz); groups.set(k, [...(groups.get(k) ?? []), t]); }
  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([day, list]) => (
        <div key={day}>
          <h3 className="mb-1 text-sm font-semibold">{dayLabel(at(list[0]))} <span className="font-normal text-neutral-500">({list.length})</span></h3>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {list.map((t) => (
              <li key={t.id} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2 text-sm">
                <span className="w-12 shrink-0 tabular-nums text-neutral-500">{fmt(at(t))}</span>
                <Link href={`/tasks/${t.id}`} className={`min-w-0 flex-1 ${t.deleted_at ? "text-neutral-500 line-through" : ""}`}>{t.title}</Link>
                {t.workspace_id && ws.get(t.workspace_id) && <span className="text-xs text-neutral-500">{ws.get(t.workspace_id)}</span>}
                {t.deleted_at && <span className="text-xs text-rose-700">deleted</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// A read-only record of what you added and finished. Nothing here is ever purged; deleted tasks stay in the database.
export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ days?: string; deleted?: string }> }) {
  const sp = await searchParams;
  const days = RANGES.includes(Number(sp.days)) ? Number(sp.days) : 7;
  const showDeleted = sp.deleted === "1";
  const supabase = await createClient();
  const { data: settings } = await supabase.from("user_settings").select("timezone").maybeSingle();
  const tz = settings?.timezone ?? "Asia/Karachi";
  const today = dateInTz(new Date(), tz);
  const r = rangeUtc(addDays(today, -(days - 1)), today, tz);
  const lo = r.start.toISOString(), hi = r.end.toISOString();
  const cols = "id, title, status, priority, workspace_id, created_at, completed_at, deleted_at, current_deadline";
  const [{ data: added }, { data: done }, workspaces] = await Promise.all([
    supabase.from("tasks").select(cols).gte("created_at", lo).lt("created_at", hi).order("created_at", { ascending: false }).limit(1000),
    supabase.from("tasks").select(cols).eq("status", "completed").gte("completed_at", lo).lt("completed_at", hi).order("completed_at", { ascending: false }).limit(1000),
    getWorkspaces(),
  ]);
  const ws = new Map((workspaces ?? []).map((w) => [w.id, w.name]));
  const addedAll = (added ?? []) as T[], doneAll = (done ?? []) as T[];
  const addedShown = showDeleted ? addedAll : addedAll.filter((t) => !t.deleted_at);
  const hiddenDeleted = addedAll.length - addedAll.filter((t) => !t.deleted_at).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">History</h1>
        <nav className="flex gap-1 text-sm" aria-label="Range">
          {RANGES.map((d) => <Link key={d} href={`/history?days=${d}${showDeleted ? "&deleted=1" : ""}`} className={`rounded-lg border px-3 py-1.5 ${d === days ? "border-accent bg-accent text-on-accent" : "border-line-strong"}`}>{d} days</Link>)}
        </nav>
      </div>
      <p className="text-sm text-neutral-600">Last {days} days, Karachi time. Everything you add or finish is kept here, even after it disappears from the calendar.</p>
      <div className="grid grid-cols-2 gap-3">
        <div className={card}><p className="text-2xl font-semibold">{addedShown.length}</p><p className="text-sm text-neutral-600">tasks added</p></div>
        <div className={card}><p className="text-2xl font-semibold">{doneAll.length}</p><p className="text-sm text-neutral-600">tasks completed</p></div>
      </div>
      <section className={card}>
        <h2 className="mb-3 font-medium">Completed</h2>
        <List rows={doneAll} at={(t) => t.completed_at as string} empty="Nothing was completed in this period." tz={tz} ws={ws} />
      </section>
      <section className={card}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Added</h2>
          {hiddenDeleted > 0 && <Link className="text-sm underline" href={`/history?days=${days}${showDeleted ? "" : "&deleted=1"}`}>{showDeleted ? "Hide" : "Show"} {hiddenDeleted} deleted</Link>}
        </div>
        <List rows={addedShown} at={(t) => t.created_at} empty="Nothing was added in this period." tz={tz} ws={ws} />
      </section>
    </div>
  );
}
