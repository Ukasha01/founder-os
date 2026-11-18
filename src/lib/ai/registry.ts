import type { SupabaseClient } from "@supabase/supabase-js";
import { TOOLS, resolveByName, type ToolName, type Workspace } from "./tools.ts";
import { addDays, dateInTz, rangeUtc, zonedToUtc } from "../time.ts";
import { consistency, currentStreak, isScheduled, type Entries, type EntryStatus, type Frequency } from "../habits.ts";
import { loadDay } from "../dayscore.ts";

export type Ctx = { supabase: SupabaseClient; tz: string; today: string; workspaces: Workspace[] };
type Json = Record<string, unknown>;
const OPEN = ["not_started", "in_progress", "waiting"];

// ------------------------------------------------------------------ READ TOOLS
async function habitRows(c: Ctx) {
  const { data: habits } = await c.supabase.from("habits").select("id, name, frequency_type, weekdays, weekly_target, start_date").is("archived_at", null).order("sort_order");
  const { data: ent } = await c.supabase.from("habit_entries").select("habit_id, entry_date, status").gte("entry_date", addDays(c.today, -400)).limit(20000);
  const by = new Map<string, Entries>();
  for (const e of ent ?? []) { if (!by.has(e.habit_id)) by.set(e.habit_id, new Map()); by.get(e.habit_id)!.set(e.entry_date, e.status as EntryStatus); }
  return (habits ?? []).map((h) => ({ h, def: { frequency_type: h.frequency_type as Frequency, weekdays: h.weekdays, weekly_target: h.weekly_target, start_date: h.start_date }, en: by.get(h.id) ?? new Map<string, EntryStatus>() }));
}

async function performance(c: Ctx, period: "today" | "yesterday" | "week" | "month"): Promise<Json> {
  const { supabase, today, tz } = c;
  let from = today, to = today;
  if (period === "yesterday") from = to = addDays(today, -1);
  if (period === "week") { from = addDays(today, -6); }
  if (period === "month") { from = addDays(today, -29); }
  const { start, end } = rangeUtc(from, to, tz);
  const out: Json = { period, from, to };

  // Daily scores (measured per day; "no data" is reported as null, never as zero).
  const days: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  if (period !== "month") {
    const scored = await Promise.all(days.map(async (d) => ({ d, day: await loadDay(supabase, d) })));
    out.daily = scored.map(({ d, day }) => ({ date: d, score: day.result.total }));
    const vals = scored.map((s) => s.day.result.total).filter((v): v is number => v !== null);
    out.average_score = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
    if (days.length === 1) {
      const r = scored[0].day.result;
      out.breakdown = Object.fromEntries(Object.entries(r.categories).map(([k, v]) => [k, v.available ? { points: v.points, of: v.weight, why: v.explanation } : { unavailable: v.explanation }]));
      out.review_done = !!scored[0].day.review?.review_completed_at;
    }
  }

  const [{ data: done }, { data: dueRange }, { data: time }, { data: logs }] = await Promise.all([
    supabase.from("tasks").select("id").is("deleted_at", null).eq("status", "completed").gte("completed_at", start.toISOString()).lt("completed_at", end.toISOString()).limit(2000),
    supabase.from("tasks").select("status, current_deadline").is("deleted_at", null).gte("current_deadline", from).lte("current_deadline", to).limit(2000),
    supabase.from("time_entries").select("duration_minutes").gte("entry_date", from).lte("entry_date", to).limit(5000),
    supabase.from("ai_action_logs").select("tool_name, status, preview, created_at").eq("tool_kind", "write").gte("created_at", start.toISOString()).lt("created_at", end.toISOString()).order("created_at", { ascending: false }).limit(300),
  ]);
  const due = dueRange ?? [];
  out.tasks = {
    completed_in_period: done?.length ?? 0,
    due_in_period: due.length,
    due_and_completed: due.filter((t) => t.status === "completed").length,
    due_and_still_open: due.filter((t) => OPEN.includes(t.status as string)).length,
  };
  out.hours_worked = Math.round(((time ?? []).reduce((s, t) => s + (t.duration_minutes ?? 0), 0) / 60) * 10) / 10;

  const habits = await habitRows(c);
  out.habits = habits.map(({ h, def, en }) => ({ name: h.name, consistency_percent: (() => { const v = consistency(def, en, from, to, today); return v === null ? null : Math.round(v * 100); })(), streak: currentStreak(def, en, today) }));

  const l = logs ?? [];
  const cnt = (s: string) => l.filter((x) => x.status === s).length;
  out.assistant_requests = { proposed: l.length, carried_out: cnt("executed"), skipped_by_user: cnt("rejected"), failed: cnt("failed"), waiting_for_approval: cnt("awaiting_approval"),
    recent_done: l.filter((x) => x.status === "executed").slice(0, 8).map((x) => (x.preview as { text?: string } | null)?.text ?? x.tool_name) };
  return out;
}

export async function runRead(c: Ctx, name: ToolName, args: Json): Promise<Json> {
  const { supabase, today, tz } = c;
  const wsName = new Map(c.workspaces.map((w) => [w.id, w.name]));
  switch (name) {
    case "get_overview": {
      const nowIso = new Date().toISOString(), in36 = new Date(Date.now() + 36 * 3600000).toISOString();
      const [{ data: overdue }, { data: dueToday }, { data: meetings }, { data: commits }, { count: inbox }, day, habits] = await Promise.all([
        supabase.from("task_overview").select("id, title, priority, current_deadline, workspace_id").in("status", OPEN).lt("current_deadline", today).order("current_deadline").limit(15),
        supabase.from("task_overview").select("id, title, priority, workspace_id").in("status", OPEN).eq("current_deadline", today).limit(20),
        supabase.from("meetings").select("id, title, starts_at").is("deleted_at", null).eq("status", "scheduled").gte("starts_at", nowIso).lte("starts_at", in36).order("starts_at").limit(10),
        supabase.from("commitments").select("id, description, due_date, follow_up_date").is("deleted_at", null).in("status", ["pending", "in_progress"]).or(`due_date.lte.${addDays(today, 3)},follow_up_date.lte.${addDays(today, 3)}`).limit(10),
        supabase.from("quick_capture").select("id", { count: "exact", head: true }).eq("status", "inbox"),
        loadDay(supabase, today), habitRows(c),
      ]);
      const mapT = (t: Json) => ({ ...t, workspace: wsName.get(t.workspace_id as string), workspace_id: undefined });
      return { today, overdue: (overdue ?? []).map(mapT), due_today: (dueToday ?? []).map(mapT), meetings_next_36h: meetings, commitments_due_soon: commits, inbox_items: inbox ?? 0, score_today: day.result.total,
        habits_today: habits.filter(({ def }) => def.frequency_type === "weekly_target" || isScheduled(def, today)).map(({ h, en }) => ({ id: h.id, name: h.name, status: en.get(today) ?? "not logged" })) };
    }
    case "list_tasks": {
      const a = TOOLS.list_tasks.schema.parse(args);
      let q = supabase.from("task_overview").select("id, title, status, priority, current_deadline, is_overdue, workspace_id, parent_task_id, child_count, actual_minutes").limit(40);
      const st = a.status ?? "open";
      if (st === "open") q = q.in("status", OPEN); else if (st === "completed") q = q.eq("status", "completed");
      if (a.due === "today") q = q.eq("current_deadline", today);
      else if (a.due === "overdue") q = q.lt("current_deadline", today).in("status", OPEN);
      else if (a.due === "week") q = q.gte("current_deadline", today).lte("current_deadline", addDays(today, 7));
      else if (a.due === "none") q = q.is("current_deadline", null);
      if (a.workspace) { const w = resolveByName(a.workspace, c.workspaces); if ("error" in w) return { error: w.error }; q = q.eq("workspace_id", w.id); }
      if (a.search) q = q.ilike("title", `%${a.search.replace(/[%_]/g, "")}%`);
      const { data, error } = await q.order("current_deadline", { nullsFirst: false });
      if (error) return { error: error.message };
      return { count: data?.length ?? 0, tasks: (data ?? []).map((t) => ({ ...t, workspace: wsName.get(t.workspace_id), workspace_id: undefined })) };
    }
    case "get_performance": return performance(c, TOOLS.get_performance.schema.parse(args).period);
    case "list_habits": {
      const rows = await habitRows(c);
      return { habits: rows.map(({ h, def, en }) => ({ id: h.id, name: h.name, frequency: h.frequency_type, today: en.get(today) ?? "not logged", streak: currentStreak(def, en, today),
        consistency_30d_percent: (() => { const v = consistency(def, en, addDays(today, -29), today, today); return v === null ? null : Math.round(v * 100); })() })) };
    }
    case "list_goals": {
      const [{ data: goals }, { data: ms }] = await Promise.all([
        supabase.from("goals").select("id, name, status, target_date, workspace_id").is("deleted_at", null).order("target_date", { nullsFirst: false }).limit(40),
        supabase.from("milestones").select("id, goal_id, title, target_value, current_value, unit, measure_description, due_date, status").limit(300),
      ]);
      return { goals: (goals ?? []).map((g) => ({ id: g.id, name: g.name, status: g.status, target_date: g.target_date, workspace: wsName.get(g.workspace_id),
        milestones: (ms ?? []).filter((m) => m.goal_id === g.id).map((m) => ({ id: m.id, title: m.title, status: m.status, progress: m.target_value ? `${m.current_value}/${m.target_value} ${m.unit ?? ""}`.trim() : m.measure_description, due_date: m.due_date })) })) };
    }
    case "list_kpis": {
      const [{ data: defs }, { data: ents }] = await Promise.all([
        supabase.from("kpi_definitions").select("id, name, unit, target_value, direction, period, workspace_id").is("archived_at", null).limit(60),
        supabase.from("kpi_entries").select("kpi_id, period_start, period_end, actual_value").order("period_end", { ascending: false }).limit(500),
      ]);
      return { kpis: (defs ?? []).map((k) => { const last = (ents ?? []).find((e) => e.kpi_id === k.id); return { id: k.id, name: k.name, workspace: wsName.get(k.workspace_id), unit: k.unit, target_per_period: k.target_value, period: k.period, direction: k.direction,
        latest: last ? { value: last.actual_value, period: `${last.period_start} to ${last.period_end}` } : "no data yet" }; }) };
    }
    case "list_meetings": {
      const a = TOOLS.list_meetings.schema.parse(args); const range = a.range ?? "upcoming";
      let q = supabase.from("meetings").select("id, title, starts_at, location, status, workspace_id").is("deleted_at", null).limit(30);
      const nowIso = new Date().toISOString();
      if (range === "today") { const r = rangeUtc(today, today, tz); q = q.gte("starts_at", r.start.toISOString()).lt("starts_at", r.end.toISOString()); }
      else if (range === "week") q = q.gte("starts_at", nowIso).lte("starts_at", new Date(Date.now() + 7 * 86400000).toISOString());
      else if (range === "past") q = q.lt("starts_at", nowIso);
      else q = q.gte("starts_at", nowIso);
      const { data } = await q.order("starts_at", { ascending: range !== "past" });
      return { meetings: (data ?? []).map((m) => ({ ...m, local_start: m.starts_at ? `${dateInTz(new Date(m.starts_at), tz)} ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(m.starts_at))}` : null, workspace: wsName.get(m.workspace_id) })) };
    }
    case "list_commitments": {
      const [{ data: cm }, { data: ppl }] = await Promise.all([
        supabase.from("commitments").select("id, description, due_date, follow_up_date, status, made_by_person_id, made_to_person_id").is("deleted_at", null).in("status", ["pending", "in_progress"]).order("due_date", { nullsFirst: false }).limit(40),
        supabase.from("people").select("id, name").is("deleted_at", null).limit(500),
      ]);
      const pn = new Map((ppl ?? []).map((p) => [p.id, p.name]));
      return { commitments: (cm ?? []).map((x) => ({ id: x.id, description: x.description, due_date: x.due_date, follow_up_date: x.follow_up_date, status: x.status,
        direction: x.made_by_person_id ? `${pn.get(x.made_by_person_id)} promised the user` : `the user promised ${pn.get(x.made_to_person_id as string)}` })) };
    }
    case "list_people": {
      const a = TOOLS.list_people.schema.parse(args);
      let q = supabase.from("people").select("id, name, organization, position").is("deleted_at", null).is("archived_at", null).limit(50);
      if (a.search) q = q.ilike("name", `%${a.search.replace(/[%_]/g, "")}%`);
      const { data } = await q.order("name");
      return { people: data ?? [] };
    }
    case "list_inbox": {
      const { data } = await supabase.from("quick_capture").select("id, raw_text, capture_type, source, captured_at").eq("status", "inbox").order("captured_at", { ascending: false }).limit(40);
      return { count: data?.length ?? 0, items: (data ?? []).map((x) => ({ id: x.id, text: x.raw_text, type: x.capture_type, source: x.source, captured: dateInTz(new Date(x.captured_at), tz) })) };
    }
    case "list_events": {
      const a = TOOLS.list_events.schema.parse(args); const range = a.range ?? "today";
      let q = supabase.from("calendar_events").select("id, title, event_type, start_at, end_at, all_day, location, status, is_fixed, workspace_id").is("deleted_at", null).neq("status", "cancelled").limit(60);
      const now = new Date().toISOString();
      if (range === "today" || range === "tomorrow") { const d = range === "today" ? today : addDays(today, 1); const r = rangeUtc(d, d, tz); q = q.gte("start_at", r.start.toISOString()).lt("start_at", r.end.toISOString()); }
      else if (range === "week") { const r = rangeUtc(today, addDays(today, 6), tz); q = q.gte("start_at", r.start.toISOString()).lt("start_at", r.end.toISOString()); }
      else if (range === "past") q = q.lt("start_at", now); else q = q.gte("start_at", now);
      const { data } = await q.order("start_at", { ascending: range !== "past" });
      const hm = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz });
      return { events: (data ?? []).map((x) => ({ id: x.id, title: x.title, type: x.event_type, date: dateInTz(new Date(x.start_at), tz), from: x.all_day ? "all day" : hm.format(new Date(x.start_at)), to: x.end_at && !x.all_day ? hm.format(new Date(x.end_at)) : null, location: x.location, fixed: x.is_fixed, workspace: wsName.get(x.workspace_id) })) };
    }
    case "list_time_entries": {
      const a = TOOLS.list_time_entries.schema.parse(args); const period = a.period ?? "today";
      const from = period === "week" ? addDays(today, -6) : period === "month" ? addDays(today, -29) : period === "yesterday" ? addDays(today, -1) : today;
      const to = period === "yesterday" ? from : today;
      const [{ data }, { data: tk }] = await Promise.all([
        supabase.from("time_entries").select("task_id, workspace_id, entry_date, duration_minutes, note").gte("entry_date", from).lte("entry_date", to).order("entry_date", { ascending: false }).limit(200),
        supabase.from("tasks").select("id, title").is("deleted_at", null).limit(2000),
      ]);
      const tn = new Map((tk ?? []).map((t) => [t.id, t.title]));
      const rows = data ?? [];
      const byWs: Record<string, number> = {};
      for (const r of rows) byWs[wsName.get(r.workspace_id) ?? "?"] = (byWs[wsName.get(r.workspace_id) ?? "?"] ?? 0) + (r.duration_minutes ?? 0);
      return { from, to, total_minutes: rows.reduce((n, r) => n + (r.duration_minutes ?? 0), 0), minutes_by_workspace: byWs,
        entries: rows.slice(0, 40).map((r) => ({ date: r.entry_date, minutes: r.duration_minutes, task: r.task_id ? tn.get(r.task_id) : null, note: r.note })) };
    }
    case "get_task": {
      const a = TOOLS.get_task.schema.parse(args);
      const [{ data: t }, { data: subs }, { data: com }, { data: time }, { data: act }] = await Promise.all([
        supabase.from("tasks").select("id, title, description, notes, status, priority, workspace_id, estimated_minutes, completed_at, created_at").eq("id", a.task_id).is("deleted_at", null).maybeSingle(),
        supabase.from("task_overview").select("id, title, status, current_deadline").eq("parent_task_id", a.task_id).limit(40),
        supabase.from("task_comments").select("body, created_at").eq("task_id", a.task_id).order("created_at", { ascending: false }).limit(10),
        supabase.from("time_entries").select("duration_minutes").eq("task_id", a.task_id).limit(500),
        supabase.from("task_activity").select("action, field, reason, created_at").eq("task_id", a.task_id).order("created_at", { ascending: false }).limit(10),
      ]);
      if (!t) return { error: "No task with that id." };
      const { data: ov } = await supabase.from("task_overview").select("current_deadline, original_deadline").eq("id", a.task_id).maybeSingle();
      return { task: { ...t, workspace: wsName.get(t.workspace_id), workspace_id: undefined, deadline: ov?.current_deadline ?? null, original_deadline: ov?.original_deadline ?? null },
        subtasks: subs ?? [], comments: com ?? [], minutes_logged: (time ?? []).reduce((n, r) => n + (r.duration_minutes ?? 0), 0), recent_history: act ?? [] };
    }
    case "list_reviews": {
      const a = TOOLS.list_reviews.schema.parse(args);
      const { data } = await supabase.from("daily_reviews").select("review_date, score_total, wins, blockers, tomorrow_plan, review_completed_at, actual_minutes").gte("review_date", addDays(today, -(a.days ?? 7))).order("review_date", { ascending: false }).limit(30);
      return { reviews: (data ?? []).map((r) => ({ date: r.review_date, score: r.score_total, completed: !!r.review_completed_at, minutes_worked: r.actual_minutes, wins: r.wins, blockers: r.blockers, tomorrow_plan: r.tomorrow_plan })) };
    }
    case "list_recurring": {
      const { data } = await supabase.from("recurrence_rules").select("id, name, target_kind, freq, interval_count, by_weekday, start_date, end_date, is_paused, workspace_id").order("name").limit(60);
      return { rules: (data ?? []).map((r) => ({ ...r, workspace: wsName.get(r.workspace_id), workspace_id: undefined })) };
    }
    case "search": {
      const a = TOOLS.search.schema.parse(args); const like = `%${a.text.replace(/[%_,()]/g, "")}%`;
      const [tasks, goals, people, meetings, inbox, commits] = await Promise.all([
        supabase.from("task_overview").select("id, title, status, current_deadline, workspace_id").or(`title.ilike.${like}`).limit(10),
        supabase.from("goals").select("id, name, status").is("deleted_at", null).ilike("name", like).limit(5),
        supabase.from("people").select("id, name, organization").is("deleted_at", null).ilike("name", like).limit(5),
        supabase.from("meetings").select("id, title, starts_at").is("deleted_at", null).ilike("title", like).limit(5),
        supabase.from("quick_capture").select("id, raw_text").eq("status", "inbox").ilike("raw_text", like).limit(5),
        supabase.from("commitments").select("id, description, due_date, status").is("deleted_at", null).ilike("description", like).limit(5),
      ]);
      return { tasks: (tasks.data ?? []).map((t) => ({ ...t, workspace: wsName.get(t.workspace_id), workspace_id: undefined })), goals: goals.data ?? [], people: people.data ?? [], meetings: meetings.data ?? [], inbox: inbox.data ?? [], commitments: commits.data ?? [] };
    }
    default: return { error: `${name} is not a read tool.` };
  }
}

// ------------------------------------------------------------------ WRITE TOOLS: validate
export type Validated = { ok: true; input: Json; preview: string } | { ok: false; error: string };
const LABEL: Record<string, [string, string, string]> = {
  task_id: ["tasks", "title", "task"], goal_id: ["goals", "name", "goal"], habit_id: ["habits", "name", "habit"], kpi_id: ["kpi_definitions", "name", "KPI"],
  milestone_id: ["milestones", "title", "milestone"], meeting_id: ["meetings", "title", "meeting"], commitment_id: ["commitments", "description", "commitment"],
};

export async function validateWrite(c: Ctx, name: ToolName, args: Json): Promise<Validated> {
  const parsed = TOOLS[name].schema.safeParse(args);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
  const input: Json = { ...(parsed.data as Json) };
  const labels: Record<string, string> = {};
  for (const [field, [table, col, what]] of Object.entries(LABEL)) {
    if (typeof input[field] !== "string") continue;
    let q = c.supabase.from(table).select(`id, ${col}`).eq("id", input[field] as string);
    if (["tasks", "goals", "meetings", "commitments"].includes(table)) q = q.is("deleted_at", null);
    const { data } = await q.maybeSingle();
    if (!data) return { ok: false, error: `That ${what} does not exist.` };
    labels[field] = String((data as unknown as Json)[col]);
  }
  const ws = (key: string, required: boolean): { id: string; name: string } | { error: string } | null => {
    if (input[key] === undefined || input[key] === "") return required ? { error: "No workspace given." } : null;
    return resolveByName(input[key] as string, c.workspaces);
  };
  let wsLabel = "";
  if (["create_task", "create_goal", "create_kpi", "create_recurring_task", "move_task", "create_meeting", "create_event"].includes(name)) {
    if (name === "create_task" && input.parent_task_id) {
      const { data: p } = await c.supabase.from("tasks").select("workspace_id, title").eq("id", input.parent_task_id as string).is("deleted_at", null).maybeSingle();
      if (!p) return { ok: false, error: "The parent task does not exist." };
      input.workspace_id = p.workspace_id; wsLabel = c.workspaces.find((w) => w.id === p.workspace_id)?.name ?? "";
    } else {
      const r = ws("workspace", !["create_meeting", "create_event"].includes(name));
      if (r && "error" in r) return { ok: false, error: r.error };
      if (r) { input.workspace_id = r.id; wsLabel = r.name; }
    }
  }
  if (name === "create_commitment") {
    const { data: ppl } = await c.supabase.from("people").select("id, name").is("deleted_at", null).is("archived_at", null).limit(1000);
    const r = resolveByName(input.person as string, ppl ?? [], "person");
    if ("error" in r) return { ok: false, error: r.error + " Add them first with create_person." };
    input.person_id = r.id; labels.person = r.name;
  }
  if (name === "create_meeting" || name === "create_event") {
    const sKey = name === "create_meeting" ? "starts_at" : "start", eKey = name === "create_meeting" ? "ends_at" : "end";
    const st = zonedToUtc(input[sKey] as string, c.tz); if (Number.isNaN(st.getTime())) return { ok: false, error: "Not a real date and time." };
    input.start_utc = st.toISOString();
    if (input[eKey]) { const en = zonedToUtc(input[eKey] as string, c.tz); if (en < st) return { ok: false, error: "The end must be after the start." }; input.end_utc = en.toISOString(); }
  }
  if (name === "record_kpi" && (input.period_end as string) < (input.period_start as string)) return { ok: false, error: "The period end is before its start." };
  return { ok: true, input, preview: preview(name, input, labels, wsLabel) };
}

export function preview(name: ToolName, i: Json, l: Record<string, string>, ws: string): string {
  const q = (s: unknown) => `“${s}”`;
  const t = l.task_id ? q(l.task_id) : "the task";
  const w = ws ? ` in ${ws}` : "";
  switch (name) {
    case "create_task": return `Create ${i.parent_task_id ? "subtask" : "task"} ${q(i.title)}${w}${i.priority ? `, ${i.priority}` : ""}${i.deadline ? `, due ${i.deadline}` : ""}`;
    case "update_task": return `Update ${t}: ${[i.title && `title → ${q(i.title)}`, i.status && `status → ${String(i.status).replace("_", " ")}`, i.priority && `priority → ${i.priority}`, i.estimated_minutes && `estimate → ${i.estimated_minutes} min`].filter(Boolean).join(", ")}`;
    case "complete_task": return `Mark ${t} completed`;
    case "reschedule_task": return `Move ${t} to ${i.new_deadline}${i.reason ? ` (${i.reason})` : ""}`;
    case "move_task": return `Move ${t} to ${ws}`;
    case "delete_task": return `DELETE ${t} and its subtasks`;
    case "log_time": return `Log ${i.minutes} min on ${t}`;
    case "create_goal": return `Create goal ${q(i.name)}${w}${i.target_date ? `, target ${i.target_date}` : ""}`;
    case "add_milestone": return `Add milestone ${q(i.title)} to goal ${q(l.goal_id)}${i.target_value ? `, target ${i.target_value}${i.unit ? " " + i.unit : ""}` : ""}`;
    case "update_milestone": return `Update milestone ${q(l.milestone_id)}: ${[i.current_value !== undefined && `progress ${i.current_value}`, i.status && `status ${i.status}`].filter(Boolean).join(", ")}`;
    case "set_goal_status": return `Set goal ${q(l.goal_id)} to ${String(i.status).replace("_", " ")}`;
    case "create_habit": return `Create habit ${q(i.name)} (${i.frequency ?? "daily"})`;
    case "log_habit": return `Habit ${q(l.habit_id)} on ${i.date ?? "today"}: ${i.status}`;
    case "create_kpi": return `Create KPI ${q(i.name)}${w}${i.target_value !== undefined ? `, target ${i.target_value}` : ""}`;
    case "record_kpi": return `Record ${i.actual_value} for KPI ${q(l.kpi_id)} (${i.period_start} to ${i.period_end})`;
    case "create_person": return `Add person ${q(i.name)}${i.organization ? ` (${i.organization})` : ""}`;
    case "create_meeting": return `Schedule meeting ${q(i.title)} at ${String(i.starts_at).replace("T", " ")}`;
    case "update_meeting": return `Update meeting ${q(l.meeting_id)}${i.status ? `: ${i.status}` : ""}${i.notes ? ", add notes" : ""}${i.decisions ? ", add decisions" : ""}`;
    case "create_commitment": return `Record ${i.direction === "by_me" ? `promise to ${l.person}` : `${l.person}'s promise`}: ${q(i.description)}${i.due_date ? `, due ${i.due_date}` : ""}`;
    case "complete_commitment": return `Mark commitment ${q(l.commitment_id)} completed`;
    case "create_event": return `Add event ${q(i.title)} at ${String(i.start).replace("T", " ")}`;
    case "create_recurring_task": return `Repeat task ${q(i.title)} ${i.freq}${w}`;
    case "save_daily_review": return `Save daily review for ${i.date ?? "today"}${i.complete ? " and complete it" : ""}`;
    case "add_to_inbox": return `Add to Inbox: ${q(i.text)}`;
    default: return String(name);
  }
}

// ------------------------------------------------------------------ WRITE TOOLS: execute + verify
export type Done = { type: string; ids: string[]; verified: boolean };
const fail = (m?: string): never => { throw new Error(m ?? "Failed."); };

export async function executeWrite(c: Ctx, name: ToolName, i: Json, logId: string): Promise<Done> {
  const db = c.supabase;
  // Insert helper: idempotent through client_request_id = action id, verified by reading the row back.
  const insert = async (table: string, row: Json): Promise<Done> => {
    const { data, error } = await db.from(table).insert(row).select("id").single();
    if (error) {
      if (error.code === "23505") { const { data: ex } = await db.from(table).select("id").eq("client_request_id", logId).maybeSingle(); if (ex) return { type: table, ids: [ex.id], verified: true }; }
      return fail(error.message);
    }
    const { data: back } = await db.from(table).select("id").eq("id", data.id).maybeSingle();
    return { type: table, ids: [data.id], verified: !!back };
  };
  const rowIs = async (table: string, id: string, expect: Json): Promise<boolean> => {
    const { data } = await db.from(table).select(Object.keys(expect).join(",")).eq("id", id).maybeSingle();
    return !!data && Object.entries(expect).every(([k, v]) => String((data as unknown as Json)[k]) === String(v));
  };

  switch (name) {
    case "create_task": return insert("tasks", { workspace_id: i.workspace_id, parent_task_id: i.parent_task_id ?? null, title: i.title, priority: i.priority ?? "normal", current_deadline: i.deadline ?? null, estimated_minutes: i.estimated_minutes ?? null, source: "ai", client_request_id: logId });
    case "update_task": {
      const patch: Json = {}; for (const k of ["title", "status", "priority", "estimated_minutes"]) if (i[k] !== undefined) patch[k] = i[k];
      const { error } = await db.from("tasks").update(patch).eq("id", i.task_id as string); if (error) fail(error.message);
      return { type: "tasks", ids: [i.task_id as string], verified: await rowIs("tasks", i.task_id as string, patch) };
    }
    case "complete_task": {
      const { error } = await db.from("tasks").update({ status: "completed" }).eq("id", i.task_id as string); if (error) fail(error.message);
      return { type: "tasks", ids: [i.task_id as string], verified: await rowIs("tasks", i.task_id as string, { status: "completed" }) };
    }
    case "reschedule_task": {
      const { error } = await db.rpc("reschedule_task", { p_task_id: i.task_id, p_new_deadline: i.new_deadline, p_reason: i.reason ?? "Moved by assistant" }); if (error) fail(error.message);
      return { type: "tasks", ids: [i.task_id as string], verified: await rowIs("tasks", i.task_id as string, { current_deadline: i.new_deadline }) };
    }
    case "move_task": {
      const { error } = await db.rpc("move_task_to_workspace", { p_task_id: i.task_id, p_workspace_id: i.workspace_id }); if (error) fail(error.message);
      return { type: "tasks", ids: [i.task_id as string], verified: await rowIs("tasks", i.task_id as string, { workspace_id: i.workspace_id }) };
    }
    case "delete_task": {
      const { error } = await db.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", i.task_id as string); if (error) fail(error.message);
      const { data } = await db.from("tasks").select("deleted_at").eq("id", i.task_id as string).maybeSingle();
      return { type: "tasks", ids: [i.task_id as string], verified: !!data?.deleted_at };
    }
    case "log_time": {
      const { data: t } = await db.from("tasks").select("workspace_id").eq("id", i.task_id as string).maybeSingle(); if (!t) fail("Task not found.");
      return insert("time_entries", { task_id: i.task_id, workspace_id: t!.workspace_id, duration_minutes: i.minutes, note: i.note ?? null, source: "manual", client_request_id: logId });
    }
    case "create_goal": return insert("goals", { workspace_id: i.workspace_id, name: i.name, description: i.description ?? null, target_date: i.target_date ?? null, success_criteria: i.success_criteria ?? null });
    case "add_milestone": return insert("milestones", { goal_id: i.goal_id, title: i.title, target_value: i.target_value ?? null, unit: i.unit ?? null, measure_description: i.measure_description ?? null, due_date: i.due_date ?? null });
    case "update_milestone": {
      const patch: Json = {}; if (i.current_value !== undefined) patch.current_value = i.current_value; if (i.status) patch.status = i.status;
      const { error } = await db.from("milestones").update(patch).eq("id", i.milestone_id as string); if (error) fail(error.message);
      return { type: "milestones", ids: [i.milestone_id as string], verified: await rowIs("milestones", i.milestone_id as string, patch) };
    }
    case "set_goal_status": {
      const { error } = await db.from("goals").update({ status: i.status }).eq("id", i.goal_id as string); if (error) fail(error.message);
      return { type: "goals", ids: [i.goal_id as string], verified: await rowIs("goals", i.goal_id as string, { status: i.status }) };
    }
    case "create_habit": {
      const f = (i.frequency as string) ?? "daily";
      return insert("habits", { name: i.name, frequency_type: f, weekdays: f === "weekdays" ? i.weekdays : null, weekly_target: f === "weekly_target" ? i.weekly_target : null, unit: i.unit ?? null, start_date: c.today });
    }
    case "log_habit": {
      const date = (i.date as string) ?? c.today;
      if (i.status === "clear") {
        const { error } = await db.from("habit_entries").delete().eq("habit_id", i.habit_id as string).eq("entry_date", date); if (error) fail(error.message);
        const { data } = await db.from("habit_entries").select("habit_id").eq("habit_id", i.habit_id as string).eq("entry_date", date).maybeSingle();
        return { type: "habit_entries", ids: [i.habit_id as string], verified: !data };
      }
      const { error } = await db.from("habit_entries").upsert({ habit_id: i.habit_id, entry_date: date, status: i.status }, { onConflict: "habit_id,entry_date" }); if (error) fail(error.message);
      const { data } = await db.from("habit_entries").select("status").eq("habit_id", i.habit_id as string).eq("entry_date", date).maybeSingle();
      return { type: "habit_entries", ids: [i.habit_id as string], verified: data?.status === i.status };
    }
    case "create_kpi": return insert("kpi_definitions", { workspace_id: i.workspace_id, name: i.name, unit: i.unit ?? null, target_value: i.target_value ?? null, direction: i.direction ?? "higher_is_better", period: i.period ?? "week", aggregation: i.aggregation ?? "sum" });
    case "record_kpi": {
      const { data, error } = await db.from("kpi_entries").upsert({ kpi_id: i.kpi_id, period_start: i.period_start, period_end: i.period_end, actual_value: i.actual_value, note: i.note ?? null }, { onConflict: "kpi_id,period_start,period_end" }).select("id, actual_value").single();
      if (error) fail(error.message);
      return { type: "kpi_entries", ids: [data!.id], verified: Number(data!.actual_value) === Number(i.actual_value) };
    }
    case "create_person": return insert("people", { name: i.name, organization: i.organization ?? null, position: i.position ?? null, email: i.email ?? null, phone: i.phone ?? null, notes: i.notes ?? null });
    case "create_meeting": return insert("meetings", { title: i.title, workspace_id: i.workspace_id ?? null, starts_at: i.start_utc, ends_at: i.end_utc ?? null, location: i.location ?? null, agenda: i.agenda ?? null });
    case "update_meeting": {
      const patch: Json = {}; for (const k of ["notes", "decisions", "status"]) if (i[k] !== undefined) patch[k] = i[k];
      const { error } = await db.from("meetings").update(patch).eq("id", i.meeting_id as string); if (error) fail(error.message);
      return { type: "meetings", ids: [i.meeting_id as string], verified: await rowIs("meetings", i.meeting_id as string, patch) };
    }
    case "create_commitment": return insert("commitments", { description: i.description, due_date: i.due_date ?? null, follow_up_date: i.follow_up_date ?? null,
      made_by_person_id: i.direction === "to_me" ? i.person_id : null, made_to_person_id: i.direction === "by_me" ? i.person_id : null, client_request_id: logId });
    case "complete_commitment": {
      const { error } = await db.from("commitments").update({ status: "completed" }).eq("id", i.commitment_id as string); if (error) fail(error.message);
      return { type: "commitments", ids: [i.commitment_id as string], verified: await rowIs("commitments", i.commitment_id as string, { status: "completed" }) };
    }
    case "create_event": return insert("calendar_events", { title: i.title, event_type: i.event_type ?? "other", workspace_id: i.workspace_id ?? null, start_at: i.start_utc, end_at: i.end_utc ?? null, client_request_id: logId });
    case "create_recurring_task": {
      const start = (i.start_date as string) ?? c.today;
      const r = await insert("recurrence_rules", { workspace_id: i.workspace_id, name: i.title, target_kind: "task", freq: i.freq, interval_count: i.interval ?? 1,
        by_weekday: i.freq === "weekly" ? i.weekdays : null, by_monthday: i.freq === "monthly" ? [i.monthday] : null, start_date: start,
        template: { title: i.title, priority: i.priority ?? "normal", estimated_minutes: i.estimated_minutes ?? null } });
      return r; // the tasks themselves are generated the next time Today opens
    }
    case "save_daily_review": {
      const date = (i.date as string) ?? c.today;
      const row: Json = { review_date: date }; for (const k of ["wins", "blockers", "tomorrow_plan"]) if (i[k]) row[k] = i[k];
      if (i.complete) row.review_completed_at = new Date().toISOString();
      const { data, error } = await db.from("daily_reviews").upsert(row, { onConflict: "owner_id,review_date" }).select("id").single(); if (error) fail(error.message);
      if (i.complete) {
        const day = await loadDay(db, date);
        const { error: e2 } = await db.from("daily_reviews").update({ score_total: day.result.total, score_breakdown: day.result.categories, weights_snapshot: day.weights,
          planned_minutes: day.input.plannedMinutes, actual_minutes: day.input.actualMinutes, rescheduled_count: day.input.tasksRescheduled, cancelled_count: day.input.tasksCancelled }).eq("review_date", date);
        if (e2) fail(e2.message);
      }
      return { type: "daily_reviews", ids: [data!.id], verified: await rowIs("daily_reviews", data!.id, Object.fromEntries(Object.entries(row).filter(([k]) => k !== "review_completed_at"))) };
    }
    case "add_to_inbox": return insert("quick_capture", { raw_text: i.text, capture_type: i.kind ?? "general", source: "ai", client_request_id: logId });
    default: return fail(`${name} cannot be executed.`);
  }
}
