// A message with more than one request needs every part handled, so the assistant takes one more look after its first writes.
export const looksMultiPart = (m: string) => m.length > 60 || /(\band\b|\baur\b|\balso\b|\bthen\b|\bphir\b|\bplus\b|\bwith\b|[,;،؛]|اور|پھر)/i.test(m);

// The model promises an action in words ("I'll create...", "let me set...") instead of calling a tool. Used to catch that.
export const claimsAction = (t: string) => /\b(i['’]?ll|i will|let me|i am (now )?(creating|setting|adding|deleting)|i['’]?m (now )?(creating|setting|adding|deleting)|setting (it )?up|creating (it|them)|i['’]?ve (created|added|set|deleted))\b/i.test(t) && !/\?\s*$/.test(t.trim());
