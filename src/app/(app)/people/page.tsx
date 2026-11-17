import Link from "next/link";
import { NewPanel } from "@/components/new-panel";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaces } from "@/lib/data";
import { input, card } from "@/lib/ui";
import { createPerson, deletePerson } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ error?: string; q?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("people").select("id, name, organization, position, category, email, phone, notes").is("deleted_at", null).order("name");
  const term = sp.q?.trim().slice(0, 100);
  if (term) q = q.or(`name.ilike.%${term.replace(/[%,()]/g, " ")}%,organization.ilike.%${term.replace(/[%,()]/g, " ")}%`);
  const [{ data: people }, { data: workspaces }, { data: open }] = await Promise.all([
    q,
    getWorkspaces().then((data) => ({ data })),
    supabase.from("commitments").select("made_by_person_id, made_to_person_id").is("deleted_at", null).in("status", ["pending", "in_progress"]),
  ]);
  const openCount = new Map<string, number>();
  for (const c of open ?? []) for (const id of [c.made_by_person_id, c.made_to_person_id]) if (id) openCount.set(id, (openCount.get(id) ?? 0) + 1);

  return (
    <div className="max-w-3xl">
      <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">People</h1>
      {sp.error && <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{sp.error}</p>}
      <form className="mt-3 flex gap-2"><input name="q" defaultValue={term} placeholder="Search name or organization" className={`${input} flex-1`} /><SubmitButton variant="secondary">Search</SubmitButton></form>

      <NewPanel label="New person">
      <form action={createPerson} className={`${card} grid gap-2 sm:grid-cols-2`}>
        <label className="flex flex-col gap-1 text-xs">Name<input name="name" required maxLength={200} className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Organization<input name="organization" className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Position<input name="position" className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Category (investor, merchant, mentor…)<input name="category" className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Email<input type="email" name="email" className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Phone<input name="phone" className={input} /></label>
        <label className="flex flex-col gap-1 text-xs">Workspace
          <select name="workspace_id" defaultValue="" className={input}><option value="">None</option>{workspaces?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs">Notes<input name="notes" className={input} /></label>
        <div><SubmitButton variant="primary">Add person</SubmitButton></div>
      </form>
      </NewPanel>

      {!people?.length && <p className="mt-6 text-neutral-500">No people yet.</p>}
      <ul className="mt-6 flex flex-col gap-3">
        {people?.map((p) => (
          <li key={p.id} className={card}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link href={`/commitments?person=${p.id}`} className="font-medium hover:underline">{p.name}</Link>
              <span className="text-xs text-neutral-500">{[p.position, p.organization, p.category].filter(Boolean).join(" · ")}</span>
            </div>
            <p className="text-sm text-neutral-600">{[p.email, p.phone].filter(Boolean).join(" · ")}</p>
            {p.notes && <p className="text-sm text-neutral-600">{p.notes}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
              <Link href={`/commitments?person=${p.id}`} className="underline">{openCount.get(p.id) ?? 0} open commitment{openCount.get(p.id) === 1 ? "" : "s"}</Link>
              <form action={deletePerson} className="flex items-center gap-2">
                <input type="hidden" name="id" value={p.id} />
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="confirm" value="yes" /> Confirm delete</label>
                <SubmitButton variant="secondary">Delete</SubmitButton>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
