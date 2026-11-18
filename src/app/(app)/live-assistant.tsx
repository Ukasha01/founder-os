"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Vad } from "@/lib/vad";
import { downsample, floatToInt16, int16ToBytes, pcm16ToWav, rms } from "@/lib/wav";
import { classifyCommand } from "@/lib/voice-commands";
import { MESSAGES, classifyMicProbe, micPermissionState, permissionsPolicyAllowsMic } from "@/lib/voice";

type Ui = "off" | "needs_tap" | "starting" | "listening" | "hearing" | "transcribing" | "thinking" | "speaking";
const RATE = 16000;
const PREROLL = Math.round(RATE * 0.6);
const LABEL: Record<Ui, string> = {
  off: "Voice is off", needs_tap: "Tap to start listening", starting: "Starting the microphone…", listening: "Listening",
  hearing: "Hearing you…", transcribing: "Understanding…", thinking: "Thinking…", speaking: "Speaking. Say “ruk jao” to stop",
};
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
const isUrdu = (t: string) => /[؀-ۿ]/.test(t);
// Short spoken follow-ups, in the language of the reply.
const SAY = {
  ur: { done: "ہو گیا۔", wait: (n: number) => `${n} تبدیلیاں آپ کی منظوری کا انتظار کر رہی ہیں۔ ہاں کہیں یا نہیں۔`, failed: "کچھ تبدیلیاں نہیں ہو سکیں۔", tap: "حذف کرنے کے لیے اسکرین پر تصدیق کریں۔" },
  en: { done: "Done.", wait: (n: number) => `${n} change${n > 1 ? "s are" : " is"} waiting. Say yes or no.`, failed: "Some changes could not be made.", tap: "Please confirm deletions on screen." },
};

export function LiveAssistant({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [ui, setUi] = useState<Ui>("off");
  const [heard, setHeard] = useState("");
  const [reply, setReply] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState(0);

  // Everything that changes many times a second lives in one mutable object, not React state.
  const S = useRef({
    running: false, ctx: null as AudioContext | null, stream: null as MediaStream | null, node: null as AudioWorkletNode | null,
    vad: new Vad(), preroll: [] as Float32Array[], prerollLen: 0, chunks: [] as Float32Array[], inUtt: false, calibrating: 0,
    ui: "off" as Ui, epoch: 0, speakToken: 0, source: null as AudioBufferSourceNode | null, abort: null as AbortController | null,
    pending: false, lastLevel: 0, noUrduVoiceWarned: false,
  });
  const set = useCallback((u: Ui) => { S.current.ui = u; setUi(u); }, []);

  const stopSpeaking = useCallback(() => {
    const s = S.current;
    s.speakToken++;
    try { s.source?.stop(); } catch { /* already stopped */ }
    s.source = null;
    s.abort?.abort(); s.abort = null;
    try { window.speechSynthesis?.cancel(); } catch { /* none */ }
  }, []);

  const playBuffer = useCallback((buf: AudioBuffer, token: number) => new Promise<void>((resolve) => {
    const s = S.current;
    if (!s.ctx || token !== s.speakToken) return resolve();
    const src = s.ctx.createBufferSource();
    src.buffer = buf; src.connect(s.ctx.destination);
    src.onended = () => { if (s.source === src) s.source = null; resolve(); };
    s.source = src; src.start();
  }), []);

  // The phone's own voice answers instantly, costs nothing and never runs out. Voices load late on some browsers, so wait briefly.
  const findVoice = useCallback(async (urdu: boolean): Promise<SpeechSynthesisVoice | null> => {
    const synth = window.speechSynthesis;
    if (!synth) return null;
    const pick = () => synth.getVoices().find((v) => v.lang.toLowerCase().replace("_", "-").startsWith(urdu ? "ur" : "en")) ?? null;
    let v = pick();
    if (!v && !synth.getVoices().length) await new Promise<void>((res) => { const t = setTimeout(res, 800); synth.addEventListener("voiceschanged", () => { clearTimeout(t); res(); }, { once: true }); });
    v = pick();
    return v;
  }, []);

  const localSpeak = useCallback(async (parts: string[], voice: SpeechSynthesisVoice, token: number) => {
    const synth = window.speechSynthesis;
    for (const p of parts) {
      if (token !== S.current.speakToken) return;
      await new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(p);
        u.voice = voice; u.lang = voice.lang; u.rate = 1.05;
        u.onend = () => resolve(); u.onerror = () => resolve();
        synth.speak(u);
      });
    }
  }, []);

  const speak = useCallback(async (text: string) => {
    const s = S.current;
    if (!text.trim() || !s.running) return set(s.running ? "listening" : "off");
    stopSpeaking();
    const token = s.speakToken;
    set("speaking");
    const sentences = text.slice(0, 600).split(/(?<=[.!?۔؟])\s+/).filter(Boolean);
    const parts: string[] = [];
    for (const x of sentences) { if (parts.length && (parts[parts.length - 1] + " " + x).length <= 220) parts[parts.length - 1] += " " + x; else parts.push(x); }
    const urdu = isUrdu(text);
    const local = await findVoice(urdu);
    if (token !== s.speakToken) return;
    if (local) await localSpeak(parts, local, token);
    else {
      // No phone voice for this language: use the server voice (ElevenLabs / Gemini) if one is set up.
      const ac = new AbortController(); s.abort = ac;
      const fetchPart = async (p: string) => {
        const r = await fetch("/api/voice/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: p }), signal: ac.signal });
        if (!r.ok) throw new Error(String(r.status));
        return s.ctx!.decodeAudioData(await r.arrayBuffer());
      };
      let next: Promise<AudioBuffer> | null = parts.length ? fetchPart(parts[0]) : null;
      next?.catch(() => undefined);
      for (let i = 0; i < parts.length && token === s.speakToken; i++) {
        const cur = next!;
        next = i + 1 < parts.length ? fetchPart(parts[i + 1]) : null;
        next?.catch(() => undefined);
        try { await playBuffer(await cur, token); }
        catch {
          if (token === s.speakToken && !s.noUrduVoiceWarned) { s.noUrduVoiceWarned = true; setNotice(urdu ? "This phone has no Urdu voice and no voice key is set, so I reply in text. Install the Urdu voice in Android settings (Google text-to-speech), or add a voice key." : "Voice replies are unavailable right now; showing text only."); }
          break;
        }
      }
    }
    if (token === s.speakToken) { s.abort = null; if (s.running) set("listening"); }
  }, [findVoice, localSpeak, playBuffer, set, stopSpeaking]);

  const handleUtterance = useCallback(async (wav: Uint8Array) => {
    const s = S.current;
    const epoch = ++s.epoch;
    const stale = () => epoch !== s.epoch || !s.running;
    set("transcribing");
    let text = "";
    try {
      const r = await fetch("/api/voice/transcribe", { method: "POST", headers: { "content-type": "audio/wav" }, body: wav as BodyInit });
      const j = (await r.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!r.ok) { setNotice(j.error ?? "I could not understand the audio."); return set("listening"); }
      text = (j.text ?? "").trim();
    } catch { setNotice("No connection. Voice needs the internet."); return set("listening"); }
    if (stale()) return;
    if (!text) return set("listening");
    setHeard(text); setNotice(""); setOpen(true);

    const cmd = classifyCommand(text);
    if (cmd === "stop") { stopSpeaking(); return set("listening"); }
    if ((cmd === "yes" || cmd === "no") && s.pending) {
      set("thinking");
      try {
        const r = await fetch("/api/assistant/decide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: cmd === "yes" ? "approve" : "reject" }) });
        const j = (await r.json()) as { done?: number; failed?: number; needsTap?: number; skipped?: number };
        s.pending = false; router.refresh();
        const say = isUrdu(text) ? SAY.ur : SAY.en;
        const msg = cmd === "no" ? (isUrdu(text) ? "ٹھیک ہے، چھوڑ دیا۔" : "Okay, skipped.") : [j.done ? say.done : "", j.failed ? say.failed : "", j.needsTap ? say.tap : ""].filter(Boolean).join(" ") || say.done;
        setReply(msg); if (!stale()) await speak(msg); else set("listening");
      } catch { setNotice("Could not save that. Try again."); set("listening"); }
      return;
    }

    set("thinking");
    try {
      const r = await fetch("/api/assistant/turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: text, voice: true }) });
      const j = (await r.json()) as { ok: boolean; error?: string; reply?: string; pending?: number; executed?: number; refused?: number };
      router.refresh();
      if (!j.ok) { setNotice(j.error ?? "The assistant could not answer."); return set("listening"); }
      s.pending = (j.pending ?? 0) > 0;
      const say = isUrdu(`${text} ${j.reply ?? ""}`) ? SAY.ur : SAY.en;
      const extra = [(j.executed ?? 0) > 0 ? say.done : "", (j.refused ?? 0) > 0 ? say.failed : "", s.pending ? say.wait(j.pending!) : ""].filter(Boolean).join(" ");
      const out = [j.reply ?? "", extra].filter(Boolean).join(" ");
      setReply(out);
      if (stale()) return;           // you started talking again while I was thinking: do not talk over you
      await speak(out);
    } catch { setNotice("Could not reach the assistant. Check your connection."); set("listening"); }
  }, [router, set, speak, stopSpeaking]);

  const onBlock = useCallback((block: Float32Array) => {
    const s = S.current;
    const rate = s.ctx!.sampleRate;
    const dt = (block.length / rate) * 1000;
    const level = rms(block);
    if (s.calibrating > 0) { s.vad.calibrate(level); s.calibrating -= dt; return; }
    const now = performance.now();
    if (now - s.lastLevel > 100) { s.lastLevel = now; setLevel(Math.min(1, level * 8)); }
    const ds = downsample(block, rate, RATE);
    if (s.inUtt) s.chunks.push(ds);
    else { s.preroll.push(ds); s.prerollLen += ds.length; while (s.prerollLen > PREROLL && s.preroll.length > 1) s.prerollLen -= s.preroll.shift()!.length; }
    const ev = s.vad.feed(level, dt, s.ui === "speaking");
    if (ev === "start") {
      if (s.ui === "speaking") stopSpeaking();           // you interrupted: stop talking at once
      s.epoch++;                                         // anything still being worked out for the old question is now stale
      s.inUtt = true; s.chunks = [...s.preroll];
      s.preroll = []; s.prerollLen = 0;
      set("hearing");
    } else if (ev === "end" && s.inUtt) {
      s.inUtt = false;
      const total = s.chunks.reduce((n, c) => n + c.length, 0);
      const all = new Float32Array(total); let o = 0; for (const c of s.chunks) { all.set(c, o); o += c.length; }
      s.chunks = [];
      void handleUtterance(pcm16ToWav(int16ToBytes(floatToInt16(all)), RATE));
    } else if (ev === "discard") { s.inUtt = false; s.chunks = []; if (s.ui === "hearing") set("listening"); }
  }, [handleUtterance, set, stopSpeaking]);

  const stop = useCallback(() => {
    const s = S.current;
    s.running = false; s.epoch++; stopSpeaking();
    s.node?.disconnect(); s.node = null;
    s.stream?.getTracks().forEach((t) => t.stop()); s.stream = null;
    void s.ctx?.close().catch(() => undefined); s.ctx = null;
    s.inUtt = false; s.chunks = []; s.preroll = []; s.prerollLen = 0; s.pending = false;
    set("off");
  }, [set, stopSpeaking]);

  const start = useCallback(async () => {
    const s = S.current;
    if (s.running) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) { setNotice(MESSAGES.unsupported); return set("off"); }
    set("starting"); setNotice("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      const ctx = new AudioContext();
      await ctx.audioWorklet.addModule("/pcm-worklet.js");
      const node = new AudioWorkletNode(ctx, "pcm-capture", { numberOfOutputs: 1, outputChannelCount: [1] });
      const mute = ctx.createGain(); mute.gain.value = 0;            // keeps the graph running without playing the mic back
      ctx.createMediaStreamSource(stream).connect(node); node.connect(mute); mute.connect(ctx.destination);
      s.stream = stream; s.ctx = ctx; s.node = node; s.running = true;
      s.vad = new Vad(); s.calibrating = 800; s.preroll = []; s.prerollLen = 0; s.chunks = []; s.inUtt = false;
      node.port.onmessage = (e: MessageEvent<Float32Array>) => { if (S.current.running) onBlock(e.data); };
      stream.getAudioTracks()[0]?.addEventListener("ended", () => { if (S.current.running) { stop(); setNotice("The microphone was disconnected."); } });
      if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
      store.set("fos-live", "1");
      set("listening");
    } catch (e) {
      const name = (e as { name?: string }).name ?? "Error";
      const issue = classifyMicProbe({ ok: false, name }, { secure: window.isSecureContext, policyAllows: permissionsPolicyAllowsMic() }) ?? "unknown";
      setNotice(MESSAGES[issue]);
      s.stream?.getTracks().forEach((t) => t.stop()); s.stream = null;
      s.running = false; set("off");
    }
  }, [onBlock, set, stop]);

  // Open the app -> start listening. The browser only lets a page start the microphone without a tap if you
  // already allowed it for this site; otherwise the first tap anywhere starts it.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const wake = () => { if (!S.current.running && store.get("fos-live") !== "0") void start(); else void S.current.ctx?.resume(); };
    (async () => {
      if (store.get("fos-live") === "0") return;
      const state = await micPermissionState();
      if (cancelled) return;
      if (state === "granted") void start();
      else { set("needs_tap"); window.addEventListener("pointerdown", wake, { once: true }); }
    })();
    const resume = () => { void S.current.ctx?.resume(); };
    window.addEventListener("pointerdown", resume);
    const vis = () => { if (document.visibilityState === "visible") void S.current.ctx?.resume(); };
    document.addEventListener("visibilitychange", vis);
    return () => { cancelled = true; window.removeEventListener("pointerdown", wake); window.removeEventListener("pointerdown", resume); document.removeEventListener("visibilitychange", vis); stop(); };
    // start/stop are stable enough; this must run once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  if (!enabled) return null;
  const on = ui !== "off" && ui !== "needs_tap";
  const busy = ui === "transcribing" || ui === "thinking";
  return (
    <div className="fixed bottom-20 left-4 z-30 flex max-w-[calc(100vw-7rem)] flex-col items-start gap-2 md:right-8 md:bottom-24 md:left-auto md:items-end" dir="ltr">
      {open && (heard || reply || notice) && (
        <div className="w-80 max-w-full rounded-2xl border border-line bg-surface p-3 text-sm shadow-pop" role="status" aria-live="polite">
          {notice && <p className="mb-2 rounded-lg bg-amber-50 p-2 text-amber-900">{notice}</p>}
          {heard && <p dir="auto" className="text-neutral-500">{heard}</p>}
          {reply && <p dir="auto" className="mt-1 font-medium text-ink">{reply}</p>}
          <div className="mt-2 flex gap-3 text-xs"><Link href="/assistant" className="underline">Open Assistant</Link><button type="button" className="underline" onClick={() => setOpen(false)}>Hide</button></div>
        </div>
      )}
      <div className="flex items-center gap-2">
        {ui === "speaking" && <button type="button" onClick={() => { stopSpeaking(); set("listening"); }} className="rounded-full border border-line-strong bg-surface px-3 py-2 text-sm font-medium shadow-pop active:scale-95">Stop</button>}
        <button type="button" aria-pressed={on}
          aria-label={on ? "Turn voice assistant off" : "Turn voice assistant on"}
          onClick={() => { if (on) { store.set("fos-live", "0"); stop(); } else void start(); }}
          onDoubleClick={() => setOpen((o) => !o)}
          className={`relative grid h-14 w-14 place-items-center rounded-full text-white shadow-pop transition active:scale-95 ${!on ? "bg-neutral-500" : ui === "hearing" ? "bg-rose-500" : ui === "speaking" ? "bg-emerald-600" : busy ? "bg-amber-500" : "bg-ink"}`}>
          {on && ui === "listening" && <span aria-hidden className="absolute inset-0 rounded-full bg-ink/30" style={{ transform: `scale(${1 + level * 0.5})`, transition: "transform 100ms" }} />}
          <svg viewBox="0 0 24 24" className="relative h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {on ? <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></> : <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16" /></>}
          </svg>
        </button>
        <button type="button" onClick={() => setOpen((o) => !o)} className="rounded-full bg-surface/95 px-3 py-1.5 text-xs font-medium shadow-pop" aria-live="polite">{LABEL[ui]}</button>
      </div>
    </div>
  );
}
