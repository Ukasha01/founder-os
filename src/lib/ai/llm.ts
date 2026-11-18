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

export type LlmOpts = { voice: boolean; userText: string };

type Compat = { name: string; base: string; key: string; model: string };

export function compatProviders(env: Record<string, string | undefined>): Compat[] {
  const list: Compat[] = [];
  if (env.CEREBRAS_API_KEY) list.push({ name: "cerebras", base: "https://api.cerebras.ai/v1", key: env.CEREBRAS_API_KEY, model: env.CEREBRAS_MODEL || "llama-3.3-70b" });
  if (env.GROQ_API_KEY) list.push({ name: "groq", base: "https://api.groq.com/openai/v1", key: env.GROQ_API_KEY, model: env.GROQ_MODEL || "llama-3.3-70b-versatile" });
  return list;
}

// Order in which providers are tried. LLM_PROVIDER ("groq" | "cerebras" | "gemini") moves one to the front.
export function providerOrder(env: Record<string, string | undefined>): string[] {
  const all = [...compatProviders(env).map((p) => p.name), ...(env.GEMINI_API_KEY ? ["gemini"] : [])];
  const first = (env.LLM_PROVIDER ?? "").toLowerCase();
  return all.includes(first) ? [first, ...all.filter((x) => x !== first)] : all;
}

const lower = (v: unknown): unknown => Array.isArray(v) ? v.map(lower) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "type" && typeof x === "string" ? x.toLowerCase() : lower(x)])) : v;

export function toOpenAiTools(names: string[] | null) {
  return FUNCTION_DECLARATIONS.filter((d) => !names || names.includes(d.name)).map((d) => ({ type: "function", function: { name: d.name, description: d.description, parameters: lower(d.parameters) } }));
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
    const res = await fetch(`${p.base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${p.key}` },
      body: JSON.stringify({
        model: p.model, temperature: 0.2, max_tokens: 700,
        messages: toOpenAiMessages(`${SYSTEM_PROMPT}\n\n${context}`, msgs),
        tools: toOpenAiTools(routeTools(o.userText)), tool_choice: "auto",
      }),
      signal: AbortSignal.timeout(20000),
    });
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
  const order = providerOrder(env);
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
