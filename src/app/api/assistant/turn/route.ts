import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runTurn } from "@/lib/ai/turn";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// One assistant turn for the live voice mode: same logic as the typed form, but returns JSON instead of redirecting.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { message?: unknown; voice?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message : "";
  const r = await runTurn(supabase, message, body?.voice === true);
  return NextResponse.json(r, { status: r.ok ? 200 : 422 });
}
