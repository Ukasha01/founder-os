import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { synthesize, elevenSettings } from "@/lib/ai/speech";
import { askLlm } from "@/lib/ai/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Signed-in only. Open /api/voice/diag in the browser: shows which voice/model/provider is used and how long each step takes.
// ?speak=1 also tests real speech (spends a few ElevenLabs characters). Never prints keys.
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const speak = new URL(req.url).searchParams.get("speak") === "1";
  const e = process.env;
  const out: Record<string, unknown> = {
    keys: { elevenlabs: !!e.ELEVENLABS_API_KEY, gemini: !!e.GEMINI_API_KEY, groq: !!e.GROQ_API_KEY, cerebras: !!e.CEREBRAS_API_KEY },
    elevenlabs_urdu: elevenSettings(e, true), elevenlabs_english: elevenSettings(e, false), region: e.VERCEL_REGION ?? "local",
  };
  for (const [label, urdu, userText] of [["llm_english", false, "hello"], ["llm_urdu", true, "سلام"]] as const) {
    const t = Date.now();
    const r = await askLlm([{ role: "user", text: userText }], "Reply with one short word.", { voice: true, userText, urdu });
    out[label] = { ok: r.ok, ms: Date.now() - t, via: r.ok ? `${r.provider}:${r.model}` : r.message };
  }
  if (speak) {
    for (const [label, text] of [["tts_english", "Hello, this is a test."], ["tts_urdu", "آپ کے آج کے تین ٹاسک ہیں۔"]] as const) {
      const r = await synthesize(text);
      out[label] = r.ok ? { ok: true, ms: r.ms, provider: r.provider, bytes: r.bytes.length } : { ok: false, ms: r.ms, reason: r.reason, message: r.message };
    }
  } else out.tts = "add ?speak=1 to test voices (uses ~50 ElevenLabs characters)";
  return NextResponse.json(out);
}
