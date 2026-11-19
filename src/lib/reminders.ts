// Pure planning of reminders: what to remind about, with a dedupe key so running the job twice
// (or every five minutes) never creates the same reminder again.
export type Draft = { dedupe_key: string; kind: "custom" | "deadline" | "meeting" | "commitment"; title: string; body: string | null; remind_at: string; task_id?: string; meeting_id?: string; commitment_id?: string; event_id?: string };

export type PlanInput = {
  now: Date; today: string;                       // today = local date in the user's timezone
  dueToday: { id: string; title: string }[];
  overdue: { id: string; title: string; current_deadline: string }[];
  meetingsSoon: { id: string; title: string; starts_at: string }[];
  events?: { id: string; title: string; starts_at: string; location?: string | null }[];   // timed calendar events (not all-day)
  timedTasks?: { id: string; title: string; due_at: string }[];                           // today's tasks that have a due time
  commitments: { id: string; description: string; due_date: string | null; follow_up_date: string | null }[];
};

// The scheduler runs every minute. A timed item is announced once, from one minute before its time until ten minutes
// after (so a missed run or a short outage still delivers it late rather than never). The dedupe key stops repeats.
export const EARLY_MS = 60_000, LATE_MS = 10 * 60_000, MEETING_HEADS_UP_MS = 10 * 60_000;
const inWindow = (now: Date, at: string, early = EARLY_MS, late = LATE_MS) => { const d = new Date(at).getTime() - now.getTime(); return d <= early && d >= -late; };

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function planReminders(i: PlanInput): Draft[] {
  const out: Draft[] = [];
  const at = i.now.toISOString();
  if (i.dueToday.length || i.overdue.length) {
    const parts = [i.dueToday.length ? `${plural(i.dueToday.length, "task")} due today` : "", i.overdue.length ? `${i.overdue.length} overdue` : ""].filter(Boolean);
    out.push({ dedupe_key: `digest:${i.today}`, kind: "deadline", title: parts.join(", "), body: [...i.overdue, ...i.dueToday].slice(0, 3).map((t) => t.title).join(" · ") || null, remind_at: at });
  }
  for (const m of i.meetingsSoon) {
    if (!inWindow(i.now, m.starts_at, MEETING_HEADS_UP_MS, 2 * 60_000)) continue;
    out.push({ dedupe_key: `meeting:${m.id}:${m.starts_at}`, kind: "meeting", title: `Meeting soon: ${m.title}`, body: null, remind_at: at, meeting_id: m.id });
  }
  for (const e of i.events ?? []) {
    if (!inWindow(i.now, e.starts_at)) continue;
    out.push({ dedupe_key: `event:${e.id}:${e.starts_at}`, kind: "custom", title: e.title, body: e.location ?? null, remind_at: at, event_id: e.id });
  }
  for (const t of i.timedTasks ?? []) {
    if (!inWindow(i.now, t.due_at)) continue;
    out.push({ dedupe_key: `task:${t.id}:${t.due_at}`, kind: "deadline", title: `Due now: ${t.title}`, body: null, remind_at: at, task_id: t.id });
  }
  for (const c of i.commitments) {
    const due = c.due_date && c.due_date <= i.today;
    const fu = c.follow_up_date && c.follow_up_date <= i.today;
    if (!due && !fu) continue;
    out.push({ dedupe_key: `commitment:${c.id}:${i.today}`, kind: "commitment", title: due ? `Commitment due: ${c.description}` : `Follow up: ${c.description}`, body: null, remind_at: at, commitment_id: c.id });
  }
  return out;
}

// Retry policy for delivery: three tries, then give up and say why.
export const MAX_ATTEMPTS = 3;
export const nextStatus = (attempts: number, delivered: boolean): "sent" | "pending" | "failed" => delivered ? "sent" : attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending";
