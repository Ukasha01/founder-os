// Short spoken commands in English, Roman Urdu and Urdu script. Matched on the WHOLE utterance only
// (and only short ones), so a sentence that merely contains "stop" is never mistaken for a command.

export type Command = "stop" | "yes" | "no" | null;

const norm = (s: string) =>
  s.toLowerCase().normalize("NFKC")
    .replace(/[ً-ٰٟ]/g, "")        // Arabic/Urdu diacritics
    .replace(/[.,!?؟۔،;:'"“”()\-]/g, " ")
    .replace(/\s+/g, " ").trim();

const STOP = ["ruk jao", "ruk jaao", "rukjao", "ruk", "ruko", "ruk ja", "bas", "bas karo", "bas kar do", "bas kar", "chup", "chup karo", "khamosh", "khamoosh", "stop", "stop it", "wait", "hold on", "pause", "enough", "thehro", "thehro zara", "theher jao",
  "رک جاؤ", "رک جاو", "رکو", "رک", "رک جا", "بس", "بس کرو", "بس کر دو", "چپ", "چپ کرو", "خاموش", "ٹھہرو", "ٹھہر جاؤ", "ٹھہرو ذرا"];
const YES = ["haan", "han", "ha", "haan ji", "ji", "ji haan", "ji han", "kar do", "kardo", "kar dein", "theek hai", "thik hai", "theek", "okay", "ok", "yes", "yeah", "sure", "approve", "approve kar do", "confirm", "done kar do", "haan kar do",
  "ہاں", "ہاں جی", "جی", "جی ہاں", "کر دو", "کردو", "ٹھیک ہے", "ٹھیک", "اوکے"];
const NO = ["nahi", "nahin", "nahi nahi", "na", "no", "nope", "skip", "skip kar do", "cancel", "mat karo", "rehne do", "reh ne do", "chhor do", "chor do",
  "نہیں", "نہیں نہیں", "نہ", "مت کرو", "رہنے دو", "چھوڑ دو", "چھوڑو"];

const SETS: [Exclude<Command, null>, Set<string>][] = [["stop", new Set(STOP.map(norm))], ["yes", new Set(YES.map(norm))], ["no", new Set(NO.map(norm))]];

export function classifyCommand(text: string): Command {
  const t = norm(text);
  if (!t || t.split(" ").length > 4) return null;
  for (const [name, set] of SETS) if (set.has(t)) return name;
  return null;
}

// A spoken or typed answer to "do you confirm?". Word by word, so "yes haan", "haan kar do", "ہاں بھائی کر دو" all count,
// while any sentence that contains other words (a new request) does not.
const YES_WORDS = new Set(["haan", "han", "ha", "haanji", "ji", "yes", "yeah", "yep", "yup", "ok", "okay", "sure", "kar", "do", "dein", "den", "kardo", "karo", "theek", "thik", "hai", "bilkul", "zaroor", "zarur", "approve", "confirm", "confirmed", "done", "please", "go", "ahead", "bhai", "yar", "yaar", "delete", "sab", "sare", "saray",
  "ہاں", "ہاں،", "جی", "کر", "دو", "کریں", "کردو", "ٹھیک", "ہے", "بالکل", "ضرور", "اوکے", "بھائی", "یار", "ڈیلیٹ", "سب", "سارے"]);
const YES_STRONG = new Set(["haan", "han", "ha", "haanji", "ji", "yes", "yeah", "yep", "yup", "ok", "okay", "sure", "theek", "thik", "bilkul", "zaroor", "zarur", "approve", "confirm", "confirmed", "kardo", "ہاں", "جی", "ٹھیک", "بالکل", "ضرور", "اوکے", "کردو"]);
const NO_WORDS = new Set(["nahi", "nahin", "nai", "na", "no", "nope", "mat", "skip", "cancel", "rehne", "rahne", "chhor", "chor", "chhordo", "choro", "ruk", "stop", "dont", "don't", "nahi", "نہیں", "نہ", "مت", "رہنے", "چھوڑ", "چھوڑو", "رک", "کینسل"]);

export function classifyDecision(text: string): "yes" | "no" | null {
  const words = norm(text).split(" ").filter(Boolean);
  if (!words.length || words.length > 6) return null;
  if (words.some((w) => NO_WORDS.has(w))) return words.every((w) => NO_WORDS.has(w) || YES_WORDS.has(w)) ? "no" : null;
  return words.every((w) => YES_WORDS.has(w)) && words.some((w) => YES_STRONG.has(w)) ? "yes" : null;
}
