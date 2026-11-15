"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const name = z.string().trim().min(1, "Name is required.").max(120, "Name is too long.");
const id = z.string().uuid();

function back(error?: string): never {
  redirect(error ? `/workspaces?error=${encodeURIComponent(error)}` : "/workspaces");
}

// Postgres unique violation (duplicate active name) -> friendly message.
function explain(err: { code?: string; message: string }) {
  return err.code === "23505" ? "An active workspace with that name already exists." : err.message;
}

export async function createWorkspace(formData: FormData) {
  const n = name.safeParse(formData.get("name"));
  if (!n.success) back(n.error.issues[0].message);
  const supabase = await createClient();
  const { count } = await supabase.from("workspaces").select("id", { count: "exact", head: true });
  const { error } = await supabase.from("workspaces").insert({ name: n.data!, sort_order: (count ?? 0) + 1 });
  if (error) back(explain(error));
  revalidatePath("/", "layout");
  back();
}

export async function renameWorkspace(formData: FormData) {
  const n = name.safeParse(formData.get("name"));
  const i = id.safeParse(formData.get("id"));
  if (!n.success || !i.success) back(n.success ? "Invalid workspace." : n.error.issues[0].message);
  const supabase = await createClient();
  const { error } = await supabase.from("workspaces").update({ name: n.data! }).eq("id", i.data!);
  if (error) back(explain(error));
  revalidatePath("/", "layout");
  back();
}

export async function setWorkspaceArchived(formData: FormData) {
  const i = id.safeParse(formData.get("id"));
  if (!i.success) back("Invalid workspace.");
  const archive = formData.get("archive") === "true";
  const supabase = await createClient();
  const { error } = await supabase.from("workspaces")
    .update({ archived_at: archive ? new Date().toISOString() : null }).eq("id", i.data!);
  if (error) back(explain(error));
  revalidatePath("/", "layout");
  back();
}
