// Shared UI classes and label maps (keeps screens consistent without a component library yet).
export const input = "rounded-md border border-neutral-300 bg-white px-3 py-2 text-base outline-none focus:border-neutral-900";
export const btn = "rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50";
export const btnPrimary = "rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700";
export const card = "rounded-lg border border-neutral-200 p-3";

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
