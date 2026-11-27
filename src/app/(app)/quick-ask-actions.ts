"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { currentConversation, expireStaleApprovals, makeCtx, runLog } from "@/lib/ai/turn";

export type Pending = { id: string; text: string };
const uuid = z.string().uuid();

// What the assistant is waiting on you to approve, for the quick-ask panel.
export async function pendingActions(): Promise<Pending[]> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return [];
  await expireStaleApprovals(supabase);
  const conv = await currentConversation(supabase);
  const { data: logs } = await supabase.from("ai_action_logs").select("id, tool_name, preview").eq("conversation_id", conv).eq("tool_kind", "write").eq("status", "awaiting_approval").order("created_at");
  return (logs ?? []).map((l) => ({ id: l.id as string, text: ((l.preview as { text?: string } | null)?.text ?? (l.tool_name as string)) }));
}

export async function approveOne(id: string): Promise<{ ok: boolean; error?: string }> {
  const p = uuid.safeParse(id);
  if (!p.success) return { ok: false, error: "Invalid action." };
  const supabase = await createClient();
  const c = await makeCtx(supabase);
  const { data: log } = await supabase.from("ai_action_logs").select("status").eq("id", p.data).maybeSingle();
  if (log?.status !== "awaiting_approval") return { ok: false, error: "That action is no longer waiting for approval." };
  const ok = await runLog(c, p.data);
  revalidatePath("/", "layout");
  return ok ? { ok: true } : { ok: false, error: "That action could not be completed." };
}

export async function skipOne(id: string): Promise<{ ok: boolean }> {
  const p = uuid.safeParse(id);
  if (!p.success) return { ok: false };
  const supabase = await createClient();
  await supabase.from("ai_action_logs").update({ status: "rejected" }).eq("id", p.data).eq("status", "awaiting_approval");
  return { ok: true };
}
