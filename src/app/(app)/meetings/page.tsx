import Link from "next/link";
import { NewPanel } from "@/components/new-panel";
import { createClient } from "@/lib/supabase/server";
import { input, card } from "@/lib/ui";
import { dateInTz, timeInTz } from "@/lib/time";
import { createMeeting } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const [{ data: meetings }, { data: workspaces }, { data: settings }] = await Promise.all([
    supabase.from("meetings").select("id, title, starts_at, status, location").is("deleted_at", null)
      .order("starts_at", { ascending: false, nullsFirst: true }).limit(100),
    supabase.from("workspaces").select("id, name").is("archived_at", null).order("sort_order"),
    supabase.from("user_settings").select("timezone").maybeSingle(),
  ]);
  const tz = settings?.timezone ?? "Asia/Karachi";
  const now = new Date().getTime();
  const upcoming = (meetings ?? []).filter((m) => m.status === "scheduled" && (!m.starts_at || new Date(m.starts_at).getTime() >= now)).reverse();
  const past = (meetings ?? []).filter((m) => !upcoming.includes(m));
  const row = (m: NonNullable<typeof meetings>[number]) => (
    <li key={m.id} className={card}>
      <Link href={`/meetings/${m.id}`} className="font-medium hover:underline">{m.title}</Link>
      <p className="text-sm text-neutral-500">
        {m.starts_at ? `${dateInTz(new Date(m.starts_at), tz)} ${timeInTz(new Date(m.starts_at), tz)}` : "No time set"}
        {m.location ? ` · ${m.location}` : ""} · {m.status}
      </p>
    </li>
  );
  return (
    <div className="max-w-3xl">
      <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">Meetings</h1>
      {error && <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <NewPanel label="New meeting">
      <form action={createMeeting} className={`${card} grid gap-2 sm:grid-cols-2`}>
        <label className="flex flex-col gap-1 text-xs sm:col-span-2">Title<input name="title" required maxLength={300} className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Starts<input type="datetime-local" name="starts" className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Ends<input type="datetime-local" name="ends" className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Location / link<input name="location" className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Workspace
          <select name="workspace_id" defaultValue="" className={input}><option value="">None</option>{workspaces?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs sm:col-span-2">Agenda<textarea name="agenda" rows={2} className={input} /></label>
        <div><SubmitButton variant="primary">Add meeting</SubmitButton></div>
      </form>
      </NewPanel>
      <h2 className="mt-6 mb-2 text-[15px] font-semibold">Upcoming</h2>
      <ul className="flex flex-col gap-2">{upcoming.map(row)}{!upcoming.length && <li className="text-sm text-neutral-500">No upcoming meetings.</li>}</ul>
      <h2 className="mt-6 mb-2 text-[15px] font-semibold">Past and cancelled</h2>
      <ul className="flex flex-col gap-2">{past.map(row)}{!past.length && <li className="text-sm text-neutral-500">None yet.</li>}</ul>
    </div>
  );
}
