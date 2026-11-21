import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { synthesize } from "@/lib/ai/speech";

export const dynamic = "force-dynamic";

// Text in, spoken audio out. On any failure the client falls back to the browser voice (if it has one for the language).
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text : "";
  if (!text.trim()) return NextResponse.json({ error: "Nothing to say." }, { status: 400 });
  const r = await synthesize(text);
  if (!r.ok) return NextResponse.json({ error: r.message, reason: r.reason, ms: r.ms }, { status: r.reason === "quota" ? 429 : r.reason === "not_configured" ? 503 : 502 });
  return new NextResponse(Buffer.from(r.bytes), { headers: { "content-type": r.mime, "cache-control": "no-store", "x-voice-provider": r.provider, "x-tts-ms": String(r.ms ?? 0), "server-timing": `tts;dur=${r.ms ?? 0}` } });
}
