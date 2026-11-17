import { FUNCTION_DECLARATIONS, SYSTEM_PROMPT } from "./tools.ts";

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
