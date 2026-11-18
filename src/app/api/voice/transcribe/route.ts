import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { transcribe } from "@/lib/ai/speech";

export const dynamic = "force-dynamic";
const MAX_BYTES = 4_000_000; // Vercel's request limit is 4.5 MB; 16 kHz mono WAV is ~32 KB/s, so ~2 minutes

// Audio (WAV) in, text out. Uses Gemini because the browser's own recogniser is weak at Urdu.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.length < 1000) return NextResponse.json({ text: "" });
  if (buf.length > MAX_BYTES) return NextResponse.json({ error: "That recording is too long. Try shorter sentences." }, { status: 413 });
  const r = await transcribe(buf);
  if (!r.ok) return NextResponse.json({ error: r.message, reason: r.reason }, { status: r.reason === "quota" ? 429 : r.reason === "not_configured" ? 503 : 502 });
  return NextResponse.json({ text: r.text });
}
