import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { input, card } from "@/lib/ui";
import { dateInTz, timeInTz } from "@/lib/time";
import { addAttendee, createMeetingFollowUp, deleteMeeting, removeAttendee, updateMeeting } from "../actions";
import { SubmitButton } from "@/components/submit-button";

export default async function MeetingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error } = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const { data: m } = await supabase.from("meetings").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!m) notFound();
  const [{ data: attendees }, { data: people }, { data: workspaces }, { data: settings }, { data: commitments }] = await Promise.all([
    supabase.from("meeting_attendees").select("person_id, people(name)").eq("meeting_id", id),
    supabase.from("people").select("id, name").is("deleted_at", null).order("name"),
    supabase.from("workspaces").select("id, name").is("archived_at", null).order("sort_order"),
    supabase.from("user_settings").select("timezone").maybeSingle(),
    supabase.from("commitments").select("id, description, status").eq("meeting_id", id).is("deleted_at", null),
  ]);
  const tz = settings?.timezone ?? "Asia/Karachi";
  const local = (v: string | null) => (v ? `${dateInTz(new Date(v), tz)}T${timeInTz(new Date(v), tz)}` : "");
  const present = new Set((attendees ?? []).map((a) => a.person_id));
  const defaultWs = m.workspace_id ?? workspaces?.[0]?.id ?? "";
  return (
    <div className="max-w-3xl">
      <p className="text-sm text-neutral-500"><Link href="/meetings" className="underline">Meetings</Link></p>
      <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.02em]">{m.title}</h1>
      {error && <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <form action={updateMeeting} className={`${card} mt-4 grid gap-2 sm:grid-cols-2`}>
        <input type="hidden" name="id" value={id} />
        <label className="flex flex-col gap-1 text-xs sm:col-span-2">Title<input name="title" defaultValue={m.title} required className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Starts<input type="datetime-local" name="starts" defaultValue={local(m.starts_at)} className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Ends<input type="datetime-local" name="ends" defaultValue={local(m.ends_at)} className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Location / link<input name="location" defaultValue={m.location ?? ""} className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Status
          <select name="status" defaultValue={m.status} className={input}><option value="scheduled">Scheduled</option><option value="held">Held</option><option value="cancelled">Cancelled</option></select>
        </label>
        <label className="flex flex-col gap-1 text-xs sm:col-span-2">Agenda<textarea name="agenda" rows={3} defaultValue={m.agenda ?? ""} className={input} /></label>
        <label className="flex flex-col gap-1 text-xs sm:col-span-2">Notes<textarea name="notes" rows={5} defaultValue={m.notes ?? ""} className={input} /></label>
        <label className="flex flex-col gap-1 text-xs sm:col-span-2">Decisions<textarea name="decisions" rows={3} defaultValue={m.decisions ?? ""} className={input} /></label>
        <div><SubmitButton variant="primary">Save</SubmitButton></div>
      </form>

      <section className={`${card} mt-4`}>
        <h2 className="font-medium">Attendees</h2>
        <ul className="mt-2 text-sm">
          {attendees?.map((a) => (
            <li key={a.person_id} className="flex items-center gap-2">
              {(a.people as unknown as { name: string } | null)?.name}
              <form action={removeAttendee}><input type="hidden" name="meeting_id" value={id} /><input type="hidden" name="person_id" value={a.person_id} /><button className="text-xs underline">remove</button></form>
            </li>
          ))}
          {!attendees?.length && <li className="text-neutral-500">No attendees yet.</li>}
        </ul>
        <form action={addAttendee} className="mt-2 flex gap-2">
          <input type="hidden" name="meeting_id" value={id} />
          <select name="person_id" required defaultValue="" aria-label="Add attendee" className={`${input} flex-1`}>
            <option value="" disabled>Add attendee…</option>
            {people?.filter((p) => !present.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <SubmitButton variant="secondary">Add</SubmitButton>
        </form>
        {!people?.length && <p className="mt-1 text-xs text-neutral-500">Add people on the <Link href="/people" className="underline">People</Link> page first.</p>}
      </section>

      <section className={`${card} mt-4`}>
        <h2 className="font-medium">Commitments from this meeting</h2>
        <ul className="mt-2 text-sm">
          {commitments?.map((c) => <li key={c.id}>{c.description} <span className="text-xs text-neutral-500">· {c.status}</span></li>)}
          {!commitments?.length && <li className="text-neutral-500">None. Add one on the <Link href={`/commitments?meeting=${id}`} className="underline">Commitments</Link> page.</li>}
        </ul>
      </section>

      <section className={`${card} mt-4`}>
        <h2 className="font-medium">Follow-up task</h2>
        <form action={createMeetingFollowUp} className="mt-2 flex flex-wrap items-end gap-2">
          <input type="hidden" name="meeting_id" value={id} />
          <input type="hidden" name="workspace_id" value={defaultWs} />
          <input type="hidden" name="client_request_id" value={crypto.randomUUID()} />
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs">Task<input name="title" required defaultValue={`Follow up: ${m.title}`} className={input} /></label>
          <label className="flex flex-col gap-1 text-xs">Deadline<input type="date" name="deadline" className={input} /></label>
          <SubmitButton variant="secondary">Create task</SubmitButton>
        </form>
      </section>

      <form action={deleteMeeting} className={`${card} mt-4 flex items-center gap-2`}>
        <input type="hidden" name="id" value={id} />
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="confirm" value="yes" /> Confirm delete</label>
        <SubmitButton variant="secondary">Delete meeting</SubmitButton>
      </form>
    </div>
  );
}
