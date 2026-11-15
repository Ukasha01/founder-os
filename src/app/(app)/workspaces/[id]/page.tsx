import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// Workspace shell. The sections below are real modules that arrive in later phases;
// they are listed so the structure is visible, and are clearly marked as not yet available.
const SECTIONS: { name: string; phase: number }[] = [
  { name: "Tasks and subtasks", phase: 2 },
  { name: "Goals and milestones", phase: 2 },
  { name: "KPIs", phase: 3 },
  { name: "Meetings", phase: 3 },
  { name: "Notes", phase: 2 },
  { name: "Activity history", phase: 2 },
];

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const { data: ws } = await supabase.from("workspaces").select("id, name, description, archived_at").eq("id", id).maybeSingle();
  if (!ws) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">{ws.name}</h1>
      {ws.description && <p className="text-neutral-500">{ws.description}</p>}
      {ws.archived_at && <p className="mt-2 text-sm text-amber-800">This workspace is archived.</p>}
      <h2 className="mt-8 mb-3 text-sm font-medium uppercase tracking-wide text-neutral-500">Sections</h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <li key={s.name} className="rounded-lg border border-dashed border-neutral-300 p-3 text-sm text-neutral-500">
            {s.name} <span className="block text-xs">Not available yet (Phase {s.phase})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
