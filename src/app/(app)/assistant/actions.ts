"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { askGemini, textContent, type GeminiContent } from "@/lib/ai/gemini";
import { isToolName, isRead, needsConfirmation, type ToolName, type Workspace } from "@/lib/ai/tools";
import { runRead, validateWrite, executeWrite, type Ctx } from "@/lib/ai/registry";
import { addDays, dateInTz, rangeUtc } from "@/lib/time";

const uuid = z.string().uuid();
function go(error?: string): never {
  revalidatePath("/assistant");
  redirect(error ? `/assistant?error=${encodeURIComponent(error)}` : "/assistant");
}

async function currentConversation(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase.from("ai_conversations").select("id").is("archived_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (data) return data.id;
  const { data: created, error } = await supabase.from("ai_conversations").insert({ title: "Assistant" }).select("id").single();
  if (error || !created) throw new Error(error?.message ?? "Could not start a conversation.");
  return created.id;
}

export async function newChat() {
  const supabase = await createClient();
  await supabase.from("ai_conversations").update({ archived_at: new Date().toISOString() }).is("archived_at", null);
  go();
}

async function makeCtx(supabase: SupabaseClient): Promise<Ctx> {
  const [{ data: settings }, { data: ws }] = await Promise.all([
    supabase.from("user_settings").select("timezone").maybeSingle(),
    supabase.from("workspaces").select("id, name").is("archived_at", null).order("sort_order"),
  ]);
  const tz = settings?.timezone ?? "Asia/Karachi";
  return { supabase, tz, today: dateInTz(new Date(), tz), workspaces: (ws ?? []) as Workspace[] };
}

// Approval is a lock: only an action still "awaiting_approval" can move to "executing", so a double click
// or a replay can never run it twice. "Executed" is recorded only if the change is read back from the database.
async function runLog(c: Ctx, logId: string): Promise<boolean> {
  const { data: log } = await c.supabase.from("ai_action_logs")
    .update({ status: "executing", approved_at: new Date().toISOString() })
    .eq("id", logId).eq("status", "awaiting_approval").select("id, tool_name, validated_input").maybeSingle();
  if (!log || !isToolName(log.tool_name) || !log.validated_input) return false;
  try {
    const done = await executeWrite(c, log.tool_name, log.validated_input as Record<string, unknown>, log.id);
    await c.supabase.from("ai_action_logs").update(done.verified
      ? { status: "executed", write_verified: true, affected_entity_type: done.type, affected_entity_ids: done.ids, executed_at: new Date().toISOString(), result: { ok: true } }
      : { status: "failed", write_verified: false, error: "The change could not be confirmed in the database.", affected_entity_type: done.type, affected_entity_ids: done.ids }).eq("id", log.id);
    return done.verified;
  } catch (e) {
    await c.supabase.from("ai_action_logs").update({ status: "failed", error: e instanceof Error ? e.message.slice(0, 300) : "Failed." }).eq("id", log.id);
    return false;
  }
}

type Proposal = { name: string; args: Record<string, unknown> };

export async function askAssistant(formData: FormData) {
  const text = z.string().trim().min(1, "Write a message first.").max(2000, "Keep it under 2,000 characters.").safeParse(formData.get("message"));
  if (!text.success) go(text.error.issues[0].message);
  const supabase = await createClient();
  const c = await makeCtx(supabase);

  // Your own daily cap, so you reach it before Google's limit does.
  const cap = Number(process.env.AI_DAILY_REQUEST_CAP || 100);
  const { start, end } = rangeUtc(c.today, c.today, c.tz);
  const { count } = await supabase.from("ai_messages").select("id", { count: "exact", head: true }).eq("role", "user")
    .gte("created_at", start.toISOString()).lt("created_at", end.toISOString());
  if ((count ?? 0) >= cap) go(`Daily assistant limit reached (${cap}). Use the Inbox for notes; it resets tomorrow.`);

  const conversationId = await currentConversation(supabase);
  const { data: userMsg, error: e1 } = await supabase.from("ai_messages")
    .insert({ conversation_id: conversationId, role: "user", content: text.data, input_mode: formData.get("voice") === "1" ? "voice" : "text" }).select("id").single();
  if (e1 || !userMsg) go(e1?.message ?? "Could not save your message.");

  const [{ data: tasks }, { data: past }, { data: st }] = await Promise.all([
    supabase.from("task_overview").select("id, title, priority, current_deadline, workspace_id").in("status", ["not_started", "in_progress", "waiting"]).order("current_deadline", { nullsFirst: false }).limit(25),
    supabase.from("ai_messages").select("role, content").eq("conversation_id", conversationId).in("role", ["user", "assistant"]).order("created_at", { ascending: false }).limit(12),
    supabase.from("user_settings").select("ai_auto_approve").maybeSingle(),
  ]);
  const wsName = new Map(c.workspaces.map((w) => [w.id, w.name]));
  const context = `TODAY: ${c.today} (${c.tz}); tomorrow is ${addDays(c.today, 1)}\nWORKSPACES: ${c.workspaces.map((w) => w.name).join(", ")}\nSOME OPEN TASKS (id | title | workspace | priority | deadline; use list_tasks for more):\n` +
    ((tasks ?? []).map((t) => `${t.id} | ${t.title} | ${wsName.get(t.workspace_id)} | ${t.priority} | ${t.current_deadline ?? "none"}`).join("\n") || "(none)");
  const contents: GeminiContent[] = (past ?? []).reverse().filter((m) => m.content).map((m) => textContent(m.role === "user" ? "user" : "model", m.content as string));

  const proposals: Proposal[] = [];
  const readLog: { tool_name: string; input: Record<string, unknown> }[] = [];
  let finalText = "", model = "", failure: string | null = null;
  for (let round = 0; round < 5; round++) {
    const r = await askGemini(contents, context);
    if (!r.ok) { failure = r.message; break; }
    model = r.model;
    const reads = r.calls.filter((x) => isToolName(x.name) && isRead(x.name));
    for (const x of r.calls) if (!(isToolName(x.name) && isRead(x.name))) proposals.push({ name: x.name, args: x.args });
    if (!reads.length) { finalText = r.text; break; }
    // Answer every call the model made, in order: reads with real data, writes with "queued".
    const answers = [];
    for (const x of r.calls) {
      if (isToolName(x.name) && isRead(x.name)) {
        let out: Record<string, unknown>;
        try { out = await runRead(c, x.name, x.args); } catch (e) { out = { error: e instanceof Error ? e.message.slice(0, 200) : "Could not read that." }; }
        readLog.push({ tool_name: x.name, input: x.args });
        answers.push({ functionResponse: { name: x.name, response: { output: out } } });
      } else {
        answers.push({ functionResponse: { name: x.name, response: { output: { status: "queued: shown to the user for approval" } } } });
      }
    }
    contents.push({ role: "model", parts: r.parts }, { role: "user", parts: answers });
    if (round === 4) finalText = r.text || "I looked up your data but ran out of steps. Please ask again, more specifically.";
  }

  if (failure && !proposals.length) {
    await supabase.from("ai_messages").insert({ conversation_id: conversationId, role: "system", content: failure });
    go();
  }
  const { data: aMsg } = await supabase.from("ai_messages").insert({
    conversation_id: conversationId, role: "assistant", model,
    content: finalText || (proposals.length ? "Here is what I would do:" : failure ?? "…"),
    tool_calls: proposals.length ? proposals : null,
  }).select("id").single();

  for (const [i, x] of readLog.entries()) {
    await supabase.from("ai_action_logs").insert({ conversation_id: conversationId, message_id: aMsg?.id ?? null, tool_name: x.tool_name.slice(0, 60), tool_kind: "read",
      proposed_input: x.input, status: "executed", model, idempotency_key: `${aMsg?.id ?? userMsg.id}:r${i}`, executed_at: new Date().toISOString() });
  }
  const auto = !!st?.ai_auto_approve;
  for (const [i, x] of proposals.slice(0, 8).entries()) {
    const known = isToolName(x.name);
    const v = known ? await validateWrite(c, x.name as ToolName, x.args) : ({ ok: false, error: `Unknown action "${x.name}" was refused.` } as const);
    const confirm = known && needsConfirmation(x.name as ToolName);
    const { data: row } = await supabase.from("ai_action_logs").insert({
      conversation_id: conversationId, message_id: aMsg?.id ?? null, tool_name: x.name.slice(0, 60), tool_kind: "write", requires_confirmation: confirm,
      proposed_input: x.args, validated_input: v.ok ? v.input : null, preview: v.ok ? { text: v.preview } : null,
      status: v.ok ? "awaiting_approval" : "failed", error: v.ok ? null : v.error, model, idempotency_key: `${aMsg?.id ?? userMsg.id}:${i}`,
    }).select("id").single();
    if (v.ok && auto && !confirm && row) await runLog(c, row.id);
  }
  if (failure) await supabase.from("ai_messages").insert({ conversation_id: conversationId, role: "system", content: failure });
  go();
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
