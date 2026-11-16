import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { input, btnPrimary, card, formatMinutes } from "@/lib/ui";
import { addDays, dateInTz, isDateString, rangeUtc, startOfWeek } from "@/lib/time";
import { saveWeekly } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export default async function WeeklyReviewPage({ searchParams }: { searchParams: Promise<{ error?: string; week?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: settings } = await supabase.from("user_settings").select("timezone, week_starts_on").maybeSingle();
  const today = dateInTz(new Date(), settings?.timezone ?? "Asia/Karachi");
  const thisWeek = startOfWeek(today, settings?.week_starts_on ?? 1);
  const start = isDateString(sp.week) && sp.week <= thisWeek ? startOfWeek(sp.week, settings?.week_starts_on ?? 1) : thisWeek;
  const end = addDays(start, 6);
  const r = rangeUtc(start, end, settings?.timezone ?? "Asia/Karachi");
  const lo = r.start.toISOString(), hi = r.end.toISOString();

  const [{ data: done }, { data: moved }, { data: time }, { data: days }, { data: hab }, { data: habits }, { data: saved }] = await Promise.all([
    supabase.from("tasks").select("id").is("deleted_at", null).eq("status", "completed").gte("completed_at", lo).lt("completed_at", hi).limit(1000),
    supabase.from("task_activity").select("id").eq("action", "rescheduled").gte("created_at", lo).lt("created_at", hi).limit(1000),
    supabase.from("time_entries").select("duration_minutes, workspace_id").gte("entry_date", start).lte("entry_date", end).limit(5000),
    supabase.from("daily_reviews").select("review_date, score_total").gte("review_date", start).lte("review_date", end).not("review_completed_at", "is", null).order("review_date"),
    supabase.from("habit_entries").select("status").gte("entry_date", start).lte("entry_date", end),
    supabase.from("habits").select("id").is("archived_at", null),
    supabase.from("weekly_reviews").select("wins, challenges, next_week_focus, completed_at").eq("week_start", start).maybeSingle(),
  ]);
  const minutes = (time ?? []).reduce((n, e) => n + (e.duration_minutes ?? 0), 0);
  const scores = (days ?? []).map((d) => Number(d.score_total)).filter((n) => Number.isFinite(n));
  const avg = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;
  const habitDone = (hab ?? []).filter((h) => h.status === "done").length;
  const summary = { tasks_completed: done?.length ?? 0, reschedules: moved?.length ?? 0, minutes_logged: minutes, avg_score: avg, reviewed_days: scores.length, habits_done: habitDone };

  return (
    <div className="max-w-3xl">
      <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">Weekly review</h1>
      <p className="mt-1 flex flex-wrap items-center gap-3 text-sm">
        <Link href={`/review/weekly?week=${addDays(start, -7)}`} className="underline">← Previous</Link><strong>{start} to {end}</strong>
        {start < thisWeek && <Link href={`/review/weekly?week=${addDays(start, 7)}`} className="underline">Next →</Link>}
        <Link href="/review" className="underline">Daily review</Link>
      </p>
      {sp.error && <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{sp.error}</p>}
      <section className={`${card} mt-4 grid gap-2 text-sm sm:grid-cols-2`}>
        <p>Tasks completed: <strong>{summary.tasks_completed}</strong></p>
        <p>Deadline changes: <strong>{summary.reschedules}</strong></p>
        <p>Time logged: <strong>{formatMinutes(minutes)}</strong></p>
        <p>Average daily score: <strong>{avg === null ? "no completed daily reviews" : `${avg} (${scores.length} day${scores.length === 1 ? "" : "s"})`}</strong></p>
        <p>Habit check-ins done: <strong>{habitDone}</strong> across {habits?.length ?? 0} habits</p>
      </section>
      <form action={saveWeekly} className={`${card} mt-4 flex flex-col gap-2`}>
        <input type="hidden" name="week_start" value={start} />
        <input type="hidden" name="summary" value={JSON.stringify(summary)} />
        <label className="flex flex-col gap-1 text-xs">Wins<textarea name="wins" rows={3} defaultValue={saved?.wins ?? ""} className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Challenges<textarea name="challenges" rows={3} defaultValue={saved?.challenges ?? ""} className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Next week&apos;s focus<textarea name="next_week_focus" rows={3} defaultValue={saved?.next_week_focus ?? ""} className={input} /></label>
        <div className="flex gap-2"><SubmitButton variant="secondary">Save draft</SubmitButton><button name="complete" value="yes" className={btnPrimary}>{saved?.completed_at ? "Update completed review" : "Complete week"}</button></div>
      </form>
    </div>
  );
}
