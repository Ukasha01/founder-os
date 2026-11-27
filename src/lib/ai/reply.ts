// What the assistant says about changes comes from what the app actually did or is about to do (the previews),
// not from the model's wording. That keeps replies truthful and consistent, and removes English leftovers.
// Replies are plain text (the app does not render Markdown), so stray *, ** and # would be shown, and read aloud as symbols.
export const stripMarkdown = (t: string) => t.replace(/```[\s\S]*?```/g, " ").replace(/\*\*|__|`/g, "").replace(/^\s{0,3}#{1,6}\s+/gm, "").replace(/^\s*[*•]\s+/gm, "- ").replace(/\*(?=\S)([^*\n]+)\*/g, "$1").replace(/\s\*\s+(?=\S)/g, "\n- ").replace(/[ \t]+\n/g, "\n").trim();
export const isUrdu = (t: string) => /[؀-ۿ]/.test(t);

const summarise = (items: string[], urdu: boolean) => {
  if (items.length <= 2) return items.join("; ");
  const more = items.length - 2;
  return `${items.slice(0, 2).join("; ")} ${urdu ? `اور ${more} مزید` : `and ${more} more`}`;
};

// Previews are written in English. For an Urdu conversation, say the same thing in Urdu (task titles stay as written)
// so a reply never switches language halfway through.
export function localize(name: string, input: Record<string, unknown> | undefined, preview: string, urdu: boolean): string {
  if (!urdu) return preview;
  const i = input ?? {};
  const n = i.count != null ? String(i.count) : /(\d+)\s+tasks?/i.exec(preview)?.[1];
  const title = String(i.match ?? i.title_equals ?? i.title_contains ?? i.title ?? "");
  const act = { delete: "حذف", complete: "مکمل", cancel: "منسوخ" }[String(i.action) as "delete"] ?? "تبدیل";
  if (name === "bulk_tasks") return `${n ?? "کئی"} ٹاسک “${title}” (ذیلی کاموں سمیت) ${act} کرنا${i.action === "delete" ? "، بعد میں واپس بھی ہو سکتا ہے" : ""}`;
  if (name === "undo_last_delete") return "پچھلا حذف واپس کرنا";
  if (name === "delete_task") return "ایک ٹاسک (ذیلی کاموں سمیت) حذف کرنا";
  if (name === "create_task") return `نیا ٹاسک: ${title}`;
  if (name === "set_reminder") return `یاد دہانی: ${String(input?.title ?? "")} — ${String(input?.at ?? "").replace("T", " ")}`;
  if (name === "set_daily_reminder") return `روزانہ یاد دہانی: ${String(i.title ?? "")} — ${String(i.time ?? "")}`;
  if (name === "cancel_reminder") return "ایک یاد دہانی منسوخ کرنا";
  if (name === "reschedule_reminder") return "یاد دہانی کا وقت بدلنا";
  if (name === "complete_task") return "ایک ٹاسک مکمل کرنا";
  return "ایک تبدیلی";
}

export type ReplyInput = { urdu: boolean; modelText: string; done: string[]; waiting: string[]; errors: string[]; skipped?: number; dropped?: number; heard?: string };

export function composeReply(o: ReplyInput): string {
  const { urdu } = o;
  const parts: string[] = [];
  // Voice recognition can mishear. When something needs your confirmation, repeat what was heard so a mistake is obvious.
  if (o.heard && o.waiting.length) parts.push(urdu ? `میں نے سنا: “${o.heard}”۔` : `I heard: “${o.heard}”.`);
  if (o.done.length) parts.push(urdu ? `ہو گیا: ${summarise(o.done, true)}۔` : `Done: ${summarise(o.done, false)}.`);
  if (o.waiting.length) parts.push(urdu ? `${summarise(o.waiting, true)}۔ تصدیق کے لیے “ہاں” کہیں، چھوڑنے کے لیے “نہیں”۔` : `${summarise(o.waiting, false)}. Say yes to confirm, or no to skip.`);
  if (o.errors.length) parts.push(urdu ? `یہ نہیں ہو سکا: ${o.errors[0]}` : `Could not do: ${o.errors[0]}`);
  if (o.dropped && o.dropped > 0) parts.push(urdu ? `${o.dropped} مزید کام چھوڑ دیے گئے، دوبارہ کہیں۔` : `${o.dropped} more were left out; ask again for those.`);
  if (o.skipped) parts.push(urdu ? "ٹھیک ہے، چھوڑ دیا۔" : "Okay, skipped.");
  if (parts.length) return parts.join(" ");
  return stripMarkdown(o.modelText);   // a plain answer or a question: the model's own words
}

// Long answers (lists of tasks) are shown in full but only the first sentences are read aloud, cut at a sentence end,
// so the voice is short and never stops mid-word.
export function forSpeech(text: string, max = 260): string {
  const flat = text.replace(/\s*\n+\s*/g, ". ").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("۔"), cut.lastIndexOf("? "), cut.lastIndexOf("! "), cut.lastIndexOf("؟"));
  return (end > 80 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(" "))).trim();
}
