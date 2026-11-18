"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { currentConversation, makeCtx, runLog, runTurn } from "@/lib/ai/turn";

const uuid = z.string().uuid();
function go(error?: string): never {
  revalidatePath("/assistant");
  redirect(error ? `/assistant?error=${encodeURIComponent(error)}` : "/assistant");
}

export async function newChat() {
  const supabase = await createClient();
  await supabase.from("ai_conversations").update({ archived_at: new Date().toISOString() }).is("archived_at", null);
  go();
}

export async function askAssistant(formData: FormData) {
  const text = z.string().trim().min(1, "Write a message first.").max(2000, "Keep it under 2,000 characters.").safeParse(formData.get("message"));
  if (!text.success) go(text.error.issues[0].message);
  const supabase = await createClient();
  const r = await runTurn(supabase, text.data, formData.get("voice") === "1");
  go(r.ok ? undefined : r.error);
}

export async function approveAction(formData: FormData) {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) go("Invalid action.");
  const supabase = await createClient();
  const c = await makeCtx(supabase);
  const { data: log } = await supabase.from("ai_action_logs").select("status").eq("id", id.data).maybeSingle();
  if (log?.status !== "awaiting_approval") go("That action is no longer waiting for approval.");
  await runLog(c, id.data!);
  go();
}

export async function approveAll() {
  const supabase = await createClient();
  const c = await makeCtx(supabase);
  const conv = await currentConversation(supabase);
  const { data: logs } = await supabase.from("ai_action_logs").select("id, requires_confirmation").eq("conversation_id", conv).eq("tool_kind", "write").eq("status", "awaiting_approval").order("created_at");
  for (const l of logs ?? []) if (!l.requires_confirmation) await runLog(c, l.id);
  go((logs ?? []).some((l) => l.requires_confirmation) ? "Deletions were left for you to confirm one by one." : undefined);
}

export async function setAutoApprove(formData: FormData) {
  const on = formData.get("on") === "true";
  const supabase = await createClient();
  await supabase.from("user_settings").update({ ai_auto_approve: on }).not("owner_id", "is", null);
  go();
}

export async function rejectAction(formData: FormData) {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) go("Invalid action.");
  const supabase = await createClient();
  await supabase.from("ai_action_logs").update({ status: "rejected" }).eq("id", id.data).eq("status", "awaiting_approval");
  go();
}

// Fallback when Gemini is unavailable: keep the words, sort later.
export async function saveToInbox(formData: FormData) {
  const text = z.string().trim().min(1).max(2000).safeParse(formData.get("text"));
  if (!text.success) go("Nothing to save.");
  const supabase = await createClient();
  const { error } = await supabase.from("quick_capture").insert({ raw_text: text.data, source: "typed" });
  go(error?.message);
}
