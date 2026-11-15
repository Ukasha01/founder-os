import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { input, btn, btnPrimary, card } from "@/lib/ui";
import { addDays, dateInTz, isDateString } from "@/lib/time";
import { loadDay } from "@/lib/dayscore";
import { markPlanned, saveReview } from "./actions";

const LABEL = { tasks: "Tasks", hours: "Planned hours", kpis: "KPIs", habits: "Habits", planning: "Planning and review" } as const;

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ error?: string; date?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: settings } = await supabase.from("user_settings").select("timezone").maybeSingle();
  const today = dateInTz(new Date(), settings?.timezone ?? "Asia/Karachi");
  const date = isDateString(sp.date) && sp.date <= today ? sp.date : today;
  const day = await loadDay(supabase, date);
  const frozen = day.review?.review_completed_at ? await supabase.from("daily_reviews").select("score_total, weights_snapshot").eq("review_date", date).maybeSingle() : null;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Daily review</h1>
      <p className="mt-1 flex flex-wrap items-center gap-3 text-sm">
        <Link href={`/review?date=${addDays(date, -1)}`} className="underline">← Previous</Link><strong>{date}{date === today ? " (today)" : ""}</strong>
        {date < today && <Link href={`/review?date=${addDays(date, 1)}`} className="underline">Next →</Link>}
        <Link href="/review/weekly" className="underline">Weekly review</Link>
      </p>
      {sp.error && <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{sp.error}</p>}

      <section className={`${card} mt-4`}>
        <div className="flex items-baseline justify-between">
          <h2 className="font-medium">Score</h2>
          <span className="text-2xl font-semibold">{day.result.total === null ? "No data" : `${day.result.total}`}<span className="text-sm font-normal text-neutral-500">{day.result.total === null ? "" : " / 100"}</span></span>
        </div>
        {frozen?.data?.score_total != null && <p className="text-xs text-neutral-500">Saved when you completed this review: {String(frozen.data.score_total)}. The live number can change if you edit the day.</p>}
        <table className="mt-3 w-full text-sm">
          <thead><tr className="text-left text-xs text-neutral-500"><th className="py-1">Category</th><th>Weight</th><th>Points</th><th>Why</th></tr></thead>
          <tbody>
            {(Object.keys(LABEL) as (keyof typeof LABEL)[]).map((k) => {
              const c = day.result.categories[k];
              return <tr key={k} className="border-t border-neutral-100 align-top"><td className="py-1">{LABEL[k]}</td><td>{c.weight}</td><td>{c.available ? `${c.points}` : "n/a"}</td><td className="text-neutral-600">{c.explanation}</td></tr>;
            })}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-neutral-500">
          Rescheduled today: {day.result.rescheduled} (recorded, not counted as failure) · Cancelled: {day.result.cancelled} (excluded). Categories with nothing to measure are left out and the rest are scaled to 100. Weights are editable in <Link href="/settings" className="underline">Settings</Link>.
        </p>
      </section>

      <section className={`${card} mt-4`}>
        <h2 className="font-medium">Plan</h2>
        <p className="text-sm text-neutral-600">{day.review?.plan_completed_at ? "Day marked as planned." : "Not marked as planned yet."}</p>
        {!day.review?.plan_completed_at && <form action={markPlanned} className="mt-2"><input type="hidden" name="date" value={date} /><button className={btn}>Mark day as planned</button></form>}
      </section>

      <form action={saveReview} className={`${card} mt-4 flex flex-col gap-2`}>
        <input type="hidden" name="date" value={date} />
        <h2 className="font-medium">Reflection</h2>
        <label className="flex flex-col gap-1 text-xs">Wins<textarea name="wins" rows={3} defaultValue={day.review?.wins ?? ""} className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Blockers<textarea name="blockers" rows={3} defaultValue={day.review?.blockers ?? ""} className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Tomorrow&apos;s plan<textarea name="tomorrow_plan" rows={3} defaultValue={day.review?.tomorrow_plan ?? ""} className={input} /></label>
        <div className="flex gap-2">
          <button className={btn}>Save draft</button>
          <button name="complete" value="yes" className={btnPrimary}>{day.review?.review_completed_at ? "Update completed review" : "Complete review and save score"}</button>
        </div>
      </form>
    </div>
  );
}
