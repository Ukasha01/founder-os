import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseLinkCode, tgSecret, tgSend, tgToken } from "@/lib/telegram";

export const dynamic = "force-dynamic";

// Telegram calls this when someone messages the bot. Sending the link code from Settings connects that chat to your account.
export async function POST(req: NextRequest) {
  const token = tgToken();
  if (!token || req.headers.get("x-telegram-bot-api-secret-token") !== tgSecret(token)) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  const upd = (await req.json().catch(() => null)) as { message?: { text?: string; chat?: { id?: number; type?: string } } } | null;
  const chat = upd?.message?.chat, text = upd?.message?.text ?? "";
  if (!chat?.id || chat.type !== "private") return NextResponse.json({ ok: true });
  const code = parseLinkCode(text);
  const db = createAdminClient();
  if (!db) return NextResponse.json({ ok: true });
  if (!code) { await tgSend(chat.id, "Open Founder OS > Settings > Telegram, press Connect, then send me the 8-character code shown there."); return NextResponse.json({ ok: true }); }
  const { data } = await db.from("telegram_links").select("owner_id, created_at").eq("link_code", code).maybeSingle();
  if (!data || Date.now() - new Date(data.created_at).getTime() > 30 * 60_000) { await tgSend(chat.id, "That code is wrong or expired. Press Connect in Settings to get a new one."); return NextResponse.json({ ok: true }); }
  await db.from("telegram_links").update({ chat_id: chat.id, link_code: null, linked_at: new Date().toISOString() }).eq("owner_id", data.owner_id);
  await tgSend(chat.id, "Connected. Founder OS reminders will now arrive here too.");
  return NextResponse.json({ ok: true });
}
