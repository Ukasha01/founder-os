// What the assistant says about changes comes from what the app actually did or is about to do (the previews),
// not from the model's wording. That keeps replies truthful and consistent, and removes English leftovers.
export const isUrdu = (t: string) => /[؀-ۿ]/.test(t);

const summarise = (items: string[], urdu: boolean) => {
  if (items.length <= 2) return items.join("; ");
  const more = items.length - 2;
  return `${items.slice(0, 2).join("; ")} ${urdu ? `اور ${more} مزید` : `and ${more} more`}`;
};

export type ReplyInput = { urdu: boolean; modelText: string; done: string[]; waiting: string[]; errors: string[]; skipped?: number; dropped?: number };

export function composeReply(o: ReplyInput): string {
  const { urdu } = o;
  const parts: string[] = [];
  if (o.done.length) parts.push(urdu ? `ہو گیا: ${summarise(o.done, true)}۔` : `Done: ${summarise(o.done, false)}.`);
  if (o.waiting.length) parts.push(urdu ? `${summarise(o.waiting, true)}۔ تصدیق کے لیے “ہاں” کہیں، چھوڑنے کے لیے “نہیں”۔` : `${summarise(o.waiting, false)}. Say yes to confirm, or no to skip.`);
  if (o.errors.length) parts.push(urdu ? `یہ نہیں ہو سکا: ${o.errors[0]}` : `Could not do: ${o.errors[0]}`);
  if (o.dropped && o.dropped > 0) parts.push(urdu ? `${o.dropped} مزید کام چھوڑ دیے گئے، دوبارہ کہیں۔` : `${o.dropped} more were left out; ask again for those.`);
  if (o.skipped) parts.push(urdu ? "ٹھیک ہے، چھوڑ دیا۔" : "Okay, skipped.");
  if (parts.length) return parts.join(" ");
  return o.modelText.trim();   // a plain answer or a question: the model's own words
}
