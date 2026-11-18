import { FUNCTION_DECLARATIONS, SYSTEM_PROMPT } from "./tools.ts";
import type { Msg, LlmResult } from "./llm.ts";

export type GeminiCall = { name: string; args: Record<string, unknown> };
export type GeminiPart = Record<string, unknown>;
export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };
export type GeminiResult =
  | { ok: true; text: string; calls: GeminiCall[]; parts: GeminiPart[]; model: string }
  | { ok: false; reason: "not_configured" | "quota" | "unavailable" | "bad_response"; message: string };

export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";

// Pure: turn a Gemini REST response body into text + proposed calls (+ the raw parts, which must be
// echoed back verbatim when we answer a function call). Unit-tested.
export function parseGemini(body: unknown): { text: string; calls: GeminiCall[]; parts: GeminiPart[] } | null {
  const parts = (body as { candidates?: { content?: { parts?: GeminiPart[] } }[] })?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  let text = "";
  const calls: GeminiCall[] = [];
  for (const p of parts) {
    if (typeof p.text === "string" && p.thought !== true) text += p.text;
    const fc = p.functionCall as { name?: unknown; args?: unknown } | undefined;
    if (fc && typeof fc.name === "string") calls.push({ name: fc.name, args: (fc.args && typeof fc.args === "object" ? fc.args : {}) as Record<string, unknown> });
  }
  return { text: text.trim(), calls, parts };
}

export const textContent = (role: "user" | "model", text: string): GeminiContent => ({ role, parts: [{ text }] });

export async function askGemini(contents: GeminiContent[], context: string): Promise<GeminiResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, reason: "not_configured", message: "The assistant has no Gemini key yet. Add GEMINI_API_KEY in Vercel to switch it on." };
  const model = process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `${SYSTEM_PROMPT}\n\n${context}` }] },
        contents,
        tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        generationConfig: { temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (res.status === 429) return { ok: false, reason: "quota", message: "Gemini's free limit is reached for now. Your note can be saved to the Inbox instead." };
    if (!res.ok) return { ok: false, reason: "unavailable", message: `Gemini is unavailable right now (HTTP ${res.status}).` };
    const parsed = parseGemini(await res.json());
    if (!parsed) return { ok: false, reason: "bad_response", message: "Gemini returned an answer the app could not read." };
    return { ok: true, ...parsed, model };
  } catch {
    return { ok: false, reason: "unavailable", message: "Could not reach Gemini (timeout or network)." };
  }
}

// Neutral messages -> Gemini "contents". An assistant turn that came from Gemini is echoed back with its raw parts
// (Gemini needs them for function calling); one that came from another provider is rebuilt from its text and calls.
export function toGeminiContents(msgs: Msg[]): GeminiContent[] {
  return msgs.map((m): GeminiContent => {
    if (m.role === "user") return { role: "user", parts: [{ text: m.text }] };
    if (m.role === "assistant") {
      if (m.provider === "gemini" && Array.isArray(m.raw)) return { role: "model", parts: m.raw as GeminiPart[] };
      const parts: GeminiPart[] = [];
      if (m.text) parts.push({ text: m.text });
      for (const c of m.calls) parts.push({ functionCall: { name: c.name, args: c.args } });
      return { role: "model", parts: parts.length ? parts : [{ text: "…" }] };
    }
    return { role: "user", parts: m.results.map((r) => ({ functionResponse: { name: r.name, response: { output: r.output } } })) };
  });
}

// Gemini 2.5 "thinks" before answering, which adds seconds. For this assistant a thinking budget of 0 is faster and
// still follows the tools well. Other model families use different settings, so only 2.5 gets it.
export function generationConfig(model: string) {
  return { temperature: 0.2, ...(/gemini-2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) };
}

export async function geminiChat(msgs: Msg[], context: string): Promise<LlmResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, reason: "not_configured", message: "No Gemini key is set." };
  const model = process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL;
  const call = (withThinking: boolean) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: `${SYSTEM_PROMPT}\n\n${context}` }] },
      contents: toGeminiContents(msgs),
      tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      generationConfig: withThinking ? generationConfig(model) : { temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(25000),
  });
  try {
    let res = await call(true);
    if (res.status === 400) res = await call(false);   // a model that rejects the thinking setting
    if (res.status === 429) return { ok: false, reason: "quota", message: "Gemini's free limit is reached for now." };
    if (!res.ok) return { ok: false, reason: "unavailable", message: `Gemini is unavailable right now (HTTP ${res.status}).` };
    const parsed = parseGemini(await res.json());
    if (!parsed) return { ok: false, reason: "bad_response", message: "Gemini returned an answer the app could not read." };
    return { ok: true, text: parsed.text, calls: parsed.calls.map((c, i) => ({ id: `g${i}`, name: c.name, args: c.args })), raw: parsed.parts, model, provider: "gemini" };
  } catch {
    return { ok: false, reason: "unavailable", message: "Could not reach Gemini (timeout or network)." };
  }
}
