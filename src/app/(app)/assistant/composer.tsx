"use client";

import { useEffect, useRef, useState } from "react";
import { askAssistant } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { input } from "@/lib/ui";

// Minimal typing for the browser speech APIs (not in TypeScript's DOM lib everywhere).
type Rec = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
type RecCtor = new () => Rec;
const LANGS = [["en-US", "English"], ["ur-PK", "اردو (Urdu)"], ["en-IN", "English (accent: South Asia)"]] as const;
const store = { get: (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

export function Composer({ enabled, lastReply }: { enabled: boolean; lastReply: { id: string; text: string } | null }) {
  const form = useRef<HTMLFormElement>(null);
  const rec = useRef<Rec | null>(null);
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [voice, setVoice] = useState(false);
  const [lang, setLang] = useState("en-US");
  const [autoSend, setAutoSend] = useState(true);
  const [speak, setSpeak] = useState(false);
  const [supported, setSupported] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
      setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
      setLang(store.get("fos-lang", "en-US")); setAutoSend(store.get("fos-autosend", "1") === "1"); setSpeak(store.get("fos-speak", "0") === "1");
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // Read the newest reply aloud once (only if switched on).
  useEffect(() => {
    if (!speak || !lastReply || !("speechSynthesis" in window)) return;
    const key = `fos-spoken-${lastReply.id}`;
    if (store.get(key, "") === "1") return;
    store.set(key, "1");
    const u = new SpeechSynthesisUtterance(lastReply.text.slice(0, 600));
    u.lang = lang; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
  }, [speak, lastReply, lang]);

  const start = () => {
    const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    setMsg("");
    const r = new Ctor();
    r.lang = lang; r.interimResults = true; r.continuous = false;
    let finalText = "";
    r.onresult = (e) => { finalText = Array.from(e.results).map((x) => x[0].transcript).join(" ").trim(); setText(finalText); setVoice(true); };
    r.onerror = (e) => { setMsg(e.error === "not-allowed" ? "Microphone access is blocked. Allow it in your browser settings." : e.error === "no-speech" ? "I did not hear anything. Try again." : `Voice input stopped (${e.error}).`); };
    r.onend = () => { setListening(false); if (autoSend && finalText) setTimeout(() => form.current?.requestSubmit(), 50); };
    rec.current = r; setListening(true); r.start();
  };
  const stop = () => rec.current?.stop();

  return (
    <div className="sticky bottom-20 mt-6 md:bottom-4">
      {msg && <p role="alert" className="mb-2 rounded-xl bg-amber-50 p-2 text-sm text-amber-900">{msg}</p>}
      <form ref={form} action={askAssistant} className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-2 shadow-pop">
        <input type="hidden" name="voice" value={voice ? "1" : "0"} />
        {supported && (
          <button type="button" onClick={listening ? stop : start} disabled={!enabled} aria-pressed={listening} aria-label={listening ? "Stop listening" : "Speak"}
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-full transition active:scale-90 ${listening ? "animate-pulse bg-rose-500 text-white" : "bg-tint text-ink hover:bg-line"}`}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          </button>
        )}
        <input name="message" value={text} onChange={(e) => { setText(e.target.value); setVoice(false); }} required maxLength={2000} autoComplete="off" disabled={!enabled}
          placeholder={!enabled ? "Assistant is not switched on yet" : listening ? "Listening…" : "Type or tap the mic and speak"} className={`${input} min-w-0 flex-1 border-0 focus:ring-0`} aria-label="Message the assistant" />
        <SubmitButton variant="primary">Send</SubmitButton>
      </form>
      <details className="mt-2 text-xs text-neutral-500">
        <summary className="cursor-pointer">Voice settings</summary>
        <div className="mt-2 flex flex-wrap items-center gap-4 rounded-xl bg-surface p-3">
          <label className="flex items-center gap-2">Speak in
            <select value={lang} onChange={(e) => { setLang(e.target.value); store.set("fos-lang", e.target.value); }} className="rounded-md border border-line px-2 py-1">{LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={autoSend} onChange={(e) => { setAutoSend(e.target.checked); store.set("fos-autosend", e.target.checked ? "1" : "0"); }} />Send when I stop talking</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={speak} onChange={(e) => { setSpeak(e.target.checked); store.set("fos-speak", e.target.checked ? "1" : "0"); }} />Read replies aloud</label>
          {!supported && <p className="w-full">This browser has no speech recognition. Chrome on Android and desktop works best; iPhone Safari support is limited. Typing always works, and your phone keyboard&apos;s own microphone also works.</p>}
        </div>
      </details>
    </div>
  );
}
