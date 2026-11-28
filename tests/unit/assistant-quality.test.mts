import { test } from "node:test";
import assert from "node:assert/strict";
import { routeTools } from "../../src/lib/ai/tools.ts";
import { routingText, providerOrder } from "../../src/lib/ai/llm.ts";
import { claimsAction } from "../../src/lib/ai/multipart.ts";

test("a bare 'ok' still gets the habit/kpi/goal tools the conversation is about", () => {
  const msgs = [{ role: "assistant" as const, text: "I'll add a KPI and a habit for your goal.", calls: [] }, { role: "user" as const, text: "ok" }];
  const names = routeTools(routingText(msgs, "ok"));
  for (const n of ["create_kpi", "create_habit", "create_goal"]) assert.ok(names.includes(n), n);
  assert.ok(!routeTools("ok").includes("create_kpi"));
});
test("promise-only replies are caught, questions and plain answers are not", () => {
  assert.ok(claimsAction("I'll set up three KPIs now."));
  assert.ok(claimsAction("Let me create that for you."));
  assert.ok(!claimsAction("Should I create it now?"));
  assert.ok(!claimsAction("You have 4 open tasks."));
});
test("typed turns prefer gemini, voice keeps the fast order", () => {
  const env = { GEMINI_API_KEY: "g", GROQ_API_KEY: "q" };
  assert.deepEqual(providerOrder(env, false, true), ["gemini", "groq"]);
  assert.deepEqual(providerOrder(env, false, false), ["groq", "gemini"]);
});
