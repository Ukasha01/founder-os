// One interface for the assistant's "brain", with several free providers behind it.
// Order of use: a fast OpenAI-compatible provider first (Cerebras or Groq, when their key is set), then Gemini.
// If one is out of free quota or down, the next one answers, so a single limit never stops the assistant.
import { FUNCTION_DECLARATIONS, SYSTEM_PROMPT, routeTools } from "./tools.ts";
import { geminiChat } from "./gemini.ts";

export type ToolCall = { id: string; name: string; args: Record<string, unknown> };
export type ToolResult = { id: string; name: string; output: unknown };
export type Msg =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; calls: ToolCall[]; raw?: unknown; provider?: string }
  | { role: "tool"; results: ToolResult[] };

export type LlmResult =
  | { ok: true; text: string; calls: ToolCall[]; raw?: unknown; model: string; provider: string }
  | { ok: false; reason: "not_configured" | "quota" | "unavailable" | "bad_response"; message: string };

export type LlmOpts = { voice: boolean; userText: string; urdu?: boolean };

type Compat = { name: string; base: string; key: string; model: string };

export function compatProviders(env: Record<string, string | undefined>): Compat[] {
  const list: Compat[] = [];
  if (env.CEREBRAS_API_KEY) list.push({ name: "cerebras", base: "https://api.cerebras.ai/v1", key: env.CEREBRAS_API_KEY, model: env.CEREBRAS_MODEL || "llama-3.3-70b" });
  if (env.GROQ_API_KEY) list.push({ name: "groq", base: "https://api.groq.com/openai/v1", key: env.GROQ_API_KEY, model: env.GROQ_MODEL || "openai/gpt-oss-120b" });
  return list;
}

// Order in which providers are tried. LLM_PROVIDER ("groq" | "cerebras" | "gemini") moves one to the front.
// Fast providers first, Gemini as the fallback. Exception: Urdu turns go to Gemini first, because in your own logs the
// Urdu from Gemini 2.5 Flash was fluent while gpt-oss-120b mistranslated names ("Wapsi" became "واپس") and mixed scripts.
// An explicit LLM_PROVIDER always wins.
export function providerOrder(env: Record<string, string | undefined>, urdu = false): string[] {
  const all = [...compatProviders(env).map((p) => p.name), ...(env.GEMINI_API_KEY ? ["gemini"] : [])];
  const first = (env.LLM_PROVIDER ?? "").toLowerCase();
  if (all.includes(first)) return [first, ...all.filter((x) => x !== first)];
  if (urdu && all.includes("gemini") && !(env.LLM_URDU_PROVIDER === "fast")) return ["gemini", ...all.filter((x) => x !== "gemini")];
  return all;
}

const lower = (v: unknown): unknown => Array.isArray(v) ? v.map(lower) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "type" && typeof x === "string" ? x.toLowerCase() : lower(x)])) : v;

// Free tiers count tokens per minute and per day, and the tool list is sent on every request, so it is sent compactly:
// first sentence of each description, and parameter descriptions only where the name alone would be unclear (dates, times).
const KEEP_PARAM_DESC = /^(date|deadline|new_deadline|target_date|due_date|follow_up_date|starts_at|ends_at|start|end|until)/;
function compactParams(params: unknown): unknown {
  const p = lower(params) as { properties?: Record<string, { description?: string }> };
  for (const [k, v] of Object.entries(p.properties ?? {})) if (v.description && !KEEP_PARAM_DESC.test(k) && !/YYYY/.test(v.description)) delete v.description;
  return p;
}
export function toOpenAiTools(names: string[] | null) {
  return FUNCTION_DECLARATIONS.filter((d) => !names || names.includes(d.name)).map((d) => ({ type: "function", function: { name: d.name, description: d.description.split(/(?<=\.)\s/)[0], parameters: compactParams(d.parameters) } }));
}

export function toOpenAiMessages(system: string, msgs: Msg[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [{ role: "system", content: system }];
  for (const m of msgs) {
    if (m.role === "user") out.push({ role: "user", content: m.text });
    else if (m.role === "assistant") out.push({ role: "assistant", content: m.text || null, ...(m.calls.length ? { tool_calls: m.calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}) });
    else for (const r of m.results) out.push({ role: "tool", tool_call_id: r.id, content: JSON.stringify(r.output).slice(0, 9000) });
  }
  return out;
}

export function parseOpenAi(body: unknown): { text: string; calls: ToolCall[] } | null {
  const msg = (body as { choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] } }[] })?.choices?.[0]?.message;
  if (!msg) return null;
  const calls: ToolCall[] = [];
  for (const [i, c] of (msg.tool_calls ?? []).entries()) {
    if (!c.function?.name) continue;
    let args: Record<string, unknown> = {};
    try { const a = JSON.parse(c.function.arguments || "{}"); if (a && typeof a === "object") args = a; } catch { /* model sent broken JSON: treated as no arguments, validation will refuse it */ }
    calls.push({ id: c.id || `call_${i}`, name: c.function.name, args });
  }
  return { text: (msg.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim(), calls };
}

async function askCompat(p: Compat, msgs: Msg[], context: string, o: LlmOpts): Promise<LlmResult> {
  try {
    // gpt-oss models "reason" before answering; those tokens count against the free limits, so keep it light.
    const body = { model: p.model, temperature: 0.2, max_tokens: 700, messages: toOpenAiMessages(`${SYSTEM_PROMPT}\n\n${context}`, msgs), tools: toOpenAiTools(routeTools(o.userText)), tool_choice: "auto" };
    const post = (extra: Record<string, unknown>) => fetch(`${p.base}/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${p.key}` }, body: JSON.stringify({ ...body, ...extra }), signal: AbortSignal.timeout(20000),
    });
    let res = await post(/gpt-oss/.test(p.model) ? { reasoning_effort: "low" } : {});
    if (res.status === 400 && /gpt-oss/.test(p.model)) res = await post({});   // in case the setting is not accepted
    if (res.status === 429) return { ok: false, reason: "quota", message: `${p.name}'s free limit is reached for now.` };
    if (!res.ok) return { ok: false, reason: res.status === 400 ? "bad_response" : "unavailable", message: `${p.name} is unavailable right now (HTTP ${res.status}).` };
    const parsed = parseOpenAi(await res.json());
    if (!parsed) return { ok: false, reason: "bad_response", message: `${p.name} returned an answer the app could not read.` };
    return { ok: true, ...parsed, model: p.model, provider: p.name };
  } catch {
    return { ok: false, reason: "unavailable", message: `Could not reach ${p.name} (timeout or network).` };
  }
}

export async function askLlm(msgs: Msg[], context: string, o: LlmOpts): Promise<LlmResult> {
  const env = process.env;
  const order = providerOrder(env, !!o.urdu);
  if (!order.length) return { ok: false, reason: "not_configured", message: "The assistant has no AI key yet. Add GEMINI_API_KEY (or GROQ_API_KEY) in Vercel to switch it on." };
  const compat = new Map(compatProviders(env).map((p) => [p.name, p]));
  let last: LlmResult | null = null;
  for (const name of order) {
    const r = name === "gemini" ? await geminiChat(msgs, context) : await askCompat(compat.get(name)!, msgs, context, o);
    if (r.ok) return r;
    last = !last || r.reason === "quota" ? r : last;  // keep the most useful message: a quota notice beats a generic failure
  }
  if (last && !last.ok && last.reason === "quota" && !env.GROQ_API_KEY) return { ...last, message: `${last.message} Add a free GROQ_API_KEY in Vercel to get a second, larger allowance.` };
  return last!;
}
