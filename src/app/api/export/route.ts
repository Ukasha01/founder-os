import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Full backup of YOUR data as one JSON file. Runs with your own session, so Row Level Security
// guarantees it can only contain your rows. Deleted (soft-deleted) rows are included.
const TABLES = [
  "user_settings", "workspaces", "recurrence_rules", "recurrence_exceptions", "tasks", "task_activity", "tags", "task_tags", "task_comments",
  "time_entries", "goals", "milestones", "calendar_events", "people", "meetings", "meeting_attendees", "commitments",
  "habits", "habit_entries", "kpi_definitions", "kpi_entries", "daily_reviews", "weekly_reviews", "quick_capture",
  "reminders", "notifications", "ai_conversations", "ai_messages", "ai_action_logs",
] as const;
// Stable paging needs a unique sort key; three tables have no id column.
const ORDER: Record<string, string[]> = { user_settings: ["owner_id"], task_tags: ["task_id", "tag_id"], meeting_attendees: ["meeting_id", "person_id"] };
const PAGE = 1000, MAX_PAGES = 50;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const data: Record<string, unknown[]> = {};
  const problems: string[] = [];
  for (const t of TABLES) {
    const rows: unknown[] = [];
    for (let p = 0; p < MAX_PAGES; p++) {
      let q = supabase.from(t).select("*");
      for (const col of ORDER[t] ?? ["id"]) q = q.order(col);
      const { data: chunk, error } = await q.range(p * PAGE, p * PAGE + PAGE - 1);
      if (error) { problems.push(`${t}: ${error.message}`); break; }
      rows.push(...(chunk ?? []));
      if ((chunk?.length ?? 0) < PAGE) break;
    }
    data[t] = rows;
  }
  const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]));
  const body = JSON.stringify({ app: "founder-os", exported_at: new Date().toISOString(), complete: problems.length === 0, problems, counts, data }, null, 1);
  return new NextResponse(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="founder-os-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
