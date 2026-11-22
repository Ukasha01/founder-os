import { createHash } from "node:crypto";

// Telegram is a backup channel for reminders: it reaches a locked phone even when the browser's push is blocked by the phone maker.
export const tgToken = () => process.env.TELEGRAM_BOT_TOKEN || null;
// The webhook proves a request is from Telegram with a secret derived from the bot token, so no extra setting is needed.
export const tgSecret = (token: string) => createHash("sha256").update(`fos:${token}`).digest("hex").slice(0, 48);

export async function tgCall<T = unknown>(method: string, body?: Record<string, unknown>): Promise<{ ok: boolean; result?: T; description?: string }> {
  const t = tgToken(); if (!t) return { ok: false, description: "TELEGRAM_BOT_TOKEN is not set." };
  try {
    const r = await fetch(`https://api.telegram.org/bot${t}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(8000) });
    return (await r.json()) as { ok: boolean; result?: T; description?: string };
  } catch { return { ok: false, description: "Could not reach Telegram." }; }
}
export const tgSend = (chatId: number, text: string) => tgCall("sendMessage", { chat_id: chatId, text });

// "/start CODE" or just "CODE"
export function parseLinkCode(text: string): string | null {
  const m = text.trim().match(/^(?:\/start\s+)?([A-Z0-9]{8})$/i);
  return m ? m[1].toUpperCase() : null;
}
