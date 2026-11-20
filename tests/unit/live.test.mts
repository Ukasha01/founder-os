import test from "node:test";
import assert from "node:assert/strict";
import { Vad } from "../../src/lib/vad.ts";
import { downsample, floatToInt16, int16ToBytes, pcm16ToWav, rms } from "../../src/lib/wav.ts";
import { classifyCommand, classifyDecision } from "../../src/lib/voice-commands.ts";
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
  assert.deepEqual(run(v, 0.003, 700), []);           // a short thinking pause does NOT cut the speaker off
  assert.deepEqual(run(v, 0.003, 300), ["end"]);      // 1 s of silence ends it
});
test("VAD: a pause mid-sentence followed by more speech keeps one utterance", () => {
  const v = new Vad();
  const ev = [...run(v, 0.1, 800), ...run(v, 0.003, 800), ...run(v, 0.1, 800), ...run(v, 0.003, 1600)];
  assert.deepEqual(ev, ["start", "end"]);
});
test("VAD: a short click is ignored and a tiny blip is discarded", () => {
  const v = new Vad();
  assert.deepEqual(run(v, 0.2, 60), []);              // 60 ms click never starts speech
  assert.deepEqual(run(v, 0.003, 500), []);
  const ev = [...run(v, 0.1, 160), ...run(v, 0.003, 1100)]; // 160 ms of sound: starts, but is too short to send
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

import { routeTools, TOOLS } from "../../src/lib/ai/tools.ts";
import { providerOrder, toOpenAiMessages, toOpenAiTools, parseOpenAi, compatProviders } from "../../src/lib/ai/llm.ts";
import { toGeminiContents, generationConfig } from "../../src/lib/ai/gemini.ts";
import { sttOrder, hasDevanagari, confidentText } from "../../src/lib/ai/speech.ts";

test("tool routing: every read tool always, writes only for the topic mentioned", () => {
  const reads = Object.entries(TOOLS).filter(([, t]) => t.kind === "read").map(([k]) => k);
  const a = routeTools("what is in my inbox");
  for (const r of reads) assert.ok(a.includes(r), r);
  assert.ok(a.includes("create_task") && !a.includes("create_habit") && a.includes("delete_task"));
  assert.ok(routeTools("Maine aaj 45 minute kaam kiya aur namaz padh li").includes("log_time"));
  assert.ok(routeTools("Maine aaj 45 minute kaam kiya aur namaz padh li").includes("log_habit"));
  assert.ok(routeTools("میری نماز لاگ کرو").includes("log_habit"));
  assert.ok(routeTools("kal 4 baje meeting rakho").includes("create_meeting"));
  assert.ok(routeTools("yeh task delete kar do").includes("delete_task"));
  assert.ok(routeTools("اس ٹاسک کو ڈیلیٹ کرو").includes("delete_task"));
  for (const n of routeTools("everything goal habit kpi meeting delete review")) assert.ok(n in TOOLS, n);
});
test("provider order: fast providers first, Gemini as fallback, explicit choice honoured", () => {
  assert.deepEqual(providerOrder({}), []);
  assert.deepEqual(providerOrder({ GEMINI_API_KEY: "g" }), ["gemini"]);
  assert.deepEqual(providerOrder({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q" }), ["groq", "gemini"]);
  assert.deepEqual(providerOrder({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q", CEREBRAS_API_KEY: "c" }), ["cerebras", "groq", "gemini"]);
  assert.deepEqual(providerOrder({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q", LLM_PROVIDER: "gemini" }), ["gemini", "groq"]);
  assert.equal(compatProviders({ GROQ_API_KEY: "q", GROQ_MODEL: "m" })[0].model, "m");
});
test("OpenAI-style conversion keeps tool calls and results paired by id", () => {
  const msgs = toOpenAiMessages("SYS", [
    { role: "user", text: "inbox?" },
    { role: "assistant", text: "", calls: [{ id: "c1", name: "list_inbox", args: {} }] },
    { role: "tool", results: [{ id: "c1", name: "list_inbox", output: { count: 1 } }] },
  ]);
  assert.equal(msgs[0].role, "system");
  assert.equal((msgs[2].tool_calls as { id: string }[])[0].id, "c1");
  assert.equal(msgs[3].tool_call_id, "c1");
  const tools = toOpenAiTools(["list_inbox"]);
  assert.equal(tools.length, 1);
  assert.equal((tools[0].function.parameters as { type: string }).type, "object");
  const p = parseOpenAi({ choices: [{ message: { content: "<think>x</think>ok", tool_calls: [{ id: "a", function: { name: "list_tasks", arguments: "{\"due\":\"today\"}" } }, { id: "b", function: { name: "x", arguments: "{broken" } }] } }] })!;
  assert.equal(p.text, "ok");
  assert.deepEqual(p.calls[0].args, { due: "today" });
  assert.deepEqual(p.calls[1].args, {});
  assert.equal(parseOpenAi({}), null);
});
test("Gemini conversion echoes raw parts only for Gemini turns; thinking is off only for 2.5", () => {
  const raw = [{ functionCall: { name: "list_inbox", args: {} }, thoughtSignature: "sig" }];
  const g = toGeminiContents([{ role: "assistant", text: "", calls: [{ id: "g0", name: "list_inbox", args: {} }], raw, provider: "gemini" }]);
  assert.deepEqual(g[0].parts, raw);
  const o = toGeminiContents([{ role: "assistant", text: "hi", calls: [{ id: "c", name: "list_inbox", args: {} }], provider: "groq" }]);
  assert.equal(o[0].parts.length, 2);
  assert.deepEqual(generationConfig("gemini-2.5-flash"), { temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } });
  assert.deepEqual(generationConfig("gemini-3.0-flash"), { temperature: 0.2 });
});
test("speech-to-text provider order", () => {
  assert.deepEqual(sttOrder({}), []);
  assert.deepEqual(sttOrder({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q" }), ["gemini", "groq"]);
  assert.deepEqual(sttOrder({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q", STT_PROVIDER: "groq" }), ["groq", "gemini"]);
  assert.deepEqual(sttOrder({ GROQ_API_KEY: "q", STT_PROVIDER: "gemini" }), ["groq"]);
});

import { composeReply, localize } from "../../src/lib/ai/reply.ts";
test("yes/no decisions: tolerant of fillers, strict about new requests", () => {
  for (const s of ["yes haan", "haan ji", "ji kar do", "bilkul", "ہاں", "ہاں بھائی کر دو", "ok do it".replace("it", "kar"), "yes please"]) assert.equal(classifyDecision(s), "yes", s);
  for (const s of ["nahi", "nahi nahi", "نہیں", "no", "mat karo", "cancel"]) assert.equal(classifyDecision(s), "no", s);
  for (const s of ["kal ka task add kar do", "haan aur ek task banao", "do", "kar do", "what is on my list", ""]) assert.equal(classifyDecision(s), null, s);
});
test("non-speech hallucinations are dropped", () => {
  for (const s of ["موسیقی", "Music", "[Music]", "♪", "Thank you for watching!", "شکریہ۔", "..."]) assert.equal(cleanTranscript(s), "", s);
  assert.equal(cleanTranscript("موسیقی چلاؤ"), "موسیقی چلاؤ");
});
test("composeReply builds truthful, language-matched replies", () => {
  const en = composeReply({ urdu: false, modelText: "ignored", done: [], waiting: ["DELETE 12 tasks titled “nn”"], errors: [] });
  assert.match(en, /Say yes/); assert.ok(!en.includes("ignored"));
  assert.match(composeReply({ urdu: true, modelText: "", done: ["a", "b", "c", "d"], waiting: [], errors: [] }), /ہو گیا.*2 مزید/);
  assert.equal(composeReply({ urdu: false, modelText: "You have 3 tasks.", done: [], waiting: [], errors: [] }), "You have 3 tasks.");
  assert.match(composeReply({ urdu: false, modelText: "", done: [], waiting: [], errors: ["x"], dropped: 3 }), /Could not do: x.*3 more/);
  assert.match(composeReply({ urdu: false, modelText: "", done: [], waiting: [], errors: [], skipped: 2 }), /skipped/);
});
test("routing: typo and bulk phrasing still reach delete tools", () => {
  assert.ok(routeTools("deelte all tasks").includes("bulk_tasks"));
  assert.ok(routeTools("undo that").includes("undo_last_delete"));
});
test("Urdu conversations get Urdu previews and a 'heard' echo for confirmations", () => {
  const u = localize("bulk_tasks", { action: "delete", count: 72, match: "nn" }, "DELETE 72 tasks", true);
  assert.ok(!/[A-Za-z]{3,}/.test(u.replace(/“nn”/, "")), u);
  assert.equal(localize("bulk_tasks", {}, "DELETE 72 tasks", false), "DELETE 72 tasks");
  const r = composeReply({ urdu: false, modelText: "", done: [], waiting: ["DELETE 5 tasks"], errors: [], heard: "delete nn" });
  assert.match(r, /^I heard: “delete nn”\./);
});
test("Hindi-script transcripts are detected so they can be redone as Urdu", () => {
  assert.equal(hasDevanagari("यार मुझे यह बताओ"), true);
  assert.equal(hasDevanagari("یار مجھے یہ بتاؤ"), false);
  assert.equal(hasDevanagari("Is there any event"), false);
});

import { detectLang, isEcho, languageDirective } from "../../src/lib/ai/lang.ts";
test("language is chosen from the user's words", () => {
  assert.equal(detectLang("Thank you."), "en");
  assert.equal(detectLang("Please tell me the performance of last week"), "en");
  assert.equal(detectLang("mujhe kal ka task bata do"), "ur");
  assert.equal(detectLang("آج کا شیڈول بتاؤ"), "ur");
  assert.equal(detectLang("Is there any event in our calendar?"), "en");
  assert.match(languageDirective("en"), /English only/);
});
test("the assistant's own voice is recognised as an echo", () => {
  assert.equal(isEcho("You're welcome. You're welcome.", "You’re welcome!"), true);
  assert.equal(isEcho("Add a task to call the courier tomorrow", "You have 3 tasks today."), false);
  assert.equal(isEcho("anything", ""), false);
});
test("filler phrases that speech recognition invents on silence are dropped, but yes/ok still work", () => {
  for (const s of ["Thank you.", "you", "So", "Tchau.", "Bye."]) assert.equal(cleanTranscript(s), "", s);
  assert.equal(cleanTranscript("okay"), "okay");
  assert.equal(cleanTranscript("thank you for the report, add it to my inbox"), "thank you for the report, add it to my inbox");
});
test("a short yes is never mistaken for echo, but a repeated sentence is", () => {
  assert.equal(isEcho("yes", "DELETE 7 tasks. Say yes to confirm, or no to skip."), false);
  assert.equal(isEcho("Let me know which of these, or both, you'd like to delete.", "Which task to remove? Let me know which of these, or both, you'd like to delete."), true);
});
test("unsure speech segments are dropped; foreign-script guesses are dropped", () => {
  const body = { text: "x", segments: [{ text: "add a task", no_speech_prob: 0.05, avg_logprob: -0.2 }, { text: "thank you", no_speech_prob: 0.9, avg_logprob: -0.3 }, { text: "blah", no_speech_prob: 0.1, avg_logprob: -1.6 }] };
  assert.equal(confidentText(body), "add a task");
  assert.equal(confidentText({ text: "plain" }), "plain");
  assert.equal(cleanTranscript("야, 만나서 너 좀 쳐보죠."), "");
  assert.equal(cleanTranscript("Привет"), "");
});
