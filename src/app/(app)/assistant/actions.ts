"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { askGemini } from "@/lib/ai/gemini";
import { TOOL_SCHEMAS, isToolName, resolveWorkspace, previewText, type ToolName, type Workspace } from "@/lib/ai/tools";
import { dateInTz, rangeUtc } from "@/lib/time";

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

// Validates one proposed call against the schema and the database. Never trusts ids or names from the model.
async function validate(supabase: SupabaseClient, name: string, args: Record<string, unknown>, workspaces: Workspace[]):
  Promise<{ ok: true; input: Record<string, unknown>; preview: string } | { ok: false; error: string }> {
  if (!isToolName(name)) return { ok: false, error: `Unknown action "${name}" was refused.` };
  const parsed = TOOL_SCHEMAS[name].safeParse(args);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
  const input = { ...(parsed.data as Record<string, unknown>) };
  let taskTitle: string | undefined, wsName: string | undefined;
  const taskId = input.task_id as string | undefined;
  if (taskId) {
    const { data: t } = await supabase.from("tasks").select("title, status").eq("id", taskId).is("deleted_at", null).maybeSingle();
    if (!t) return { ok: false, error: "That task does not exist." };
    taskTitle = t.title;
  }
  if (name === "create_task") {
    if (input.parent_task_id) {
      const { data: p } = await supabase.from("tasks").select("workspace_id, title").eq("id", input.parent_task_id as string).is("deleted_at", null).maybeSingle();
      if (!p) return { ok: false, error: "The parent task does not exist." };
      input.workspace_id = p.workspace_id;
      wsName = workspaces.find((w) => w.id === p.workspace_id)?.name;
    } else {
      const r = resolveWorkspace(input.workspace as string | undefined, workspaces);
      if ("error" in r) return { ok: false, error: r.error };
      input.workspace_id = r.id; wsName = r.name;
    }
  }
  return { ok: true, input, preview: previewText(name as ToolName, input, taskTitle, wsName) };
}

export async function askAssistant(formData: FormData) {
  const text = z.string().trim().min(1, "Write a message first.").max(2000, "Keep it under 2,000 characters.").safeParse(formData.get("message"));
  if (!text.success) go(text.error.issues[0].message);
  const supabase = await createClient();
  const { data: settings } = await supabase.from("user_settings").select("timezone").maybeSingle();
  const tz = settings?.timezone ?? "Asia/Karachi";
  const today = dateInTz(new Date(), tz);

  // Your own daily cap, so you reach it before Google's limit does.
  const cap = Number(process.env.AI_DAILY_REQUEST_CAP || 100);
  const { start, end } = rangeUtc(today, today, tz);
  const { count } = await supabase.from("ai_messages").select("id", { count: "exact", head: true }).eq("role", "user")
    .gte("created_at", start.toISOString()).lt("created_at", end.toISOString());
  if ((count ?? 0) >= cap) go(`Daily assistant limit reached (${cap}). Use the Inbox for notes; it resets tomorrow.`);

  const conversationId = await currentConversation(supabase);
  const { data: userMsg, error: e1 } = await supabase.from("ai_messages")
    .insert({ conversation_id: conversationId, role: "user", content: text.data, input_mode: "text" }).select("id").single();
  if (e1 || !userMsg) go(e1?.message ?? "Could not save your message.");

  const [{ data: ws }, { data: tasks }, { data: past }] = await Promise.all([
    supabase.from("workspaces").select("id, name").is("archived_at", null).order("sort_order"),
    supabase.from("task_overview").select("id, title, status, priority, current_deadline, workspace_id, parent_task_id").in("status", ["not_started", "in_progress", "waiting"]).order("current_deadline", { nullsFirst: false }).limit(60),
    supabase.from("ai_messages").select("role, content").eq("conversation_id", conversationId).in("role", ["user", "assistant"]).order("created_at", { ascending: false }).limit(12),
  ]);
  const wsList: Workspace[] = ws ?? [];
  const wsName = new Map(wsList.map((w) => [w.id, w.name]));
  const context = `TODAY: ${today} (${tz})\nWORKSPACES: ${wsList.map((w) => w.name).join(", ")}\nOPEN TASKS (id | title | workspace | priority | deadline):\n` +
    ((tasks ?? []).map((t) => `${t.id} | ${t.title} | ${wsName.get(t.workspace_id)} | ${t.priority} | ${t.current_deadline ?? "none"}${t.parent_task_id ? " | subtask" : ""}`).join("\n") || "(none)");
  const history = (past ?? []).reverse().filter((m) => m.content).map((m) => ({ role: (m.role === "user" ? "user" : "model") as "user" | "model", text: m.content as string }));

  const r = await askGemini(history, context);
  if (!r.ok) {
    await supabase.from("ai_messages").insert({ conversation_id: conversationId, role: "system", content: r.message });
    go();
  }
  const g = r as Extract<typeof r, { ok: true }>;
  const { data: aMsg } = await supabase.from("ai_messages").insert({
    conversation_id: conversationId, role: "assistant", content: g.text || (g.calls.length ? "Here is what I would do:" : "…"),
    tool_calls: g.calls.length ? g.calls : null, model: g.model,
  }).select("id").single();

  for (const [i, c] of g.calls.slice(0, 5).entries()) {
    const v = await validate(supabase, c.name, c.args, wsList);
    await supabase.from("ai_action_logs").insert({
      conversation_id: conversationId, message_id: aMsg?.id ?? null, tool_name: c.name.slice(0, 60), tool_kind: "write",
      proposed_input: c.args, validated_input: v.ok ? v.input : null, preview: v.ok ? { text: v.preview } : null,
      status: v.ok ? "awaiting_approval" : "failed", error: v.ok ? null : v.error, model: g.model,
      idempotency_key: `${aMsg?.id ?? userMsg.id}:${i}`,
    });
  }
  go();
}

type Done = { type: string; ids: string[]; verified: boolean };
// Runs one validated action, then reads the row back. "Executed" is only recorded if the read-back matches.
async function execute(supabase: SupabaseClient, tool: ToolName, i: Record<string, unknown>, logId: string): Promise<Done> {
  switch (tool) {
    case "create_task": {
      const { data, error } = await supabase.from("tasks").insert({
        workspace_id: i.workspace_id, parent_task_id: i.parent_task_id ?? null, title: i.title,
        priority: i.priority ?? "normal", current_deadline: i.deadline ?? null, client_request_id: logId,
      }).select("id, title").single();
      if (error) {
        if (error.code === "23505") { // already created by an earlier approval click
          const { data: ex } = await supabase.from("tasks").select("id").eq("client_request_id", logId).maybeSingle();
          if (ex) return { type: "task", ids: [ex.id], verified: true };
        }
        throw new Error(error.message);
      }
      const { data: back } = await supabase.from("tasks").select("id").eq("id", data.id).maybeSingle();
      return { type: "task", ids: [data.id], verified: !!back };
    }
    case "complete_task": {
      const { error } = await supabase.from("tasks").update({ status: "completed" }).eq("id", i.task_id as string);
      if (error) throw new Error(error.message);
      const { data: back } = await supabase.from("tasks").select("status").eq("id", i.task_id as string).maybeSingle();
      return { type: "task", ids: [i.task_id as string], verified: back?.status === "completed" };
    }
    case "reschedule_task": {
      const { error } = await supabase.rpc("reschedule_task", { p_task_id: i.task_id, p_new_deadline: i.new_deadline, p_reason: i.reason ?? "Moved by assistant" });
      if (error) throw new Error(error.message);
      const { data: back } = await supabase.from("tasks").select("current_deadline").eq("id", i.task_id as string).maybeSingle();
      return { type: "task", ids: [i.task_id as string], verified: back?.current_deadline === i.new_deadline };
    }
    case "log_time": {
      const { data: t } = await supabase.from("tasks").select("workspace_id").eq("id", i.task_id as string).maybeSingle();
      if (!t) throw new Error("Task not found.");
      const { data, error } = await supabase.from("time_entries").insert({
        task_id: i.task_id, workspace_id: t.workspace_id, duration_minutes: i.minutes, note: i.note ?? null, source: "manual", client_request_id: logId,
      }).select("id").single();
      if (error) throw new Error(error.message);
      const { data: back } = await supabase.from("time_entries").select("duration_minutes").eq("id", data.id).maybeSingle();
      return { type: "time_entry", ids: [data.id], verified: back?.duration_minutes === i.minutes };
    }
    case "add_to_inbox": {
      const { data, error } = await supabase.from("quick_capture").insert({ raw_text: i.text, capture_type: i.kind ?? "general", source: "ai", client_request_id: logId }).select("id").single();
      if (error) throw new Error(error.message);
      const { data: back } = await supabase.from("quick_capture").select("id").eq("id", data.id).maybeSingle();
      return { type: "quick_capture", ids: [data.id], verified: !!back };
    }
  }
}

export async function approveAction(formData: FormData) {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) go("Invalid action.");
  const supabase = await createClient();
  // Only an action still waiting for approval can move to "executing"; the update itself is the lock.
  const { data: log } = await supabase.from("ai_action_logs")
    .update({ status: "executing", approved_at: new Date().toISOString() })
    .eq("id", id.data).eq("status", "awaiting_approval").select("id, tool_name, validated_input").maybeSingle();
  if (!log || !isToolName(log.tool_name) || !log.validated_input) go("That action is no longer waiting for approval.");
  try {
    const done = await execute(supabase, log!.tool_name as ToolName, log!.validated_input as Record<string, unknown>, log!.id);
    await supabase.from("ai_action_logs").update(done.verified
      ? { status: "executed", write_verified: true, affected_entity_type: done.type, affected_entity_ids: done.ids, executed_at: new Date().toISOString(), result: { ok: true } }
      : { status: "failed", write_verified: false, error: "The change could not be confirmed in the database.", affected_entity_type: done.type, affected_entity_ids: done.ids }).eq("id", log!.id);
  } catch (e) {
    await supabase.from("ai_action_logs").update({ status: "failed", error: e instanceof Error ? e.message.slice(0, 300) : "Failed." }).eq("id", log!.id);
  }
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
