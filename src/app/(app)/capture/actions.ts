"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isDuplicate } from "@/lib/tasks";

const schema = z.object({
  raw_text: z.string().trim().min(1, "Write something to capture.").max(5000),
  capture_type: z.enum(["task", "subtask", "idea", "meeting", "promise", "commitment",
    "follow_up", "reminder", "note", "expense", "general"]),
  client_request_id: z.string().uuid(),
  workspace_id: z.string().uuid().optional().or(z.literal("")),
});

export type CaptureResult = { ok: true } | { ok: false; error: string };

// Saves instantly with no other fields required; it lands in the Inbox.
// client_request_id makes a double click or retry harmless (the database rejects the duplicate).
export async function captureItem(_prev: CaptureResult | null, formData: FormData): Promise<CaptureResult> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { raw_text, capture_type, client_request_id, workspace_id } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("quick_capture").insert({
    raw_text,
    capture_type,
    client_request_id,
    workspace_id: workspace_id || null,
    source: "typed",
  });
  if (error && !isDuplicate(error)) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}
