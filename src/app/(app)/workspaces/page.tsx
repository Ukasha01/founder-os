import Link from "next/link";
import { NewPanel } from "@/components/new-panel";
import { createClient } from "@/lib/supabase/server";
import { createWorkspace, renameWorkspace, setWorkspaceArchived } from "./actions";
import { SubmitButton } from "@/components/submit-button";

const input = "rounded-md border border-neutral-300 px-3 py-2 text-base";
const btn = "rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50";

export default async function WorkspacesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: all } = await supabase.from("workspaces").select("id, name, archived_at").order("sort_order").order("name");
  const active = all?.filter((w) => !w.archived_at) ?? [];
  const archived = all?.filter((w) => w.archived_at) ?? [];

  return (
    <div className="max-w-2xl">
      <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">Workspaces</h1>
      {error && <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <ul className="mt-6 flex flex-col gap-3">
        {active.map((w) => (
          <li key={w.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 p-3">
            <form action={renameWorkspace} className="flex flex-1 gap-2">
              <input type="hidden" name="id" value={w.id} />
              <input name="name" defaultValue={w.name} aria-label={`Rename ${w.name}`} className={`${input} min-w-0 flex-1`} />
              <SubmitButton variant="secondary">Rename</SubmitButton>
            </form>
            <Link href={`/workspaces/${w.id}`} className={btn}>Open</Link>
            <form action={setWorkspaceArchived}>
              <input type="hidden" name="id" value={w.id} />
              <input type="hidden" name="archive" value="true" />
              <SubmitButton variant="secondary">Archive</SubmitButton>
            </form>
          </li>
        ))}
      </ul>

      <NewPanel label="New workspace">
      <form action={createWorkspace} className="flex gap-2">
        <input name="name" placeholder="New workspace name" aria-label="New workspace name" required className={`${input} flex-1`} />
        <button className="rounded-md bg-neutral-900 px-4 py-2 text-white">Add</button>
      </form>
      </NewPanel>

      {archived.length > 0 && (
        <>
          <h2 className="mt-10 mb-3 text-[15px] font-semibold">Archived</h2>
          <ul className="flex flex-col gap-2">
            {archived.map((w) => (
              <li key={w.id} className="flex items-center justify-between rounded-lg border border-dashed border-neutral-300 p-3">
                <span className="text-neutral-600">{w.name}</span>
                <form action={setWorkspaceArchived}>
                  <input type="hidden" name="id" value={w.id} />
                  <input type="hidden" name="archive" value="false" />
                  <SubmitButton variant="secondary">Restore</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
