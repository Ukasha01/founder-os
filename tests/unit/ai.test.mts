import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_SCHEMAS, isToolName, resolveWorkspace, FUNCTION_DECLARATIONS } from "../../src/lib/ai/tools.ts";
import { parseGemini } from "../../src/lib/ai/gemini.ts";

const ws = [{ id: "1", name: "Wapsi" }, { id: "2", name: "KEELVON" }, { id: "3", name: "University" }, { id: "4", name: "Personal Development & Fitness" }];
test("unknown tools are rejected, no delete tool exists", () => {
  assert.equal(isToolName("delete_task"), false);
  assert.equal(isToolName("__proto__"), false);
  assert.equal(isToolName("create_commitment"), false);
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
  assert.deepEqual(r, { text: "Done?", calls: [{ name: "add_to_inbox", args: { text: "x" } }] });
  assert.equal(parseGemini({}), null);
  assert.equal(parseGemini({ candidates: [{}] }), null);
});
