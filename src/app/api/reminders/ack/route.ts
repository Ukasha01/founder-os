import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Called from the notification's Done / Snooze buttons (and a tap on it). "done" stops the repeats; "snooze" repeats again in 10 minutes.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { id?: unknown; action?: unknown } | null;
  if (typeof b?.id !== "string") return NextResponse.json({ error: "Missing id." }, { status: 400 });
  const patch = b.action === "snooze" ? { acked_at: null, nag_count: 0, next_nag_at: new Date(Date.now() + 10 * 60_000).toISOString() } : { acked_at: new Date().toISOString(), next_nag_at: null };
  const { error } = await supabase.from("reminders").update(patch).eq("id", b.id);
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true });
}
