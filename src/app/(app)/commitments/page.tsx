import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { input, btn, btnPrimary, card } from "@/lib/ui";
import { dateInTz } from "@/lib/time";
import { createCommitment, createCommitmentTask, deleteCommitment, rescheduleCommitment, setCommitmentStatus } from "./actions";

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CommitmentsPage({ searchParams }: { searchParams: Promise<{ error?: string; person?: string; meeting?: string; all?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: settings }, { data: people }, { data: workspaces }] = await Promise.all([
    supabase.from("user_settings").select("timezone").maybeSingle(),
    supabase.from("people").select("id, name").is("deleted_at", null).order("name"),
    supabase.from("workspaces").select("id, name").is("archived_at", null).order("sort_order"),
  ]);
  const today = dateInTz(new Date(), settings?.timezone ?? "Asia/Karachi");
  const person = sp.person && uuidRe.test(sp.person) ? sp.person : null;
  const meeting = sp.meeting && uuidRe.test(sp.meeting) ? sp.meeting : null;
  let q = supabase.from("commitments")
    .select("id, description, made_by_person_id, made_to_person_id, due_date, follow_up_date, status, follow_up_task_id")
    .is("deleted_at", null).order("due_date", { nullsFirst: false }).limit(200);
  if (!sp.all) q = q.in("status", ["pending", "in_progress"]);
  if (person) q = q.or(`made_by_person_id.eq.${person},made_to_person_id.eq.${person}`);
  if (meeting) q = q.eq("meeting_id", meeting);
  const { data: items } = await q;
  const name = new Map((people ?? []).map((p) => [p.id, p.name]));
  const filterName = person ? name.get(person) : null;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Commitments</h1>
      <p className="text-sm text-neutral-500">Promises you made and promises made to you.</p>
      {sp.error && <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{sp.error}</p>}

      <form action={createCommitment} className={`${card} mt-4 grid gap-2 sm:grid-cols-2`}>
        <input type="hidden" name="client_request_id" value={crypto.randomUUID()} />
        {meeting && <input type="hidden" name="meeting_id" value={meeting} />}
        <label className="flex flex-col gap-1 text-xs sm:col-span-2">Commitment<input name="description" required maxLength={1000} className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Direction
          <select name="direction" className={input}><option value="by_me">I promised someone</option><option value="to_me">Someone promised me</option></select>
        </label>
        <label className="flex flex-col gap-1 text-xs">Person
          <select name="person_id" required defaultValue={person ?? ""} className={input}>
            <option value="" disabled>Choose…</option>{people?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">Due<input type="date" name="due_date" className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Follow up on<input type="date" name="follow_up_date" className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Workspace
          <select name="workspace_id" defaultValue="" className={input}><option value="">None</option>{workspaces?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        </label>
        <div className="self-end"><button className={btnPrimary}>Add commitment</button></div>
      </form>

      <p className="mt-4 text-sm">
        {filterName && <>Showing {filterName} · <Link href="/commitments" className="underline">clear</Link> · </>}
        {sp.all ? <Link href={person ? `/commitments?person=${person}` : "/commitments"} className="underline">Open only</Link>
          : <Link href={person ? `/commitments?person=${person}&all=1` : "/commitments?all=1"} className="underline">Include completed and cancelled</Link>}
      </p>

      <ul className="mt-3 flex flex-col gap-3">
        {!items?.length && <li className="text-neutral-500">No commitments.</li>}
        {items?.map((c) => {
          const mine = !c.made_by_person_id;
          const other = name.get((mine ? c.made_to_person_id : c.made_by_person_id) ?? "") ?? "someone";
          const late = c.due_date && c.due_date < today && ["pending", "in_progress"].includes(c.status);
          const followDue = c.follow_up_date && c.follow_up_date <= today && ["pending", "in_progress"].includes(c.status);
          return (
            <li key={c.id} className={card}>
              <p className="font-medium">{c.description}</p>
              <p className="text-sm text-neutral-600">
                {mine ? `I promised ${other}` : `${other} promised me`} · {c.status.replace("_", " ")}
                {c.due_date && <span className={late ? "font-medium text-red-700" : ""}> · due {c.due_date}{late ? " (overdue)" : ""}</span>}
                {c.follow_up_date && <span className={followDue ? "font-medium text-amber-700" : ""}> · follow up {c.follow_up_date}</span>}
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-3 text-sm">
                <form action={setCommitmentStatus} className="flex gap-1">
                  <input type="hidden" name="id" value={c.id} />
                  <select name="status" defaultValue={c.status} aria-label="Status" className={input}>
                    <option value="pending">Pending</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
                  </select>
                  <button className={btn}>Set</button>
                </form>
                <form action={rescheduleCommitment} className="flex gap-1">
                  <input type="hidden" name="id" value={c.id} />
                  <input type="date" name="due_date" defaultValue={c.due_date ?? ""} aria-label="Due" className={input} />
                  <input type="date" name="follow_up_date" defaultValue={c.follow_up_date ?? ""} aria-label="Follow up" className={input} />
                  <button className={btn}>Save dates</button>
                </form>
                {c.follow_up_task_id ? <Link href={`/tasks/${c.follow_up_task_id}`} className="underline">Open follow-up task</Link> : (
                  <form action={createCommitmentTask} className="flex gap-1">
                    <input type="hidden" name="id" value={c.id} />
                    <select name="workspace_id" aria-label="Workspace for task" className={input}>{workspaces?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
                    <button className={btn}>Create task</button>
                  </form>
                )}
                <form action={deleteCommitment} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={c.id} />
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="confirm" value="yes" /> Confirm</label>
                  <button className={btn}>Delete</button>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
