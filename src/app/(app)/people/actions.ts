"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const txt = (n: number) => z.string().trim().max(n).optional().transform((v) => v || null);
function go(error?: string): never {
  revalidatePath("/people");
  redirect(error ? `/people?error=${encodeURIComponent(error)}` : "/people");
}

export async function createPerson(formData: FormData) {
  const p = z.object({
    name: z.string().trim().min(1, "Name is required.").max(200),
    organization: txt(200), position: txt(200), email: txt(200), phone: txt(60), category: txt(100), notes: txt(5000),
    workspace_id: z.string().uuid().optional().or(z.literal("")).transform((v) => v || null),
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) go(p.error.issues[0].message);
  const supabase = await createClient();
  const { error } = await supabase.from("people").insert(p.data!);
  go(error?.message);
}

export async function deletePerson(formData: FormData) {
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) go("Invalid person.");
  if (formData.get("confirm") !== "yes") go("Tick “Confirm delete” first.");
  const supabase = await createClient();
  const { error } = await supabase.from("people").update({ deleted_at: new Date().toISOString() }).eq("id", id.data!);
  go(error?.message);
}
