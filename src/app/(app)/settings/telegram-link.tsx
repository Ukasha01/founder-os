"use client";

import { useEffect, useState } from "react";
import { telegramStatus, startTelegramLink, disconnectTelegram, testTelegram, sendTestEmail, googleStatus, sendGoogleTestEvent, removeGoogleTestEvents } from "./actions";

const btn = "inline-flex items-center rounded-[10px] border border-line-strong px-4 py-2 text-sm font-semibold";
export function TelegramLink() {
  const [st, setSt] = useState<{ configured: boolean; linked: boolean } | null>(null);
  const [code, setCode] = useState<{ code: string; bot?: string } | null>(null);
  const [msg, setMsg] = useState("");
  const refresh = () => telegramStatus().then(setSt).catch(() => setSt({ configured: false, linked: false }));
  useEffect(() => { refresh(); }, []);
  useEffect(() => { if (!code || st?.linked) return; const t = setInterval(refresh, 4000); return () => clearInterval(t); }, [code, st?.linked]);
  if (!st) return null;
  if (!st.configured) return <p className="text-sm text-neutral-600">Telegram backup is not set up yet: add TELEGRAM_BOT_TOKEN in Vercel (see GUIDE.md), then redeploy.</p>;
  if (st.linked) return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm">Telegram is connected. Reminders are sent there too.</span>
      <button className={btn} onClick={async () => { setMsg("Sending..."); const r = await testTelegram(); setMsg(r.ok ? "Sent. Check Telegram." : (r.error ?? "Failed.")); }}>Send test</button>
      <button className={btn} onClick={async () => { await disconnectTelegram(); setCode(null); refresh(); }}>Disconnect</button>
      {msg && <p role="status" className="w-full text-sm">{msg}</p>}
    </div>
  );
  return (
    <div>
      <button className={btn} onClick={async () => { setMsg(""); const r = await startTelegramLink(); if (r.ok && r.code) setCode({ code: r.code, bot: r.bot }); else setMsg(r.error ?? "Could not start."); }}>Connect Telegram</button>
      {code && <p className="mt-2 text-sm">Open Telegram, find <b>@{code.bot ?? "your bot"}</b>, press Start, then send this code: <b className="font-mono tracking-widest">{code.code}</b>. This page updates by itself when connected (code valid 30 minutes).</p>}
      {msg && <p role="alert" className="mt-2 text-sm text-rose-800">{msg}</p>}
    </div>
  );
}

export function EmailBackup() {
  const [msg, setMsg] = useState("");
  return (
    <div>
      <button className={btn} onClick={async () => { setMsg("Sending..."); const r = await sendTestEmail(); setMsg(r.ok ? `Sent to ${r.to}. Check Gmail on your phone.` : (r.error ?? "Failed.")); }}>Send test email</button>
      {msg && <p role="status" className="mt-2 text-sm">{msg}</p>}
    </div>
  );
}

export function GoogleCalendarCard() {
  const [st, setSt] = useState<{ on: boolean; reason?: string; synced: number; failed: number; lastError: string | null } | null>(null);
  const [msg, setMsg] = useState("");
  const refresh = () => googleStatus().then(setSt).catch(() => undefined);
  useEffect(() => { refresh(); }, []);
  if (!st) return null;
  if (!st.on) return <p className="text-sm text-neutral-600">Google Calendar is off: {st.reason}</p>;
  return (
    <div>
      <p className="text-sm">On. {st.synced} item(s) mirrored{st.failed ? `, ${st.failed} failed${st.lastError ? ` (${st.lastError})` : ""}` : ""}.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button className={btn} onClick={async () => { setMsg("Creating..."); const r = await sendGoogleTestEvent(); setMsg(r.ok ? `Test event created for ${r.at}. Look for a pop-up on your phone then.` : (r.error ?? "Failed.")); refresh(); }}>Send test event</button>
        <button className={btn} onClick={async () => { const r = await removeGoogleTestEvents(); setMsg(r.ok ? `Removed ${r.removed} test event(s).` : (r.error ?? "Failed.")); refresh(); }}>Remove test events</button>
      </div>
      {msg && <p role="status" className="mt-2 text-sm">{msg}</p>}
    </div>
  );
}
