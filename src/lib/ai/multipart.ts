// A message with more than one request needs every part handled, so the assistant takes one more look after its first writes.
export const looksMultiPart = (m: string) => m.length > 60 || /(\band\b|\baur\b|\balso\b|\bthen\b|\bphir\b|\bplus\b|\bwith\b|[,;،؛]|اور|پھر)/i.test(m);
