// Minimal, standards-following iCalendar (RFC 5545) writer. One-way export: import the file into Google Calendar.
export type IcsEvent = { uid: string; title: string; description?: string | null; location?: string | null; start: string; end?: string | null; allDay?: boolean; stampedAt: string };

export const escapeText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// Lines longer than 75 octets are folded: CRLF + one space, never splitting a multi-byte character.
export function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "", bytes = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) { out.push(cur); cur = ""; bytes = 0; limit = 74; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dateOnly = (d: string) => d.replace(/-/g, "");
function nextDay(d: string): string { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); }

export function buildIcs(events: IcsEvent[], calName = "Founder OS"): string {
  const L: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Founder OS//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${escapeText(calName)}`];
  for (const e of events) {
    L.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${utc(e.stampedAt)}`);
    if (e.allDay) { L.push(`DTSTART;VALUE=DATE:${dateOnly(e.start)}`, `DTEND;VALUE=DATE:${dateOnly(e.end ? e.end : nextDay(e.start))}`); }
    else {
      L.push(`DTSTART:${utc(e.start)}`);
      L.push(`DTEND:${utc(e.end && new Date(e.end) > new Date(e.start) ? e.end : new Date(new Date(e.start).getTime() + 30 * 60000).toISOString())}`);
    }
    L.push(`SUMMARY:${escapeText(e.title)}`);
    if (e.description) L.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.location) L.push(`LOCATION:${escapeText(e.location)}`);
    L.push("END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}
