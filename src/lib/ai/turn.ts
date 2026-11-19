import type { SupabaseClient } from "@supabase/supabase-js";
import { askLlm, type Msg, type ToolResult } from "./llm";
import { isToolName, isRead, needsConfirmation, type ToolName, type Workspace } from "./tools";
import { runRead, validateWrite, executeWrite, type Ctx } from "./registry";
import { addDays, dateInTz, rangeUtc } from "../time";
import { classifyDecision } from "../voice-commands";
import { composeReply, isUrdu } from "./reply";

// One assistant turn, shared by the typed form (redirect-based server action) and the live voice endpoint (JSON).
export async function currentConversation(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase.from("ai_conversations").select("id").is("archived_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (data) return data.id;
  const { data: created, error } = await supabase.from("ai_conversations").insert({ title: "Assistant" }).select("id").single();
  if (error || !created) throw new Error(error?.message ?? "Could not start a conversation.");
  return created.id;
}

export async function makeCtx(supabase: SupabaseClient): Promise<Ctx> {
  const [{ data: settings }, { data: ws }] = await Promise.all([
    supabase.from("user_settings").select("timezone").maybeSingle(),
    supabase.from("workspaces").select("id, name").is("archived_at", null).order("sort_order"),
  ]);
  const tz = settings?.timezone ?? "Asia/Karachi";
  return { supabase, tz, today: dateInTz(new Date(), tz), workspaces: (ws ?? []) as Workspace[] };
}

// Approval is a lock: only an action still "awaiting_approval" can move to "executing", so a double click
// or a replay can never run it twice. "Executed" is recorded only if the change is read back from the database.
export async function runLog(c: Ctx, logId: string): Promise<boolean> {
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

// "Yes" / "no" answers to a pending confirmation are handled here, before the model, so they are instant and always
// consistent. Only actions proposed in the latest assistant message (within 10 minutes) are affected.
async function handleDecision(c: Ctx, conversationId: string, decision: "yes" | "no", urdu: boolean): Promise<TurnResult | null> {
  const { data: last } = await c.supabase.from("ai_messages").select("id, created_at").eq("conversation_id", conversationId).eq("role", "assistant").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!last || Date.now() - new Date(last.created_at).getTime() > 10 * 60_000) return null;
  const { data: logs } = await c.supabase.from("ai_action_logs").select("id, preview").eq("message_id", last.id).eq("tool_kind", "write").eq("status", "awaiting_approval").order("created_at");
  if (!logs?.length) return null;
  const text = async (reply: string, extra: Partial<Extract<TurnResult, { ok: true }>>): Promise<TurnResult> => {
    await c.supabase.from("ai_messages").insert({ conversation_id: conversationId, role: "assistant", content: reply, model: "app" });
    return { ok: true, reply, pending: 0, executed: 0, refused: 0, ...extra };
  };
  if (decision === "no") {
    await c.supabase.from("ai_action_logs").update({ status: "rejected" }).in("id", logs.map((l) => l.id)).eq("status", "awaiting_approval");
    return text(composeReply({ urdu, modelText: "", done: [], waiting: [], errors: [], skipped: logs.length }), {});
  }
  const done: string[] = [], errors: string[] = [];
  for (const l of logs) {
    const label = (l.preview as { text?: string } | null)?.text ?? "action";
    if (await runLog(c, l.id)) done.push(label);
    else {
      const { data: row } = await c.supabase.from("ai_action_logs").select("error").eq("id", l.id).maybeSingle();
      errors.push(`${label}${row?.error ? ` (${row.error})` : ""}`);
    }
  }
  return text(composeReply({ urdu, modelText: "", done, waiting: [], errors }), { executed: done.length, refused: errors.length });
}

type Proposal = { name: string; args: Record<string, unknown> };
export type TurnResult =
  | { ok: false; error: string }
  | { ok: true; reply: string; pending: number; executed: number; refused: number; warning?: string };

export async function runTurn(supabase: SupabaseClient, rawText: string, voice: boolean): Promise<TurnResult> {
  const message = rawText.trim();
  if (!message) return { ok: false, error: "Write a message first." };
  if (message.length > 2000) return { ok: false, error: "Keep it under 2,000 characters." };
  const c = await makeCtx(supabase);

  // Your own daily cap, so you reach it before Google's limit does.
  const cap = Number(process.env.AI_DAILY_REQUEST_CAP || 100);
  const { start, end } = rangeUtc(c.today, c.today, c.tz);
  const { count } = await supabase.from("ai_messages").select("id", { count: "exact", head: true }).eq("role", "user")
    .gte("created_at", start.toISOString()).lt("created_at", end.toISOString());
  if ((count ?? 0) >= cap) return { ok: false, error: `Daily assistant limit reached (${cap}). Use the Inbox for notes; it resets tomorrow.` };

  const conversationId = await currentConversation(supabase);
  const { data: userMsg, error: e1 } = await supabase.from("ai_messages")
    .insert({ conversation_id: conversationId, role: "user", content: message, input_mode: voice ? "voice" : "text" }).select("id").single();
  if (e1 || !userMsg) return { ok: false, error: e1?.message ?? "Could not save your message." };

  const urdu = isUrdu(message);
  const decision = classifyDecision(message);
  if (decision) {
    const handled = await handleDecision(c, conversationId, decision, urdu);
    if (handled) return handled;
  }

  const todayRange = rangeUtc(c.today, c.today, c.tz);
  const [{ data: tasks }, { data: past }, { data: st }, { data: inbox }, { data: events }, { data: meets }] = await Promise.all([
    supabase.from("task_overview").select("id, title, priority, current_deadline, workspace_id").in("status", ["not_started", "in_progress", "waiting"]).order("current_deadline", { nullsFirst: false }).limit(25),
    supabase.from("ai_messages").select("role, content").eq("conversation_id", conversationId).in("role", ["user", "assistant"]).order("created_at", { ascending: false }).limit(10),
    supabase.from("user_settings").select("ai_auto_approve").maybeSingle(),
    supabase.from("quick_capture").select("id, raw_text").eq("status", "inbox").order("captured_at", { ascending: false }).limit(12),
    supabase.from("calendar_events").select("title, start_at, end_at, all_day").is("deleted_at", null).neq("status", "cancelled").gte("start_at", todayRange.start.toISOString()).lt("start_at", todayRange.end.toISOString()).order("start_at").limit(15),
    supabase.from("meetings").select("title, starts_at").is("deleted_at", null).eq("status", "scheduled").gte("starts_at", todayRange.start.toISOString()).lt("starts_at", todayRange.end.toISOString()).order("starts_at").limit(10),
  ]);
  const wsName = new Map(c.workspaces.map((w) => [w.id, w.name]));
  const hm = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: c.tz });
  const schedule = [...(events ?? []).map((e) => `${e.all_day ? "all day" : hm.format(new Date(e.start_at))} ${e.title}`), ...(meets ?? []).map((m) => `${hm.format(new Date(m.starts_at))} meeting: ${m.title}`)].join("; ");
  const context = `TODAY: ${c.today} (${c.tz}); tomorrow is ${addDays(c.today, 1)}\nINPUT MODE: ${voice ? "voice (spoken; your reply will be read aloud, so keep it short and conversational)" : "typed"}\nWORKSPACES: ${c.workspaces.map((w) => w.name).join(", ")}\nTODAY'S SCHEDULE: ${schedule || "nothing scheduled"}\n` +
    `INBOX (${inbox?.length ?? 0} unsorted; id | text): ${(inbox ?? []).map((x) => `${x.id} | ${x.raw_text}`).join(" || ") || "empty"}\n` +
    `SOME OPEN TASKS (id | title | workspace | priority | deadline; use list_tasks for more):\n` +
    ((tasks ?? []).map((t) => `${t.id} | ${t.title} | ${wsName.get(t.workspace_id)} | ${t.priority} | ${t.current_deadline ?? "none"}`).join("\n") || "(none)");
  const msgs: Msg[] = (past ?? []).reverse().filter((m) => m.content).map((m): Msg => m.role === "user" ? { role: "user", text: m.content as string } : { role: "assistant", text: m.content as string, calls: [] });

  const proposals: Proposal[] = [];
  const readLog: { tool_name: string; input: Record<string, unknown> }[] = [];
  let finalText = "", model = "", failure: string | null = null;
  for (let round = 0; round < 4; round++) {
    const r = await askLlm(msgs, context, { voice, userText: message });
    if (!r.ok) { failure = r.message; break; }
    model = `${r.provider}:${r.model}`;
    const reads = r.calls.filter((x) => isToolName(x.name) && isRead(x.name));
    for (const x of r.calls) if (!(isToolName(x.name) && isRead(x.name))) proposals.push({ name: x.name, args: x.args });
    if (!reads.length) { finalText = r.text; break; }
    // Answer every call the model made, in order: reads with real data (all at once), writes with "queued".
    const results: ToolResult[] = await Promise.all(r.calls.map(async (x): Promise<ToolResult> => {
      if (isToolName(x.name) && isRead(x.name)) {
        let out: Record<string, unknown>;
        try { out = await runRead(c, x.name, x.args); } catch (e) { out = { error: e instanceof Error ? e.message.slice(0, 200) : "Could not read that." }; }
        readLog.push({ tool_name: x.name, input: x.args });
        return { id: x.id, name: x.name, output: out };
      }
      return { id: x.id, name: x.name, output: { status: "queued: shown to the user for approval" } };
    }));
    msgs.push({ role: "assistant", text: r.text, calls: r.calls, raw: r.raw, provider: r.provider }, { role: "tool", results });
    if (round === 3) finalText = r.text || "I looked up your data but ran out of steps. Please ask again, more specifically.";
  }

  if (failure && !proposals.length) {
    await supabase.from("ai_messages").insert({ conversation_id: conversationId, role: "system", content: failure });
    return { ok: false, error: failure };
  }
  const { data: aMsg } = await supabase.from("ai_messages").insert({
    conversation_id: conversationId, role: "assistant", model,
    content: finalText || (proposals.length ? "…" : failure ?? "…"),
    tool_calls: proposals.length ? proposals : null,
  }).select("id").single();

  for (const [i, x] of readLog.entries()) {
    await supabase.from("ai_action_logs").insert({ conversation_id: conversationId, message_id: aMsg?.id ?? null, tool_name: x.tool_name.slice(0, 60), tool_kind: "read",
      proposed_input: x.input, status: "executed", model, idempotency_key: `${aMsg?.id ?? userMsg.id}:r${i}`, executed_at: new Date().toISOString() });
  }
  const auto = !!st?.ai_auto_approve;
  let pending = 0, executed = 0, refused = 0;
  const done: string[] = [], waiting: string[] = [], errors: string[] = [];
  for (const [i, x] of proposals.slice(0, 8).entries()) {
    const known = isToolName(x.name);
    const v = known ? await validateWrite(c, x.name as ToolName, x.args) : ({ ok: false, error: `Unknown action "${x.name}" was refused.` } as const);
    const confirm = known && needsConfirmation(x.name as ToolName);
    const { data: row } = await supabase.from("ai_action_logs").insert({
      conversation_id: conversationId, message_id: aMsg?.id ?? null, tool_name: x.name.slice(0, 60), tool_kind: "write", requires_confirmation: confirm,
      proposed_input: x.args, validated_input: v.ok ? v.input : null, preview: v.ok ? { text: v.preview } : null,
      status: v.ok ? "awaiting_approval" : "failed", error: v.ok ? null : v.error, model, idempotency_key: `${aMsg?.id ?? userMsg.id}:${i}`,
    }).select("id").single();
    if (!v.ok) { refused++; errors.push(v.error); continue; }
    if (auto && !confirm && row) { if (await runLog(c, row.id)) { executed++; done.push(v.preview); } else { refused++; errors.push(v.preview); } } else { pending++; waiting.push(v.preview); }
  }
  if (failure) await supabase.from("ai_messages").insert({ conversation_id: conversationId, role: "system", content: failure });
  // When changes were proposed or made, the reply is built from what really happened, not from the model's wording.
  const reply = composeReply({ urdu, modelText: proposals.length ? "" : finalText, done, waiting, errors, dropped: Math.max(0, proposals.length - 8) });
  if (aMsg && proposals.length) await supabase.from("ai_messages").update({ content: reply }).eq("id", aMsg.id);
  return { ok: true, reply, pending, executed, refused, warning: failure ?? undefined };
}
