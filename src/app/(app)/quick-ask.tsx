"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { downsample, floatToInt16, int16ToBytes, pcm16ToWav } from "@/lib/wav";
import { btn, btnPrimary, input } from "@/lib/ui";
import { approveOne, pendingActions, skipOne, type Pending } from "./quick-ask-actions";

const store = { get: (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
type Phase = "idle" | "recording" | "transcribing" | "thinking";
const MAX_SECONDS = 60;

// Ask or dictate from any screen: type, or tap the mic, speak, tap again. Approvals appear right here.
export function QuickAsk({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const dlg = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [autoSend, setAutoSend] = useState(true);
  const media = useRef<{ rec: MediaRecorder; stream: MediaStream; ctx: AudioContext; chunks: Blob[]; raf: number; timer: ReturnType<typeof setInterval> } | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const hold = (on: boolean) => window.dispatchEvent(new CustomEvent("fos:mic-hold", { detail: on }));   // the always-listening orb steps aside while this panel is open

  const show = useCallback(() => {
    setOpen(true); setError(""); hold(true);
    setAutoSend(store.get("fos-quick-autosend", "1") === "1");
    requestAnimationFrame(() => { const d = dlg.current; if (d && !d.open) d.showModal(); });
    void pendingActions().then(setPending).catch(() => undefined);
  }, []);
  const cancelRecording = useCallback(() => {
    const m = media.current; if (!m) return;
    media.current = null; cancelAnimationFrame(m.raf); clearInterval(m.timer);
    m.rec.ondataavailable = null; m.rec.onstop = null;
    try { if (m.rec.state !== "inactive") m.rec.stop(); } catch { /* already stopped */ }
    m.stream.getTracks().forEach((t) => t.stop()); void m.ctx.close().catch(() => undefined);
  }, []);
  const close = useCallback(() => { cancelRecording(); setPhase("idle"); setOpen(false); hold(false); dlg.current?.close(); }, [cancelRecording]);

  // Press "/" anywhere (not while typing) or Ctrl+K to open.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null, typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (enabled && ((e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k"))) { e.preventDefault(); show(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [enabled, show]);
  useEffect(() => () => cancelRecording(), [cancelRecording]);

  const send = useCallback(async (message: string) => {
    const m = message.trim(); if (!m) return;
    setPhase("thinking"); setError(""); setReply("");
    try {
      const r = await fetch("/api/assistant/turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: m, voice: false }) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; reply?: string };
      if (!r.ok || !j.ok) setError(j.error ?? "The assistant could not answer.");
      else { setReply(j.reply ?? ""); setText(""); setPending(await pendingActions().catch(() => [])); router.refresh(); }
    } catch { setError("Could not reach the assistant. Check your connection."); }
    setPhase("idle");
  }, [router]);

  const transcribe = useCallback(async (blob: Blob) => {
    setPhase("transcribing");
    try {
      const ctx = new AudioContext();
      const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
      void ctx.close().catch(() => undefined);
      const pcm = downsample(audio.getChannelData(0), audio.sampleRate, 16000);
      const wav = pcm16ToWav(int16ToBytes(floatToInt16(pcm)), 16000);
      const r = await fetch("/api/voice/transcribe", { method: "POST", headers: { "content-type": "audio/wav" }, body: wav as BodyInit });
      const j = (await r.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!r.ok) { setError(j.error ?? "I could not understand the audio."); return setPhase("idle"); }
      const heard = (j.text ?? "").trim();
      if (!heard) { setError("I did not hear anything. Tap the mic and try again."); return setPhase("idle"); }
      if (autoSend) { setText(heard); await send(heard); } else { setText((t) => (t ? `${t} ${heard}` : heard)); setPhase("idle"); textRef.current?.focus(); }
    } catch { setError("Could not process the recording. Try again, or type instead."); setPhase("idle"); }
  }, [autoSend, send]);

  const stopRecording = useCallback(() => {
    const m = media.current; if (!m) return;
    m.rec.onstop = () => {
      const blob = new Blob(m.chunks, { type: m.rec.mimeType || "audio/webm" });
      cancelAnimationFrame(m.raf); clearInterval(m.timer);
      m.stream.getTracks().forEach((t) => t.stop()); void m.ctx.close().catch(() => undefined);
      media.current = null;
      void transcribe(blob);
    };
    try { m.rec.stop(); } catch { cancelRecording(); setPhase("idle"); }
  }, [cancelRecording, transcribe]);

  const startRecording = async () => {
    setError(""); setReply("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return setError("This browser cannot record audio. Type your message instead.");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      const rec = new MediaRecorder(stream);
      const ctx = new AudioContext(); const an = ctx.createAnalyser(); an.fftSize = 512; ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Float32Array(an.fftSize); const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const tick = () => { an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; setLevel(Math.min(1, Math.sqrt(s / buf.length) * 8)); if (media.current) media.current.raf = requestAnimationFrame(tick); };
      const timer = setInterval(() => setSecs((n) => { if (n + 1 >= MAX_SECONDS) stopRecording(); return n + 1; }), 1000);
      media.current = { rec, stream, ctx, chunks, raf: 0, timer };
      rec.start(); setSecs(0); setPhase("recording"); media.current.raf = requestAnimationFrame(tick);
    } catch (e) {
      const name = (e as { name?: string }).name;
      setError(name === "NotAllowedError" ? "Microphone permission is blocked. Allow it in the browser's site settings, then try again." : "The microphone could not start. Check that no other app is using it.");
    }
  };

  const decide = async (p: Pending, approve: boolean) => {
    setPending((l) => l.filter((x) => x.id !== p.id));
    const r = approve ? await approveOne(p.id) : await skipOne(p.id);
    if (!r.ok) setError((r as { error?: string }).error ?? "Could not finish that.");
    router.refresh();
  };

  if (!enabled) return null;
  const busy = phase === "transcribing" || phase === "thinking";
  return (
    <>
      <button type="button" onClick={show} aria-label="Quick ask: type or speak to the assistant" title="Quick ask (press /)"
        className="fixed right-4 bottom-[10.5rem] z-20 grid h-12 w-12 place-items-center rounded-full border border-line-strong bg-surface text-accent shadow-pop transition hover:-translate-y-0.5 active:scale-90 md:right-8 md:bottom-24">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z" /><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></svg>
      </button>
      <dialog ref={dlg} onClose={close} onClick={(e) => { if (e.target === dlg.current) close(); }}
        className="mx-auto mb-0 mt-auto w-full max-w-lg rounded-t-3xl border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-black/40 backdrop:backdrop-blur-[2px] md:m-auto md:rounded-3xl">
        {open && (
          <div className="flex flex-col gap-3 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight">Ask Founder OS</h2>
              <button type="button" onClick={close} className="grid h-8 w-8 place-items-center rounded-full text-lg text-neutral-500 hover:bg-tint" aria-label="Close">×</button>
            </div>

            <div className="flex items-end gap-2">
              <button type="button" onClick={phase === "recording" ? stopRecording : () => void startRecording()} disabled={busy} aria-pressed={phase === "recording"} aria-label={phase === "recording" ? "Stop and send" : "Speak"}
                className={`relative grid h-14 w-14 shrink-0 place-items-center rounded-full text-white transition active:scale-90 disabled:opacity-60 ${phase === "recording" ? "bg-rose-500" : "bg-accent text-on-accent"}`}>
                {phase === "recording" && <span aria-hidden className="absolute inset-0 rounded-full bg-rose-500/40" style={{ transform: `scale(${1 + level * 0.7})`, transition: "transform 90ms" }} />}
                <svg viewBox="0 0 24 24" className="relative h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{phase === "recording" ? <rect x="7" y="7" width="10" height="10" rx="2" /> : <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>}</svg>
              </button>
              <textarea ref={textRef} value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} autoFocus disabled={busy || phase === "recording"}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); } }}
                placeholder={phase === "recording" ? `Listening… ${secs}s. Tap the square when done.` : phase === "transcribing" ? "Understanding…" : "Type or tap the mic and speak"}
                className={`${input} min-w-0 flex-1 resize-none`} aria-label="Message for the assistant" dir="auto" />
              <button type="button" onClick={() => void send(text)} disabled={busy || phase === "recording" || !text.trim()} className={btnPrimary}>{phase === "thinking" ? "…" : "Send"}</button>
            </div>
            <label className="flex items-center gap-2 text-xs text-neutral-600"><input type="checkbox" checked={autoSend} onChange={(e) => { setAutoSend(e.target.checked); store.set("fos-quick-autosend", e.target.checked ? "1" : "0"); }} />Send as soon as I stop speaking</label>

            {phase === "thinking" && <p className="text-sm text-neutral-500" role="status">Thinking…</p>}
            {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
            {reply && <p dir="auto" className="whitespace-pre-wrap rounded-2xl border border-line bg-black/[.03] px-4 py-3 text-[15px]">{reply}</p>}
            {pending.length > 0 && (
              <ul className="flex flex-col gap-2">
                {pending.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">
                    <span dir="auto" className="min-w-0 flex-1 text-amber-900">{p.text}</span>
                    <button type="button" className={btnPrimary} onClick={() => void decide(p, true)}>Approve</button>
                    <button type="button" className={btn} onClick={() => void decide(p, false)}>Skip</button>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/assistant" onClick={close} className="self-start text-xs text-neutral-500 underline">Open the full assistant</Link>
          </div>
        )}
      </dialog>
    </>
  );
}
