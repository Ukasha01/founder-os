import test from "node:test";
import assert from "node:assert/strict";
import { planReminders, nextStatus } from "../../src/lib/reminders.ts";

const base = { now: new Date("2026-11-20T04:00:00Z"), today: "2026-11-20", dueToday: [], overdue: [], meetingsSoon: [], commitments: [] };
test("nothing to remind about gives no reminders", () => { assert.deepEqual(planReminders(base), []); });
test("one digest per day with a stable dedupe key", () => {
  const r = planReminders({ ...base, dueToday: [{ id: "1", title: "A" }, { id: "2", title: "B" }], overdue: [{ id: "3", title: "C", current_deadline: "2026-11-18" }] });
  assert.equal(r.length, 1); assert.equal(r[0].dedupe_key, "digest:2026-11-20"); assert.equal(r[0].title, "2 tasks due today, 1 overdue"); assert.equal(r[0].body, "C · A · B");
});
test("meetings and commitments", () => {
  const r = planReminders({ ...base, meetingsSoon: [{ id: "m", title: "Demo", starts_at: "2026-11-20T05:00:00Z" }],
    commitments: [{ id: "c1", description: "Send deck", due_date: "2026-11-19", follow_up_date: null }, { id: "c2", description: "Ping Ali", due_date: null, follow_up_date: "2026-11-20" }, { id: "c3", description: "Later", due_date: "2026-11-25", follow_up_date: null }] });
  assert.deepEqual(r.map((x) => x.kind), ["meeting", "commitment", "commitment"]);
  assert.equal(r[1].title, "Commitment due: Send deck"); assert.equal(r[2].title, "Follow up: Ping Ali");
});
test("retry policy", () => { assert.equal(nextStatus(0, true), "sent"); assert.equal(nextStatus(0, false), "pending"); assert.equal(nextStatus(2, false), "failed"); });
