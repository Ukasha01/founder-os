import test from "node:test";
import assert from "node:assert/strict";
import { Vad } from "../../src/lib/vad.ts";
import { downsample, floatToInt16, int16ToBytes, pcm16ToWav, rms } from "../../src/lib/wav.ts";
import { classifyCommand } from "../../src/lib/voice-commands.ts";
import { cleanTranscript, extractAudio, extractText, pcmRate, pickProvider, toPlayable } from "../../src/lib/ai/speech.ts";

// Feed `ms` milliseconds of constant loudness in 20 ms blocks; return every event seen.
function run(v: Vad, level: number, ms: number, speaking = false) {
  const ev: string[] = [];
  for (let t = 0; t < ms; t += 20) { const e = v.feed(level, 20, speaking); if (e) ev.push(e); }
  return ev;
}

test("VAD: silence produces nothing; speech then a long pause ends the utterance", () => {
  const v = new Vad();
  assert.deepEqual(run(v, 0.003, 3000), []);
  assert.deepEqual(run(v, 0.1, 1000), ["start"]);
  assert.deepEqual(run(v, 0.003, 1000), []);          // a one-second pause does NOT cut the speaker off
  assert.deepEqual(run(v, 0.003, 600), ["end"]);      // 1.6 s of silence ends it
});
test("VAD: a pause mid-sentence followed by more speech keeps one utterance", () => {
  const v = new Vad();
  const ev = [...run(v, 0.1, 800), ...run(v, 0.003, 1200), ...run(v, 0.1, 800), ...run(v, 0.003, 1600)];
  assert.deepEqual(ev, ["start", "end"]);
});
test("VAD: a short click is ignored and a tiny blip is discarded", () => {
  const v = new Vad();
  assert.deepEqual(run(v, 0.2, 60), []);              // 60 ms click never starts speech
  assert.deepEqual(run(v, 0.003, 500), []);
  const ev = [...run(v, 0.1, 160), ...run(v, 0.003, 1700)]; // 160 ms of sound: starts, but is too short to send
  assert.deepEqual(ev, ["start", "discard"]);
});
test("VAD: adapts to a noisy room instead of firing constantly", () => {
  const v = new Vad();
  for (let i = 0; i < 50; i++) v.calibrate(0.02);      // ~1 s of fan / street noise measured when the mic opens
  assert.deepEqual(run(v, 0.02, 4000), []);            // the same noise afterwards is not speech
  assert.deepEqual(run(v, 0.12, 500), ["start"]);      // a real voice well above the noise still is
});
test("VAD: barge-in needs louder, longer sound than normal start", () => {
  const v = new Vad();
  assert.deepEqual(run(v, 0.02, 2000, true), []);     // quiet speaker echo while the assistant talks: ignored
  assert.deepEqual(run(v, 0.3, 200, true), []);       // too short
  assert.deepEqual(run(v, 0.3, 200, true), ["start"]); // sustained real voice interrupts
});
test("VAD: a very long utterance is cut at the maximum", () => {
  const v = new Vad({ maxUtteranceMs: 5000 });
  assert.deepEqual(run(v, 0.1, 6000).slice(0, 2), ["start", "end"]);
});

test("WAV header and PCM conversion are correct", () => {
  const pcm = int16ToBytes(floatToInt16(new Float32Array([0, 1, -1, 0.5])));
  const w = pcm16ToWav(pcm, 16000);
  const dv = new DataView(w.buffer);
  assert.equal(String.fromCharCode(...w.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...w.slice(8, 12)), "WAVE");
  assert.equal(dv.getUint32(24, true), 16000);
  assert.equal(dv.getUint32(40, true), 8);
  assert.equal(w.length, 44 + 8);
  assert.equal(dv.getInt16(44 + 2, true), 32767);
  assert.equal(dv.getInt16(44 + 4, true), -32768);
});
test("downsampling keeps duration and level", () => {
  const input = new Float32Array(48000).fill(0.5);
  const out = downsample(input, 48000, 16000);
  assert.equal(out.length, 16000);
  assert.ok(Math.abs(rms(out) - 0.5) < 1e-6);
});

test("stop / yes / no commands in English, Roman Urdu and Urdu", () => {
  for (const s of ["ruk jao", "Ruk jao!", "stop", "bas karo", "رک جاؤ", "بس", "چپ", "wait"]) assert.equal(classifyCommand(s), "stop", s);
  for (const s of ["haan", "ji haan", "kar do", "ہاں", "ٹھیک ہے", "ok", "yes."]) assert.equal(classifyCommand(s), "yes", s);
  for (const s of ["nahi", "nahin", "cancel", "نہیں", "skip kar do"]) assert.equal(classifyCommand(s), "no", s);
});
test("commands only match whole short utterances", () => {
  assert.equal(classifyCommand("please stop the timer and add a task for tomorrow"), null);
  assert.equal(classifyCommand("mera kal ka task add kar do"), null);
  assert.equal(classifyCommand(""), null);
});

test("transcript cleanup removes non-speech markers but keeps Urdu text", () => {
  assert.equal(cleanTranscript("[silence]"), "");
  assert.equal(cleanTranscript("(no speech)"), "");
  assert.equal(cleanTranscript("No speech detected"), "");
  assert.equal(cleanTranscript("  کل کا ٹاسک add کر دو  "), "کل کا ٹاسک add کر دو");
});
test("Gemini audio parsing and WAV wrapping", () => {
  const raw = new Uint8Array([1, 0, 2, 0, 3, 0, 4, 0]);
  const body = { candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: Buffer.from(raw).toString("base64") } }] } }] };
  const a = extractAudio(body)!;
  assert.deepEqual([...a.bytes], [...raw]);
  assert.equal(pcmRate(a.mime), 24000);
  const p = toPlayable(a);
  assert.equal(p.mime, "audio/wav");
  assert.equal(p.bytes.length, 44 + 8);
  assert.equal(extractAudio({}), null);
  assert.equal(extractText({ candidates: [{ content: { parts: [{ text: "salaam" }, { text: "x", thought: true }] } }] }), "salaam");
  assert.equal(toPlayable({ bytes: new Uint8Array(3), mime: "audio/mpeg" }).mime, "audio/mpeg");
});
test("voice provider selection honours explicit choice and falls back sensibly", () => {
  assert.equal(pickProvider({}), "off");
  assert.equal(pickProvider({ GEMINI_API_KEY: "k" }), "gemini");
  assert.equal(pickProvider({ GEMINI_API_KEY: "k", ELEVENLABS_API_KEY: "e" }), "elevenlabs");
  assert.equal(pickProvider({ GEMINI_API_KEY: "k", ELEVENLABS_API_KEY: "e", TTS_PROVIDER: "gemini" }), "gemini");
  assert.equal(pickProvider({ GEMINI_API_KEY: "k", TTS_PROVIDER: "elevenlabs" }), "gemini"); // asked for a provider with no key
  assert.equal(pickProvider({ GEMINI_API_KEY: "k", TTS_PROVIDER: "off" }), "off");
});
