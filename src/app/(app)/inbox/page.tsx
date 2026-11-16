import { createClient } from "@/lib/supabase/server";
import { CAPTURE_TYPES, PRIORITY_LABEL, input, btn, btnPrimary, card } from "@/lib/ui";
import { archiveCapture, convertToTask, deleteCapture, saveTriage } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: items } = await supabase
    .from("quick_capture")
    .select("id, capture_type, raw_text, workspace_id, priority, due_date, captured_at")
    .eq("status", "inbox").is("deleted_at", null)
    .order("captured_at", { ascending: false });
  const { data: workspaces } = await supabase
    .from("workspaces").select("id, name").is("archived_at", null).order("sort_order");
  const typeLabel = Object.fromEntries(CAPTURE_TYPES.map((t) => [t.value, t.label]));

  return (
    <div className="max-w-3xl">
      <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">Inbox</h1>
      <p className="text-sm text-neutral-500">Captured items waiting to be sorted. Use the + Capture button anywhere to add more.</p>
      {error && <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {!items?.length && <p className="mt-8 text-neutral-500">Inbox is empty.</p>}
      <ul className="mt-6 flex flex-col gap-4">
        {items?.map((c) => (
          <li key={c.id} className={card}>
            <p className="text-xs font-semibold text-neutral-500">{typeLabel[c.capture_type] ?? c.capture_type}</p>
            <p className="mt-1 whitespace-pre-wrap">{c.raw_text}</p>

            <form className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={c.id} />
              <label className="flex flex-col gap-1 text-xs">Workspace
                <select name="workspace_id" defaultValue={c.workspace_id ?? ""} className={input}>
                  <option value="">Not set</option>
                  {workspaces?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">Priority
                <select name="priority" defaultValue={c.priority ?? ""} className={input}>
                  <option value="">Normal</option>
                  {Object.entries(PRIORITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">Deadline
                <input type="date" name="due_date" defaultValue={c.due_date ?? ""} className={input} />
              </label>
              <button formAction={saveTriage} className={btn}>Save</button>
              <button formAction={convertToTask} className={btnPrimary}>Convert to task</button>
            </form>

            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <form action={archiveCapture}>
                <input type="hidden" name="id" value={c.id} />
                <SubmitButton variant="secondary">Archive</SubmitButton>
              </form>
              <form action={deleteCapture} className="flex items-center gap-2">
                <input type="hidden" name="id" value={c.id} />
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="confirm" value="yes" /> Confirm delete</label>
                <SubmitButton variant="secondary">Delete</SubmitButton>
              </form>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-xs text-neutral-500">
        Turning a capture into a meeting, promise or commitment arrives in Phase 3. For now those items can be kept, archived or converted to a task.
      </p>
    </div>
  );
}
