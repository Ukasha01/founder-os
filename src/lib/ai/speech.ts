// Server-side speech: audio -> text (Gemini) and text -> audio (ElevenLabs or Gemini).
// Why not the browser's built-in speech tools: their Urdu is weak and many phones have no Urdu voice at all.
// Pure helpers are exported separately so they can be unit-tested without network access.
import { pcm16ToWav } from "../wav.ts";

export type SttResult = { ok: true; text: string } | { ok: false; reason: "not_configured" | "quota" | "unavailable"; message: string };
export type TtsResult = { ok: true; bytes: Uint8Array; mime: string; provider: string } | { ok: false; reason: "not_configured" | "quota" | "unavailable"; message: string };

export const STT_PROMPT =
  "Transcribe this audio exactly as spoken. The speaker is from Karachi, Pakistan and mixes Urdu and English; they may also say Roman Urdu words. " +
  "Write Urdu words in Urdu script and English words in English letters. Keep numbers, names and task names as spoken. " +
  "Output ONLY the transcript, with no commentary, quotes or translation. If there is no clear human speech, output nothing at all.";

// Models sometimes "transcribe" background sound instead of speech: "[silence]", "موسیقی" (music), "Thank you for watching".
// Those must never reach the assistant, or it answers sounds that were not words.
const NON_SPEECH = new Set(["موسیقی", "میوزک", "music", "noise", "silence", "inaudible", "applause", "laughter", "تالیاں", "تالی", "شور", "خاموشی", "ہنسی", "بولا گیا ہے", "♪", "♪♪", "..."]);
const HALLUCINATIONS = [/^thanks? for watching/i, /^thank you for watching/i, /^subtitles? by/i, /^please subscribe/i, /^like and subscribe/i, /^شکریہ[۔.!\s]*$/, /^دیکھنے کے لیے شکریہ/, /^ترجمہ/, /^اسے دیکھنے کے لیے/];
export function cleanTranscript(raw: string): string {
  const t = raw.trim().replace(/^["“]|["”]$/g, "").trim();
  if (!t) return "";
  if (/^[\[(（].*[\])）]$/.test(t)) return "";
  const bare = t.replace(/[.,!?؟۔،\s♪*_-]+/g, " ").trim().toLowerCase();
  if (!bare || NON_SPEECH.has(bare)) return "";
  if (/^(no (clear )?(human )?speech|silence|inaudible|nothing)\b/i.test(t) && t.length < 40) return "";
  if (HALLUCINATIONS.some((r) => r.test(t))) return "";
  return t;
}

type Body = { candidates?: { content?: { parts?: { text?: string; thought?: boolean; inlineData?: { mimeType?: string; data?: string } }[] } }[] };

export function extractText(body: unknown): string {
  const parts = (body as Body)?.candidates?.[0]?.content?.parts ?? [];
  return parts.filter((p) => typeof p.text === "string" && p.thought !== true).map((p) => p.text).join("").trim();
}

export function extractAudio(body: unknown): { bytes: Uint8Array; mime: string } | null {
  const parts = (body as Body)?.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    if (p.inlineData?.data) return { bytes: new Uint8Array(Buffer.from(p.inlineData.data, "base64")), mime: p.inlineData.mimeType ?? "" };
  }
  return null;
}

// Gemini returns raw 16-bit PCM ("audio/L16;codec=pcm;rate=24000"). Browsers cannot play raw PCM, so wrap it as WAV.
export function pcmRate(mime: string): number {
  const m = /rate=(\d+)/i.exec(mime);
  return m ? Number(m[1]) : 24000;
}
export function toPlayable(a: { bytes: Uint8Array; mime: string }): { bytes: Uint8Array; mime: string } {
  if (/wav|mpeg|mp3|ogg|webm/i.test(a.mime)) return a;
  return { bytes: pcm16ToWav(a.bytes, pcmRate(a.mime)), mime: "audio/wav" };
}

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";

async function sttGemini(wav: Uint8Array): Promise<SttResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, reason: "not_configured", message: "No Gemini key is set." };
  // flash-lite has its own, larger free allowance than the main model, so listening does not use up the thinking quota.
  const model = process.env.GEMINI_STT_MODEL || "gemini-2.5-flash-lite";
  try {
    const res = await fetch(`${GEMINI}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: STT_PROMPT }, { inlineData: { mimeType: "audio/wav", data: Buffer.from(wav).toString("base64") } }] }],
        generationConfig: { temperature: 0, ...(/gemini-2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 429) return { ok: false, reason: "quota", message: "Gemini's free limit is reached for now." };
    if (!res.ok) return { ok: false, reason: "unavailable", message: `Speech recognition is unavailable (HTTP ${res.status}).` };
    return { ok: true, text: cleanTranscript(extractText(await res.json())) };
  } catch {
    return { ok: false, reason: "unavailable", message: "Could not reach Gemini (timeout or network)." };
  }
}

// Whisper on Groq: very fast, free allowance counted in audio seconds. Language is pinned to Urdu because Whisper's
// auto-detect often mistakes Urdu for Hindi or Arabic; the hint text keeps English words (task, deadline) intact.
async function groqOnce(key: string, wav: Uint8Array, language?: string): Promise<Response> {
  const form = new FormData();
  form.append("file", new Blob([wav as BlobPart], { type: "audio/wav" }), "speech.wav");
  form.append("model", process.env.GROQ_STT_MODEL || "whisper-large-v3-turbo");
  form.append("temperature", "0");
  if (language) form.append("language", language);
  return fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(20000) });
}
// Whisper's language guess is right for English but often calls spoken Urdu "Hindi" and writes Devanagari. So: detect the
// language first (keeps English as English); if the result comes back in Devanagari, run it again pinned to Urdu.
// (A pinned Urdu run is NOT the default: it turns English sentences into Urdu-script gibberish. STT_LANGUAGE overrides both.)
export const hasDevanagari = (t: string) => /[\u0900-\u097F]/.test(t);
async function sttGroq(wav: Uint8Array): Promise<SttResult> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { ok: false, reason: "not_configured", message: "No Groq key is set." };
  try {
    let res = await groqOnce(key, wav, process.env.STT_LANGUAGE || undefined);
    if (res.status === 429) return { ok: false, reason: "quota", message: "Groq's free limit is reached for now." };
    if (!res.ok) return { ok: false, reason: "unavailable", message: `Groq speech recognition is unavailable (HTTP ${res.status}).` };
    let text = cleanTranscript(String(((await res.json()) as { text?: string }).text ?? ""));
    if (!process.env.STT_LANGUAGE && hasDevanagari(text)) {
      res = await groqOnce(key, wav, "ur");
      if (res.ok) text = cleanTranscript(String(((await res.json()) as { text?: string }).text ?? ""));
    }
    return { ok: true, text };
  } catch {
    return { ok: false, reason: "unavailable", message: "Could not reach Groq (timeout or network)." };
  }
}

export function sttOrder(env: Record<string, string | undefined>): ("gemini" | "groq")[] {
  const all: ("gemini" | "groq")[] = [];
  if (env.GEMINI_API_KEY) all.push("gemini");
  if (env.GROQ_API_KEY) all.push("groq");
  const want = (env.STT_PROVIDER ?? "").toLowerCase();
  return all.includes(want as "gemini" | "groq") ? [want as "gemini" | "groq", ...all.filter((x) => x !== want)] : all;
}

export async function transcribe(wav: Uint8Array): Promise<SttResult> {
  const order = sttOrder(process.env);
  if (!order.length) return { ok: false, reason: "not_configured", message: "No speech key is set." };
  let last: SttResult | null = null;
  for (const p of order) {
    const r = p === "gemini" ? await sttGemini(wav) : await sttGroq(wav);
    if (r.ok) return r;
    last = !last || r.reason === "quota" ? r : last;
  }
  return last!;
}

export type TtsProvider = "elevenlabs" | "gemini" | "off";
export function pickProvider(env: Record<string, string | undefined>): TtsProvider {
  const want = (env.TTS_PROVIDER ?? "").toLowerCase();
  if (want === "off") return "off";
  if (want === "elevenlabs" && env.ELEVENLABS_API_KEY) return "elevenlabs";
  if (want === "gemini" && env.GEMINI_API_KEY) return "gemini";
  if (env.ELEVENLABS_API_KEY) return "elevenlabs";
  if (env.GEMINI_API_KEY) return "gemini";
  return "off";
}

async function ttsGemini(text: string): Promise<TtsResult> {
  const key = process.env.GEMINI_API_KEY!;
  const model = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
  const voice = process.env.GEMINI_TTS_VOICE || "Kore";
  try {
    const res = await fetch(`${GEMINI}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Say this in a natural, warm Pakistani Urdu accent at a calm conversational pace (English words in English): ${text}` }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (res.status === 429) return { ok: false, reason: "quota", message: "Gemini's free voice limit is reached for now." };
    if (!res.ok) return { ok: false, reason: "unavailable", message: `Gemini voice is unavailable (HTTP ${res.status}).` };
    const a = extractAudio(await res.json());
    if (!a) return { ok: false, reason: "unavailable", message: "Gemini returned no audio." };
    const p = toPlayable(a);
    return { ok: true, ...p, provider: "gemini" };
  } catch {
    return { ok: false, reason: "unavailable", message: "Could not reach Gemini voice (timeout or network)." };
  }
}

async function ttsEleven(text: string): Promise<TtsResult> {
  const key = process.env.ELEVENLABS_API_KEY!;
  const voice = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  const model = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_64`, {
      method: "POST",
      headers: { "content-type": "application/json", "xi-api-key": key },
      body: JSON.stringify({ text, model_id: model }),
      signal: AbortSignal.timeout(25000),
    });
    if (res.status === 429 || res.status === 402) return { ok: false, reason: "quota", message: "ElevenLabs' free characters are used up." };
    if (!res.ok) return { ok: false, reason: "unavailable", message: `ElevenLabs is unavailable (HTTP ${res.status}).` };
    return { ok: true, bytes: new Uint8Array(await res.arrayBuffer()), mime: "audio/mpeg", provider: "elevenlabs" };
  } catch {
    return { ok: false, reason: "unavailable", message: "Could not reach ElevenLabs (timeout or network)." };
  }
}

export async function synthesize(text: string): Promise<TtsResult> {
  const t = text.trim().slice(0, 500);
  if (!t) return { ok: false, reason: "unavailable", message: "Nothing to say." };
  const provider = pickProvider(process.env);
  if (provider === "off") return { ok: false, reason: "not_configured", message: "No voice provider is configured." };
  const first = provider === "elevenlabs" ? await ttsEleven(t) : await ttsGemini(t);
  if (first.ok || provider !== "elevenlabs") return first;
  // ElevenLabs failed or is out of free characters: try Gemini voice before giving up.
  return process.env.GEMINI_API_KEY ? ttsGemini(t) : first;
}
