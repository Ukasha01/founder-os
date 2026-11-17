import { z } from "zod";

// The ONLY things the assistant can ask for. Anything else the model invents is rejected.
// Every tool is a write, so every call is shown as a preview and runs only after you approve it.
// There is deliberately no delete tool.

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.").refine((s) => !Number.isNaN(Date.parse(s + "T00:00:00Z")), "Not a real date.");
const uuid = z.string().uuid();
const priority = z.enum(["critical", "high", "normal", "low"]);

export const TOOL_SCHEMAS = {
  create_task: z.object({
    title: z.string().trim().min(1).max(500),
    workspace: z.string().trim().max(100).optional(),
    parent_task_id: uuid.optional(),
    priority: priority.optional(),
    deadline: date.optional(),
  }),
  complete_task: z.object({ task_id: uuid }),
  reschedule_task: z.object({ task_id: uuid, new_deadline: date, reason: z.string().trim().max(500).optional() }),
  log_time: z.object({ task_id: uuid, minutes: z.number().int().min(1).max(1440), note: z.string().trim().max(500).optional() }),
  add_to_inbox: z.object({ text: z.string().trim().min(1).max(2000), kind: z.enum(["general", "idea", "promise", "reminder"]).optional() }),
} as const;
export type ToolName = keyof typeof TOOL_SCHEMAS;
export const isToolName = (n: string): n is ToolName => Object.prototype.hasOwnProperty.call(TOOL_SCHEMAS, n);

// Declarations sent to Gemini (OpenAPI-style schema subset).
const S = (description: string) => ({ type: "STRING", description });
export const FUNCTION_DECLARATIONS = [
  { name: "create_task", description: "Create a task (or a subtask when parent_task_id is given).", parameters: { type: "OBJECT", properties: {
    title: S("Short task title"), workspace: S("Workspace name, e.g. Wapsi. Omit for a subtask."), parent_task_id: S("Id of the parent task, from the context list"),
    priority: { type: "STRING", enum: ["critical", "high", "normal", "low"] }, deadline: S("YYYY-MM-DD") }, required: ["title"] } },
  { name: "complete_task", description: "Mark an existing task completed.", parameters: { type: "OBJECT", properties: { task_id: S("Task id from the context list") }, required: ["task_id"] } },
  { name: "reschedule_task", description: "Move a task's deadline. The original deadline is kept.", parameters: { type: "OBJECT", properties: {
    task_id: S("Task id from the context list"), new_deadline: S("YYYY-MM-DD"), reason: S("Why it moved") }, required: ["task_id", "new_deadline"] } },
  { name: "log_time", description: "Record minutes already worked on a task.", parameters: { type: "OBJECT", properties: {
    task_id: S("Task id from the context list"), minutes: { type: "INTEGER" }, note: S("Optional note") }, required: ["task_id", "minutes"] } },
  { name: "add_to_inbox", description: "Save an unsorted note, idea, promise or reminder to the Inbox when it is unclear what it should become. Commitments to a person are saved this way and sorted by the user.", parameters: { type: "OBJECT", properties: { text: S("The note"), kind: { type: "STRING", enum: ["general", "idea", "promise", "reminder"] } }, required: ["text"] } },
];

export type Workspace = { id: string; name: string };
// Matches a spoken workspace name to exactly one real workspace. Ambiguous or unknown names fail loudly.
export function resolveWorkspace(name: string | undefined, list: Workspace[]): { id: string; name: string } | { error: string } {
  if (!name) return { error: "No workspace given." };
  const n = name.trim().toLowerCase();
  const exact = list.filter((w) => w.name.toLowerCase() === n);
  if (exact.length === 1) return exact[0];
  const part = list.filter((w) => w.name.toLowerCase().includes(n) || n.includes(w.name.toLowerCase()));
  if (part.length === 1) return part[0];
  return { error: part.length ? `"${name}" matches more than one workspace.` : `No workspace called "${name}".` };
}

export function previewText(tool: ToolName, input: Record<string, unknown>, taskTitle?: string, wsName?: string): string {
  const t = taskTitle ? `“${taskTitle}”` : "the task";
  switch (tool) {
    case "create_task": return `Create task “${input.title}”${wsName ? ` in ${wsName}` : ""}${input.priority ? `, ${input.priority} priority` : ""}${input.deadline ? `, due ${input.deadline}` : ""}`;
    case "complete_task": return `Mark ${t} completed`;
    case "reschedule_task": return `Move ${t} to ${input.new_deadline}${input.reason ? ` (${input.reason})` : ""}`;
    case "log_time": return `Log ${input.minutes} min on ${t}`;
    case "add_to_inbox": return `Add to Inbox: “${input.text}”`;
  }
}

export const SYSTEM_PROMPT = `You are the executive assistant inside Founder OS, a private planner used by one person (Ukasha, a student and founder in Karachi).
The user may write English, Urdu, or Roman Urdu. Reply briefly in the language they used.
You can only act by calling the provided functions. Calling one only PROPOSES an action; the user reviews and approves it, so never claim it is already done.
Use task ids exactly as listed in the context. Never invent an id; if the task is not listed, ask the user which one they mean, or use add_to_inbox.
Resolve relative dates ("tomorrow", "Friday") using TODAY from the context. Dates are YYYY-MM-DD.
If the request is unclear, ask one short question instead of guessing. You cannot delete anything.`;
