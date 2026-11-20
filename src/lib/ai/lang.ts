// Which language should this turn be answered in? Decided by code from the user's own words, not left to the model
// (the model drifted: English "Thank you." was answered in Urdu). Also catches echo of the assistant's own voice.
export type Lang = "en" | "ur";

const ROMAN = new Set(["hai", "hain", "kar", "karo", "kardo", "mujhe", "mujhay", "mera", "meri", "mere", "kya", "kal", "aaj", "nahi", "nahin", "haan", "bata", "batao", "bataiye", "ko", "ka", "ki", "ke", "se", "mein", "me", "aur", "tum", "aap", "yaar", "yar", "abhi", "kitne", "kaun", "kon", "kab", "kyun", "lagao", "rakho", "dikhao", "chahiye", "wala", "wale", "wali", "tha", "thi", "ho", "gaya", "gayi", "do", "dein", "raha", "rahi", "jao", "ji", "theek", "acha", "accha", "bhai", "sab", "sara", "saray"]);
const EN_STRONG = new Set(["the", "is", "are", "what", "my", "me", "please", "tell", "show", "any", "event", "task", "tasks", "today", "tomorrow", "thank", "thanks", "you", "yes", "no", "how", "many", "add", "delete", "create"]);

export function detectLang(text: string): Lang {
  if (/[؀-ۿऀ-ॿ]/.test(text)) return "ur";
  const words = text.toLowerCase().replace(/[^a-z\s']/g, " ").split(/\s+/).filter(Boolean);
  const roman = words.filter((w) => ROMAN.has(w)).length;
  const en = words.filter((w) => EN_STRONG.has(w)).length;
  return roman >= 2 && roman > en ? "ur" : "en";
}

export const languageDirective = (l: Lang) => l === "ur"
  ? "REPLY LANGUAGE: Urdu, written in Urdu script (the user spoke Urdu or Roman Urdu). Keep names, task titles and English terms like deadline as they are."
  : "REPLY LANGUAGE: English only. The user spoke English, so do not use Urdu, even if earlier messages were in Urdu.";

// The microphone can pick up the assistant's own voice. If what was "heard" is mostly words the assistant just said, it is an echo.
const toks = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[’‘]/g, "'").replace(/[.,!?؟۔،;:'"“”()\-]/g, " ").split(/\s+/).filter(Boolean);
export function isEcho(heard: string, lastReply: string): boolean {
  const h = toks(heard), r = new Set(toks(lastReply));
  // Needs 3+ words: a bare "yes" / "haan" can appear in the assistant's own prompt and must still count as your answer.
  if (h.length < 3 || h.length > 25 || !r.size) return false;
  return h.filter((w) => r.has(w)).length / h.length >= 0.7;
}
