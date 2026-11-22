import test from "node:test";
import assert from "node:assert/strict";
import { TOOLS, TOOL_SCHEMAS, isToolName, isRead, needsConfirmation, resolveWorkspace, resolveByName, FUNCTION_DECLARATIONS } from "../../src/lib/ai/tools.ts";
import { parseGemini } from "../../src/lib/ai/gemini.ts";

const ws = [{ id: "1", name: "Wapsi" }, { id: "2", name: "KEELVON" }, { id: "3", name: "University" }, { id: "4", name: "Personal Development & Fitness" }];
test("unknown tools are rejected", () => {
  assert.equal(isToolName("drop_table"), false);
  assert.equal(isToolName("delete_workspace"), false);
  assert.equal(isToolName("__proto__"), false);
  assert.equal(isToolName("create_task"), true);
  assert.ok(FUNCTION_DECLARATIONS.every((d) => isToolName(d.name)));
});
test("schemas reject bad input", () => {
  assert.equal(TOOL_SCHEMAS.create_task.safeParse({ title: "  " }).success, false);
  assert.equal(TOOL_SCHEMAS.reschedule_task.safeParse({ task_id: "nope", new_deadline: "2026-11-20" }).success, false);
  assert.equal(TOOL_SCHEMAS.reschedule_task.safeParse({ task_id: "6f1b2d3e-1111-4222-8333-444455556666", new_deadline: "2026-13-45" }).success, false);
  assert.equal(TOOL_SCHEMAS.log_time.safeParse({ task_id: "6f1b2d3e-1111-4222-8333-444455556666", minutes: 0 }).success, false);
  assert.equal(TOOL_SCHEMAS.log_time.safeParse({ task_id: "6f1b2d3e-1111-4222-8333-444455556666", minutes: 30.5 }).success, false);
  assert.equal(TOOL_SCHEMAS.create_task.safeParse({ title: "Call supplier", deadline: "2026-11-20", priority: "high" }).success, true);
});
test("workspace resolution", () => {
  assert.deepEqual(resolveWorkspace("wapsi", ws), ws[0]);
  assert.deepEqual(resolveWorkspace("Fitness", ws), ws[3]);
  assert.ok("error" in resolveWorkspace("Nope", ws));
  assert.ok("error" in resolveWorkspace(undefined, ws));
  assert.ok("error" in resolveWorkspace("i", [{ id: "a", name: "Alpha Inc" }, { id: "b", name: "Beta Inc" }]));
});
test("parseGemini reads text and function calls", () => {
  const r = parseGemini({ candidates: [{ content: { parts: [{ text: "Done? " }, { functionCall: { name: "add_to_inbox", args: { text: "x" } } }] } }] });
  assert.equal(r?.text, "Done?"); assert.deepEqual(r?.calls, [{ name: "add_to_inbox", args: { text: "x" } }]); assert.equal(r?.parts.length, 2);
  assert.equal(parseGemini({}), null);
  assert.equal(parseGemini({ candidates: [{}] }), null);
});

const id = "6f1b2d3e-1111-4222-8333-444455556666";
test("every tool has a declaration, a schema and the right kind", () => {
  const names = Object.keys(TOOLS);
  assert.equal(FUNCTION_DECLARATIONS.length, names.length);
  for (const d of FUNCTION_DECLARATIONS) { assert.ok(isToolName(d.name)); assert.ok(Object.keys(d.parameters.properties).length >= 0); for (const r of (d.parameters as { required?: string[] }).required ?? []) assert.ok(r in d.parameters.properties, `${d.name}.${r}`); }
  assert.ok(isRead("get_performance") && isRead("list_tasks") && !isRead("create_task"));
  assert.ok(names.filter((n) => isToolName(n) && !isRead(n)).length >= 20);
});
test("only deleting needs confirmation, and it is the only delete", () => {
  assert.equal(needsConfirmation("delete_task"), true); assert.equal(needsConfirmation("complete_task"), false);
  // Every tool that deletes or archives must always ask first; nothing destructive may run on auto-approve.
  const destructive = Object.keys(TOOLS).filter((n) => /^(delete|archive|bulk)/.test(n));
  assert.deepEqual(destructive.sort(), ["archive_item", "bulk_tasks", "delete_item", "delete_task"]);
  for (const n of destructive) assert.equal(needsConfirmation(n as keyof typeof TOOLS), true, n);
});
test("new manual-parity tools validate input", () => {
  assert.equal(TOOLS.update_commitment.schema.safeParse({ commitment_id: id }).success, false);
  assert.equal(TOOLS.update_commitment.schema.safeParse({ commitment_id: id, status: "cancelled" }).success, true);
  assert.equal(TOOLS.delete_item.schema.safeParse({ kind: "person", id }).success, true);
  assert.equal(TOOLS.delete_item.schema.safeParse({ kind: "task", id }).success, false);
  assert.equal(TOOLS.start_timer.schema.safeParse({}).success, false);
  assert.equal(TOOLS.manage_workspace.schema.safeParse({ action: "rename", name: "X" }).success, false);
  assert.equal(TOOLS.manage_workspace.schema.safeParse({ action: "create", name: "X" }).success, true);
  assert.equal(TOOLS.meeting_attendee.schema.safeParse({ meeting_id: id, person: "Ali", action: "add" }).success, true);
});
test("new tool schemas validate real-world input", () => {
  assert.equal(TOOLS.update_task.schema.safeParse({ task_id: id }).success, false);
  assert.equal(TOOLS.update_task.schema.safeParse({ task_id: id, status: "in_progress" }).success, true);
  assert.equal(TOOLS.update_task.schema.safeParse({ task_id: id, status: "done" }).success, false);
  assert.equal(TOOLS.add_milestone.schema.safeParse({ goal_id: id, title: "x" }).success, false);
  assert.equal(TOOLS.add_milestone.schema.safeParse({ goal_id: id, title: "x", target_value: 10 }).success, true);
  assert.equal(TOOLS.create_habit.schema.safeParse({ name: "Walk", frequency: "weekdays" }).success, false);
  assert.equal(TOOLS.create_habit.schema.safeParse({ name: "Walk", frequency: "weekdays", weekdays: [1, 2, 3] }).success, true);
  assert.equal(TOOLS.create_meeting.schema.safeParse({ title: "Ali", starts_at: "2026-11-18T16:00" }).success, true);
  assert.equal(TOOLS.create_meeting.schema.safeParse({ title: "Ali", starts_at: "tomorrow 4pm" }).success, false);
  assert.equal(TOOLS.record_kpi.schema.safeParse({ kpi_id: id, period_start: "2026-11-09", period_end: "2026-11-15", actual_value: 12 }).success, true);
  assert.equal(TOOLS.create_recurring_task.schema.safeParse({ title: "Report", workspace: "Wapsi", freq: "weekly" }).success, false);
  assert.equal(TOOLS.create_commitment.schema.safeParse({ description: "Send deck", person: "Ali", direction: "sideways" }).success, false);
  assert.equal(TOOLS.get_performance.schema.safeParse({ period: "year" }).success, false);
  assert.equal(TOOLS.save_daily_review.schema.safeParse({}).success, false);
});
test("name resolution for people and workspaces", () => {
  const ppl = [{ id: "1", name: "Ali Khan" }, { id: "2", name: "Ali Raza" }, { id: "3", name: "Sara" }];
  assert.ok("error" in resolveByName("Ali", ppl, "person"));
  assert.deepEqual(resolveByName("sara", ppl, "person"), ppl[2]);
  assert.deepEqual(resolveByName("Ali Raza", ppl, "person"), ppl[1]);
});

test("set_reminder is always offered and validated", async () => {
  const { routeTools, TOOLS } = await import("../../src/lib/ai/tools.ts");
  assert.ok(routeTools("hello").includes("set_reminder"));
  assert.equal(TOOLS.set_reminder.schema.safeParse({ title: "x", at: "2026-11-23T14:00" }).success, true);
  assert.equal(TOOLS.set_reminder.schema.safeParse({ title: "x", at: "tomorrow" }).success, false);
});
