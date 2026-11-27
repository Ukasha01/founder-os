// Shared UI classes and label maps. One place to change the look of every screen.
export const input =
  "rounded-[10px] border border-line-strong bg-field px-3 py-2 text-[15px] text-ink placeholder:text-muted outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/25";
export const btn =
  "inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-line-strong bg-white/[.04] px-3.5 py-2 text-sm font-medium text-ink transition hover:bg-tint active:scale-[.98] disabled:opacity-50";
export const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 rounded-[10px] bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition hover:brightness-110 active:scale-[.98] disabled:opacity-60";
export const card = "rounded-2xl border border-line bg-surface p-4 shadow-card";

// Workspace identity: every screen shows a workspace with its own hue.
export type WsStyle = { dot: string; tint: string; ink: string; edge: string; label: string };
const WS: Record<string, WsStyle> = {
  blue:   { dot: "bg-ws-blue",   tint: "bg-ws-blue-tint",   ink: "text-ws-blue-ink",   edge: "border-l-ws-blue",   label: "blue" },
  orange: { dot: "bg-ws-orange", tint: "bg-ws-orange-tint", ink: "text-ws-orange-ink", edge: "border-l-ws-orange", label: "orange" },
  pink:   { dot: "bg-ws-pink",   tint: "bg-ws-pink-tint",   ink: "text-ws-pink-ink",   edge: "border-l-ws-pink",   label: "pink" },
  violet: { dot: "bg-ws-violet", tint: "bg-ws-violet-tint", ink: "text-ws-violet-ink", edge: "border-l-ws-violet", label: "violet" },
  green:  { dot: "bg-ws-green",  tint: "bg-ws-green-tint",  ink: "text-ws-green-ink",  edge: "border-l-ws-green",  label: "green" },
  teal:   { dot: "bg-ws-teal",   tint: "bg-ws-teal-tint",   ink: "text-ws-teal-ink",   edge: "border-l-ws-teal",   label: "teal" },
};
const WS_FALLBACK: WsStyle = { dot: "bg-ws-slate", tint: "bg-ws-slate-tint", ink: "text-ws-slate-ink", edge: "border-l-ws-slate", label: "slate" };
export const wsStyle = (color: string | null | undefined): WsStyle => (color && WS[color]) || WS_FALLBACK;

// Status and priority badges.
export const STATUS_STYLE: Record<string, string> = {
  not_started: "bg-neutral-100 text-neutral-600",
  in_progress: "bg-sky-100 text-sky-800",
  waiting: "bg-amber-100 text-amber-800",
  completed: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-neutral-100 text-neutral-400 line-through",
};
export const PRIORITY_STYLE: Record<string, string> = {
  critical: "bg-rose-100 text-rose-800",
  high: "bg-orange-100 text-orange-800",
  normal: "bg-neutral-100 text-neutral-600",
  low: "bg-neutral-50 text-neutral-400",
};
export const badge = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium";

export const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  waiting: "Waiting",
  completed: "Completed",
  cancelled: "Cancelled",
};
export const PRIORITY_LABEL: Record<string, string> = {
  critical: "Critical",
  high: "High",
  normal: "Normal",
  low: "Low",
};
export const CAPTURE_TYPES: { value: string; label: string }[] = [
  { value: "task", label: "Task" },
  { value: "subtask", label: "Subtask" },
  { value: "idea", label: "Idea" },
  { value: "meeting", label: "Meeting" },
  { value: "promise", label: "Promise" },
  { value: "commitment", label: "Commitment" },
  { value: "follow_up", label: "Follow-up" },
  { value: "reminder", label: "Reminder" },
  { value: "note", label: "Note" },
  { value: "expense", label: "Expense" },
  { value: "general", label: "General information" },
];

export function formatMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h}h${r ? ` ${r}m` : ""}` : `${r}m`;
}
