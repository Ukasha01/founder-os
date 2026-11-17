import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildIcs, type IcsEvent } from "@/lib/ics";

export const dynamic = "force-dynamic";

// One-way calendar file: calendar events plus open task deadlines (as all-day items).
// Import it into Google Calendar (Settings > Import & export). Re-importing does not duplicate: UIDs are stable.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [{ data: events }, { data: tasks }] = await Promise.all([
    supabase.from("calendar_events").select("id, title, description, location, start_at, end_at, all_day").is("deleted_at", null).neq("status", "cancelled").gte("start_at", since).order("start_at").limit(2000),
    supabase.from("tasks").select("id, title, current_deadline").is("deleted_at", null).in("status", ["not_started", "in_progress", "waiting"]).not("current_deadline", "is", null).limit(2000),
  ]);
  const now = new Date().toISOString();
  const list: IcsEvent[] = [
    ...(events ?? []).map((e) => ({ uid: `event-${e.id}@founder-os`, title: e.title, description: e.description, location: e.location, start: e.start_at, end: e.end_at, allDay: false, stampedAt: now })),
    ...(tasks ?? []).map((t) => ({ uid: `task-${t.id}@founder-os`, title: `Due: ${t.title}`, start: t.current_deadline as string, allDay: true, stampedAt: now })),
  ];
  return new NextResponse(buildIcs(list), {
    headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="founder-os.ics"', "cache-control": "no-store" },
  });
}
