import { z } from "zod";

// Everything the assistant can do. READ tools run at once and feed real data back to the model.
// WRITE tools only ever PROPOSE: they are validated, shown as a preview, and run on approval
// (or automatically if you switch on auto-approve; deleting always asks).
// Anything the model invents outside this list is refused.

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.").refine((s) => !Number.isNaN(Date.parse(s + "T00:00:00Z")), "Not a real date.");
const ldt = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use YYYY-MM-DDTHH:mm in the user's local time.");
const uuid = z.string().uuid();
const priority = z.enum(["critical", "high", "normal", "low"]);
const txt = (n: number) => z.string().trim().min(1).max(n);
const opt = (n: number) => z.string().trim().max(n).optional();

type P = { t: "STRING" | "INTEGER" | "NUMBER" | "BOOLEAN" | "ARRAY"; d: string; e?: readonly string[] };
const s = (d: string): P => ({ t: "STRING", d });
const i = (d: string): P => ({ t: "INTEGER", d });
const n = (d: string): P => ({ t: "NUMBER", d });
const b = (d: string): P => ({ t: "BOOLEAN", d });
const e = (vals: readonly string[], d = ""): P => ({ t: "STRING", d, e: vals });
const arr = (d: string): P => ({ t: "ARRAY", d });

export type Spec = { kind: "read" | "write"; confirm?: boolean; desc: string; schema: z.ZodTypeAny; params: Record<string, P>; required?: string[] };
const D = "YYYY-MM-DD";
const L = "Local date-time YYYY-MM-DDTHH:mm";
const TS = ["not_started", "in_progress", "waiting", "completed", "cancelled"] as const;

export const TOOLS = {
  // ---------- read (run immediately) ----------
  get_overview: { kind: "read", desc: "Today's agenda in one call: overdue and due-today tasks, meetings in the next 36 hours, commitments due, habits for today, inbox count, today's score.", schema: z.object({}), params: {} },
  list_tasks: { kind: "read", desc: "Find tasks. Use this to get task ids before changing a task.", schema: z.object({
    status: z.enum(["open", "completed", "all"]).optional(), due: z.enum(["today", "overdue", "week", "none", "any"]).optional(), workspace: opt(100), search: opt(200) }),
    params: { status: e(["open", "completed", "all"], "default open"), due: e(["today", "overdue", "week", "none", "any"], "default any"), workspace: s("Workspace name"), search: s("Words in the title") } },
  get_performance: { kind: "read", desc: "Performance report from real data: daily score and breakdown, tasks completed, hours worked, habits, and how many of the user's assistant requests were carried out.", schema: z.object({ period: z.enum(["today", "yesterday", "week", "month"]) }),
    params: { period: e(["today", "yesterday", "week", "month"]) }, required: ["period"] },
  list_habits: { kind: "read", desc: "Habits with today's status, current streak and 30-day consistency.", schema: z.object({}), params: {} },
  list_goals: { kind: "read", desc: "Goals with their milestones and progress.", schema: z.object({}), params: {} },
  list_kpis: { kind: "read", desc: "KPIs with target and latest recorded value.", schema: z.object({}), params: {} },
  list_meetings: { kind: "read", desc: "Meetings in a range.", schema: z.object({ range: z.enum(["today", "week", "upcoming", "past"]).optional() }), params: { range: e(["today", "week", "upcoming", "past"], "default upcoming") } },
  list_commitments: { kind: "read", desc: "Open commitments, in both directions, with people.", schema: z.object({}), params: {} },
  list_people: { kind: "read", desc: "People in the address book.", schema: z.object({ search: opt(100) }), params: { search: s("Name contains") } },

  list_inbox: { kind: "read", desc: "The unsorted Inbox: every note, idea, promise or reminder waiting to be sorted, with its full text.", schema: z.object({}), params: {} },
  list_events: { kind: "read", desc: "Calendar events (classes, time blocks, appointments, deadlines, prayers, recurring activities) in a range.", schema: z.object({ range: z.enum(["today", "tomorrow", "week", "upcoming", "past"]).optional() }), params: { range: e(["today", "tomorrow", "week", "upcoming", "past"], "default today") } },
  list_time_entries: { kind: "read", desc: "Time logged on tasks: minutes per entry and total, for a period.", schema: z.object({ period: z.enum(["today", "yesterday", "week", "month"]).optional() }), params: { period: e(["today", "yesterday", "week", "month"], "default today") } },
  get_task: { kind: "read", desc: "Everything about ONE task: notes, subtasks, comments, time logged and recent history. Needs the task id (use list_tasks or search first).", schema: z.object({ task_id: uuid }), params: { task_id: s("Task id") }, required: ["task_id"] },
  list_reviews: { kind: "read", desc: "Recent daily reviews: score, wins, blockers and tomorrow's plan.", schema: z.object({ days: z.number().int().min(1).max(30).optional() }), params: { days: i("How many recent days, default 7") } },
  list_recurring: { kind: "read", desc: "Recurring task and event rules (daily, weekly, monthly) and whether they are paused.", schema: z.object({}), params: {} },
  search: { kind: "read", desc: "Find anything by words: searches task titles and notes, goals, people, meetings, inbox notes and commitments at once. Use when you do not know which kind of item it is.", schema: z.object({ text: txt(100) }), params: { text: s("Words to look for") }, required: ["text"] },

  // ---------- tasks ----------
  create_task: { kind: "write", desc: "Create a task, or a subtask when parent_task_id is given.", schema: z.object({ title: txt(500), workspace: opt(100), parent_task_id: uuid.optional(), priority: priority.optional(), deadline: date.optional(), due_time: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:mm.").optional(), estimated_minutes: z.number().int().min(1).max(100000).optional() }),
    params: { title: s("Short task title"), workspace: s("Workspace name; omit for a subtask"), parent_task_id: s("Parent task id"), priority: e(["critical", "high", "normal", "low"]), deadline: s(D), due_time: s("Time of day HH:mm (24h, local) when the task is due; the app announces it then"), estimated_minutes: i("Estimated minutes") }, required: ["title"] },
  update_task: { kind: "write", desc: "Change a task's title, status, priority or estimate.", schema: z.object({ task_id: uuid, title: txt(500).optional(), status: z.enum(TS).optional(), priority: priority.optional(), estimated_minutes: z.number().int().min(1).max(100000).optional() })
    .refine((v) => v.title || v.status || v.priority || v.estimated_minutes, "Nothing to change."),
    params: { task_id: s("Task id"), title: s("New title"), status: e(TS), priority: e(["critical", "high", "normal", "low"]), estimated_minutes: i("Estimated minutes") }, required: ["task_id"] },
  complete_task: { kind: "write", desc: "Mark a task completed.", schema: z.object({ task_id: uuid }), params: { task_id: s("Task id") }, required: ["task_id"] },
  reschedule_task: { kind: "write", desc: "Move a task's deadline. The original deadline is kept.", schema: z.object({ task_id: uuid, new_deadline: date, reason: opt(500) }),
    params: { task_id: s("Task id"), new_deadline: s(D), reason: s("Why it moved") }, required: ["task_id", "new_deadline"] },
  move_task: { kind: "write", desc: "Move a task (with its subtasks) to another workspace.", schema: z.object({ task_id: uuid, workspace: txt(100) }), params: { task_id: s("Task id"), workspace: s("Target workspace name") }, required: ["task_id", "workspace"] },
  delete_task: { kind: "write", confirm: true, desc: "Delete a task and its subtasks. Always needs the user's confirmation.", schema: z.object({ task_id: uuid }), params: { task_id: s("Task id") }, required: ["task_id"] },
  bulk_tasks: { kind: "write", confirm: true, desc: "Delete, complete or cancel MANY tasks at once that match a title (optionally in one workspace). Use this once instead of many single-task calls. The user sees the count first and must confirm.",
    schema: z.object({ action: z.enum(["delete", "complete", "cancel"]), title_equals: opt(300), title_contains: opt(300), workspace: opt(100) }).refine((v) => v.title_equals || v.title_contains, "Give the title to match."),
    params: { action: e(["delete", "complete", "cancel"]), title_equals: s("Exact title, any capitals"), title_contains: s("Part of the title"), workspace: s("Workspace name, optional") }, required: ["action"] },
  undo_last_delete: { kind: "write", desc: "Bring back the tasks the assistant deleted most recently (works for 7 days). Use when the user says undo, wapas, restore or that a deletion was a mistake.", schema: z.object({}), params: {} },
  log_time: { kind: "write", desc: "Record minutes already worked on a task.", schema: z.object({ task_id: uuid, minutes: z.number().int().min(1).max(1440), note: opt(500) }),
    params: { task_id: s("Task id"), minutes: i("Minutes worked"), note: s("Note") }, required: ["task_id", "minutes"] },

  // ---------- goals ----------
  create_goal: { kind: "write", desc: "Create a goal.", schema: z.object({ name: txt(300), workspace: txt(100), target_date: date.optional(), success_criteria: opt(2000), description: opt(2000) }),
    params: { name: s("Goal"), workspace: s("Workspace name"), target_date: s(D), success_criteria: s("How success is judged"), description: s("Details") }, required: ["name", "workspace"] },
  add_milestone: { kind: "write", desc: "Add a measurable milestone to a goal (numeric target or a written measure).", schema: z.object({ goal_id: uuid, title: txt(300), target_value: z.number().positive().optional(), unit: opt(50), measure_description: opt(500), due_date: date.optional() })
    .refine((v) => v.target_value !== undefined || v.measure_description, "Give a numeric target or say how it is measured."),
    params: { goal_id: s("Goal id from list_goals"), title: s("Milestone"), target_value: n("Target number"), unit: s("Unit"), measure_description: s("How it is measured"), due_date: s(D) }, required: ["goal_id", "title"] },
  update_milestone: { kind: "write", desc: "Record progress on a milestone.", schema: z.object({ milestone_id: uuid, current_value: z.number().min(0).optional(), status: z.enum(["pending", "in_progress", "achieved", "missed", "cancelled"]).optional() })
    .refine((v) => v.current_value !== undefined || v.status, "Nothing to change."),
    params: { milestone_id: s("Milestone id from list_goals"), current_value: n("Current value"), status: e(["pending", "in_progress", "achieved", "missed", "cancelled"]) }, required: ["milestone_id"] },
  set_goal_status: { kind: "write", desc: "Change a goal's status.", schema: z.object({ goal_id: uuid, status: z.enum(["not_started", "active", "achieved", "paused", "abandoned"]) }),
    params: { goal_id: s("Goal id"), status: e(["not_started", "active", "achieved", "paused", "abandoned"]) }, required: ["goal_id", "status"] },

  // ---------- habits and KPIs ----------
  create_habit: { kind: "write", desc: "Create a habit.", schema: z.object({ name: txt(200), frequency: z.enum(["daily", "weekdays", "weekly_target"]).optional(), weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(), weekly_target: z.number().int().min(1).max(7).optional(), unit: opt(50) })
    .refine((v) => v.frequency !== "weekdays" || (v.weekdays && v.weekdays.length > 0), "Say which weekdays.").refine((v) => v.frequency !== "weekly_target" || v.weekly_target, "Say how many times per week."),
    params: { name: s("Habit"), frequency: e(["daily", "weekdays", "weekly_target"], "default daily"), weekdays: arr("Days 0=Sunday..6=Saturday, for frequency weekdays"), weekly_target: i("Times per week"), unit: s("Unit, e.g. minutes") }, required: ["name"] },
  log_habit: { kind: "write", desc: "Record a habit for a day (default today).", schema: z.object({ habit_id: uuid, date: date.optional(), status: z.enum(["done", "partial", "skipped", "clear"]) }),
    params: { habit_id: s("Habit id from list_habits"), date: s(D), status: e(["done", "partial", "skipped", "clear"]) }, required: ["habit_id", "status"] },
  create_kpi: { kind: "write", desc: "Create a KPI to track.", schema: z.object({ name: txt(200), workspace: txt(100), unit: opt(50), target_value: z.number().optional(), direction: z.enum(["higher_is_better", "lower_is_better"]).optional(), period: z.enum(["day", "week", "month", "quarter", "year"]).optional(), aggregation: z.enum(["sum", "latest", "average"]).optional() }),
    params: { name: s("KPI"), workspace: s("Workspace name"), unit: s("Unit"), target_value: n("Target per period"), direction: e(["higher_is_better", "lower_is_better"]), period: e(["day", "week", "month", "quarter", "year"], "default week"), aggregation: e(["sum", "latest", "average"]) }, required: ["name", "workspace"] },
  record_kpi: { kind: "write", desc: "Record a KPI value for a period. Entering the same period again replaces it.", schema: z.object({ kpi_id: uuid, period_start: date, period_end: date, actual_value: z.number().finite(), note: opt(500) }),
    params: { kpi_id: s("KPI id from list_kpis"), period_start: s(D), period_end: s(D), actual_value: n("Value"), note: s("Note") }, required: ["kpi_id", "period_start", "period_end", "actual_value"] },

  // ---------- people, meetings, commitments ----------
  create_person: { kind: "write", desc: "Add a person to the address book.", schema: z.object({ name: txt(200), organization: opt(200), position: opt(200), email: opt(200), phone: opt(60), notes: opt(2000) }),
    params: { name: s("Name"), organization: s("Organisation"), position: s("Role"), email: s("Email"), phone: s("Phone"), notes: s("Notes") }, required: ["name"] },
  create_meeting: { kind: "write", desc: "Schedule a meeting (it also appears on the calendar).", schema: z.object({ title: txt(300), starts_at: ldt, ends_at: ldt.optional(), location: opt(300), agenda: opt(5000), workspace: opt(100) }),
    params: { title: s("Meeting"), starts_at: s(L), ends_at: s(L), location: s("Location"), agenda: s("Agenda"), workspace: s("Workspace name") }, required: ["title", "starts_at"] },
  update_meeting: { kind: "write", desc: "Add notes or decisions to a meeting, or change its status.", schema: z.object({ meeting_id: uuid, notes: opt(10000), decisions: opt(10000), status: z.enum(["scheduled", "held", "cancelled"]).optional() })
    .refine((v) => v.notes || v.decisions || v.status, "Nothing to change."),
    params: { meeting_id: s("Meeting id from list_meetings"), notes: s("Notes"), decisions: s("Decisions"), status: e(["scheduled", "held", "cancelled"]) }, required: ["meeting_id"] },
  create_commitment: { kind: "write", desc: "Record a promise between the user and a person who is already in the address book.", schema: z.object({ description: txt(1000), person: txt(200), direction: z.enum(["by_me", "to_me"]), due_date: date.optional(), follow_up_date: date.optional() }),
    params: { description: s("What was promised"), person: s("Person's name"), direction: e(["by_me", "to_me"], "by_me = the user promised them; to_me = they promised the user"), due_date: s(D), follow_up_date: s(D) }, required: ["description", "person", "direction"] },
  complete_commitment: { kind: "write", desc: "Mark a commitment completed.", schema: z.object({ commitment_id: uuid }), params: { commitment_id: s("Commitment id from list_commitments") }, required: ["commitment_id"] },

  // ---------- everything else you can do by hand in the app ----------
  update_commitment: { kind: "write", desc: "Change a commitment: mark it pending, in progress, completed or cancelled, and/or move its due date or follow-up date.",
    schema: z.object({ commitment_id: uuid, status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(), due_date: date.optional(), follow_up_date: date.optional() }).refine((v) => v.status || v.due_date || v.follow_up_date, "Nothing to change."),
    params: { commitment_id: s("Commitment id from list_commitments"), status: e(["pending", "in_progress", "completed", "cancelled"]), due_date: s(D), follow_up_date: s(D) }, required: ["commitment_id"] },
  delete_item: { kind: "write", confirm: true, desc: "Delete one commitment, calendar event, meeting, goal, person, inbox note or recurring rule. Always needs the user's confirmation.",
    schema: z.object({ kind: z.enum(["commitment", "event", "meeting", "goal", "person", "inbox_item", "recurring_rule"]), id: uuid }),
    params: { kind: e(["commitment", "event", "meeting", "goal", "person", "inbox_item", "recurring_rule"]), id: s("Id of the item, from the matching list tool") }, required: ["kind", "id"] },
  archive_item: { kind: "write", confirm: true, desc: "Archive a habit, KPI, workspace or inbox note (hides it; nothing is destroyed).",
    schema: z.object({ kind: z.enum(["habit", "kpi", "workspace", "inbox_item"]), id: uuid }),
    params: { kind: e(["habit", "kpi", "workspace", "inbox_item"]), id: s("Id of the item") }, required: ["kind", "id"] },
  pause_recurring: { kind: "write", desc: "Pause or resume a recurring task rule.", schema: z.object({ rule_id: uuid, paused: z.boolean() }),
    params: { rule_id: s("Rule id from list_recurring"), paused: b("true to pause, false to resume") }, required: ["rule_id", "paused"] },
  start_timer: { kind: "write", desc: "Start the work timer on a task (or on a workspace if no task).", schema: z.object({ task_id: uuid.optional(), workspace: opt(100) }).refine((v) => v.task_id || v.workspace, "Give a task or a workspace."),
    params: { task_id: s("Task id"), workspace: s("Workspace name, if no task") } },
  stop_timer: { kind: "write", desc: "Stop the running work timer.", schema: z.object({}), params: {} },
  manage_workspace: { kind: "write", desc: "Create a workspace, or rename one.", schema: z.object({ action: z.enum(["create", "rename"]), name: txt(100), workspace: opt(100) }).refine((v) => v.action === "create" || v.workspace, "Say which workspace to rename."),
    params: { action: e(["create", "rename"]), name: s("New name"), workspace: s("Existing workspace name (for rename)") }, required: ["action", "name"] },
  meeting_attendee: { kind: "write", desc: "Add a person to a meeting, or remove them.", schema: z.object({ meeting_id: uuid, person: txt(200), action: z.enum(["add", "remove"]) }),
    params: { meeting_id: s("Meeting id from list_meetings"), person: s("Person's name"), action: e(["add", "remove"]) }, required: ["meeting_id", "person", "action"] },

  // ---------- calendar, recurring, review, inbox ----------
  set_reminder: { kind: "write", desc: "Set a reminder that notifies him (phone and laptop) at an exact date and time. Use for any 'remind me at/tomorrow/in ...' request.", schema: z.object({ title: txt(300), at: ldt }),
    params: { title: s("What to remind him about"), at: s(L) }, required: ["title", "at"] },
  create_event: { kind: "write", desc: "Add a calendar event.", schema: z.object({ title: txt(300), start: ldt, end: ldt.optional(), event_type: z.enum(["meeting", "class", "appointment", "time_block", "other"]).optional(), workspace: opt(100) }),
    params: { title: s("Event"), start: s(L), end: s(L), event_type: e(["meeting", "class", "appointment", "time_block", "other"]), workspace: s("Workspace name") }, required: ["title", "start"] },
  create_recurring_task: { kind: "write", desc: "Create a task that repeats (tasks are generated automatically).", schema: z.object({ title: txt(300), workspace: txt(100), freq: z.enum(["daily", "weekly", "monthly"]), interval: z.number().int().min(1).max(365).optional(), weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(), monthday: z.number().int().min(1).max(31).optional(), start_date: date.optional(), priority: priority.optional(), estimated_minutes: z.number().int().min(1).max(100000).optional() })
    .refine((v) => v.freq !== "weekly" || (v.weekdays && v.weekdays.length > 0), "Say which weekdays.").refine((v) => v.freq !== "monthly" || v.monthday, "Say which day of the month."),
    params: { title: s("Task"), workspace: s("Workspace name"), freq: e(["daily", "weekly", "monthly"]), interval: i("Every N (default 1)"), weekdays: arr("Days 0=Sunday..6=Saturday, for weekly"), monthday: i("Day of month, for monthly"), start_date: s(D), priority: e(["critical", "high", "normal", "low"]), estimated_minutes: i("Minutes") }, required: ["title", "workspace", "freq"] },
  save_daily_review: { kind: "write", desc: "Write the daily review (wins, blockers, plan for tomorrow) and optionally mark it complete, which locks in the day's score.", schema: z.object({ date: date.optional(), wins: opt(5000), blockers: opt(5000), tomorrow_plan: opt(5000), complete: z.boolean().optional() })
    .refine((v) => v.wins || v.blockers || v.tomorrow_plan || v.complete, "Nothing to save."),
    params: { date: s(D + ", default today"), wins: s("What went well"), blockers: s("What got in the way"), tomorrow_plan: s("Plan for tomorrow"), complete: b("Mark the review complete") } },
  add_to_inbox: { kind: "write", desc: "Save an unsorted note, idea, promise or reminder to the Inbox when it is unclear what it should become.", schema: z.object({ text: txt(2000), kind: z.enum(["general", "idea", "promise", "reminder"]).optional() }),
    params: { text: s("The note"), kind: e(["general", "idea", "promise", "reminder"]) }, required: ["text"] },
} satisfies Record<string, Spec>;

export type ToolName = keyof typeof TOOLS;
export const isToolName = (name: string): name is ToolName => Object.prototype.hasOwnProperty.call(TOOLS, name);
export const isRead = (name: ToolName) => TOOLS[name].kind === "read";
export const needsConfirmation = (name: ToolName) => !!(TOOLS[name] as Spec).confirm;
// Kept for older callers and tests.
export const TOOL_SCHEMAS = Object.fromEntries(Object.entries(TOOLS).map(([k, v]) => [k, v.schema])) as { [K in ToolName]: (typeof TOOLS)[K]["schema"] };

export const FUNCTION_DECLARATIONS = (Object.entries(TOOLS) as [ToolName, Spec][]).map(([name, t]) => ({
  name, description: t.desc,
  parameters: { type: "OBJECT", properties: Object.fromEntries(Object.entries(t.params).map(([k, p]) => [k,
    { type: p.t, description: p.d || undefined, ...(p.e ? { enum: [...p.e] } : {}), ...(p.t === "ARRAY" ? { items: { type: "INTEGER" } } : {}) }])), ...(t.required ? { required: t.required } : {}) },
}));

// Token-limited providers get only the tools that fit the request: every read tool, a few common write tools, and the
// write tools whose topic the message mentions (English, Roman Urdu or Urdu script). Providers with large limits get all.
const CORE_WRITE = ["create_task", "update_task", "complete_task", "reschedule_task", "add_to_inbox", "delete_task", "bulk_tasks", "undo_last_delete", "delete_item", "update_commitment", "set_reminder"];
const GROUPS: [RegExp, string[]][] = [
  [/\b(log|logged|worked|work|minutes?|mins?|hours?|ghant[ae]|time)\b|گھنٹ|منٹ|کام کیا|وقت/i, ["log_time"]],
  [/goal|milestone|target|objective|مقصد|ہدف|گول/i, ["create_goal", "add_milestone", "update_milestone", "set_goal_status"]],
  [/habit|namaz|salah|prayer|quran|exercise|workout|gym|run|streak|عادت|نماز|قرآن|ورزش|جم/i, ["create_habit", "log_habit"]],
  [/kpi|sales|revenue|orders?|metric|users?|signups?|سیل|آرڈر|بکری/i, ["create_kpi", "record_kpi"]],
  [/person|people|contact|promise|promised|commit|وعدہ|وعدے|بندہ|شخص/i, ["create_person", "create_commitment", "complete_commitment", "update_commitment", "meeting_attendee"]],
  [/meeting|call|zoom|میٹنگ|ملاقات|کال/i, ["create_meeting", "update_meeting"]],
  [/event|class|lecture|schedule|calendar|every|daily|weekly|monthly|recurring|roz|har\b|کلاس|ہر |روز|ہفتے|شیڈیول/i, ["create_event", "create_recurring_task"]],
  [/timer|stopwatch|ٹائمر/i, ["start_timer", "stop_timer"]],
  [/pause|resume|recurring|repeat|روک|دوبارہ شروع/i, ["pause_recurring"]],
  [/workspace|rename|ورک ?اسپیس|نام/i, ["manage_workspace", "archive_item"]],
  [/archive|hide|آرکائیو|چھپا/i, ["archive_item"]],
  [/attendee|invite|add .* to .*meeting|شامل/i, ["meeting_attendee"]],
  [/review|wins?|blockers?|reflect|ریویو|جائزہ/i, ["save_daily_review"]],
  [/\bmove\b|workspace|shift|منتقل/i, ["move_task"]],
];
export function routeTools(userText: string): string[] {
  const reads = (Object.keys(TOOLS) as ToolName[]).filter((n) => TOOLS[n].kind === "read");
  const writes = new Set<string>(CORE_WRITE);
  for (const [re, names] of GROUPS) if (re.test(userText)) for (const n of names) writes.add(n);
  return [...reads, ...writes];
}

export type Workspace = { id: string; name: string };
// Matches a spoken name to exactly one real item. Ambiguous or unknown names fail loudly.
export function resolveByName<T extends { id: string; name: string }>(name: string | undefined, list: T[], what = "workspace"): T | { error: string } {
  if (!name) return { error: `No ${what} given.` };
  const q = name.trim().toLowerCase();
  const exact = list.filter((w) => w.name.toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  const part = list.filter((w) => w.name.toLowerCase().includes(q) || q.includes(w.name.toLowerCase()));
  if (part.length === 1) return part[0];
  return { error: part.length ? `"${name}" matches more than one ${what}: ${part.slice(0, 4).map((p) => p.name).join(", ")}.` : `No ${what} called "${name}".` };
}
export const resolveWorkspace = (name: string | undefined, list: Workspace[]) => resolveByName(name, list, "workspace");

export const SYSTEM_PROMPT = `You are the executive assistant inside Founder OS, the private planner of one person (Ukasha, a student and founder in Karachi). You can run the whole app for him by voice or text.
LANGUAGE: he mixes Urdu and English. Understand Urdu script, Roman Urdu and English, and mixed sentences; spoken input may contain recognition mistakes, so infer the likely meaning and confirm only if it matters.
Reply in the language he used. If he wrote or spoke Urdu or Roman Urdu, reply in natural, simple, spoken Pakistani Urdu written in Urdu script (not Hindi words, not stiff or bookish Urdu). Keep task names, app words and technical terms in English letters, as he says them. Write numbers as digits.
REMINDERS: "remind me at/tomorrow/in ..." means call set_reminder with the exact local date and time (compute it from NOW); a task alone does not notify him. Add a task as well only if he asked for one.
If INPUT MODE is voice, your reply is read aloud: at most two or three short sentences, no lists, no markdown, no emojis, no ids. If he only said a short command like stop, thanks or okay, answer in a few words.
FACTS: the context below already lists his open tasks, today's schedule and Inbox. If the answer is there, answer at once without calling a tool. For anything else about his data (details, history, performance, other lists, search), call the read tools first, in ONE turn together when you need several. Never guess numbers or ids. Quote the figures the tools return.
ACTIONS: write tools only PROPOSE a change; the app shows the user exactly what will happen, asks him to confirm, and tells him when it is done. So call the tool and keep your own text to at most one short line. Never claim something is done. You can do everything the user can do by hand in the app: tasks, goals, habits, KPIs, people, meetings, commitments, calendar events, recurring tasks, timers, workspaces, inbox, reviews, including deleting, archiving and changing status. Never say you cannot do something without first checking your tools; if a tool fits, call it. If a needed tool really is missing, say exactly which action you lack in one short sentence.
MANY TASKS: to delete, complete or cancel several tasks that share a title, call bulk_tasks ONCE (action plus the title and, if he named one, the workspace). Never repeat delete_task for each one. If he says undo, wapas or that a deletion was a mistake, call undo_last_delete.
Use ids exactly as returned by read tools or the context. If the task or item is not found, ask one short question or use add_to_inbox.
Resolve relative dates ("tomorrow", "Friday") from TODAY in the context. Dates are YYYY-MM-DD; date-times are local YYYY-MM-DDTHH:mm.
Make several write calls in one turn when the request has several parts. If something is unclear, ask one short question instead of guessing. Deleting always needs the user's confirmation.
When reporting performance, be honest and specific: what went well, what did not, and one suggestion. Do not praise numbers that are low or missing.`;
