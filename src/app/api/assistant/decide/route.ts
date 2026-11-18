import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentConversation, makeCtx, runLog } from "@/lib/ai/turn";

export const dynamic = "force-dynamic";

// "Yes / haan" or "no / nahi" by voice: approve or skip everything still waiting in this chat.
// Deletions are never approved this way; they stay for a deliberate tap.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { decision?: unknown } | null;
  if (body?.decision !== "approve" && body?.decision !== "reject") return NextResponse.json({ error: "Invalid decision." }, { status: 400 });
  const conv = await currentConversation(supabase);
  const { data: logs } = await supabase.from("ai_action_logs").select("id, requires_confirmation").eq("conversation_id", conv).eq("tool_kind", "write").eq("status", "awaiting_approval").order("created_at");
  const rows = logs ?? [];
  if (body.decision === "reject") {
    for (const l of rows) await supabase.from("ai_action_logs").update({ status: "rejected" }).eq("id", l.id).eq("status", "awaiting_approval");
    return NextResponse.json({ ok: true, done: 0, skipped: rows.length, needsTap: 0 });
  }
  const c = await makeCtx(supabase);
  let done = 0, failed = 0, needsTap = 0;
  for (const l of rows) { if (l.requires_confirmation) { needsTap++; continue; } if (await runLog(c, l.id)) done++; else failed++; }
  return NextResponse.json({ ok: true, done, failed, needsTap });
}
