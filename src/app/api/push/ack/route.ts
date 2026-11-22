import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// The service worker calls this when a push reaches the device, so Settings can show which devices really received it.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (typeof b?.endpoint !== "string") return NextResponse.json({ error: "Missing endpoint." }, { status: 400 });
  await supabase.from("push_subscriptions").update({ last_received_at: new Date().toISOString() }).eq("endpoint", b.endpoint);
  return NextResponse.json({ ok: true });
}
