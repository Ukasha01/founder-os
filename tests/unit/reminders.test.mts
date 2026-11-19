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
  const r = planReminders({ ...base, meetingsSoon: [{ id: "m", title: "Demo", starts_at: "2026-11-20T04:08:00Z" }],
    commitments: [{ id: "c1", description: "Send deck", due_date: "2026-11-19", follow_up_date: null }, { id: "c2", description: "Ping Ali", due_date: null, follow_up_date: "2026-11-20" }, { id: "c3", description: "Later", due_date: "2026-11-25", follow_up_date: null }] });
  assert.deepEqual(r.map((x) => x.kind), ["meeting", "commitment", "commitment"]);
  assert.equal(r[1].title, "Commitment due: Send deck"); assert.equal(r[2].title, "Follow up: Ping Ali");
});
test("retry policy", () => { assert.equal(nextStatus(0, true), "sent"); assert.equal(nextStatus(0, false), "pending"); assert.equal(nextStatus(2, false), "failed"); });

const t = (iso: string) => ({ ...base, now: new Date(iso) });
test("calendar event reminds at its time, not hours before or days later", () => {
  const ev = [{ id: "e1", title: "Reminder: 4 PM visit to Sadar", starts_at: "2026-11-19T07:00:00Z", location: "Sadar" }];  // 12:00 Karachi
  assert.equal(planReminders({ ...t("2026-11-19T03:00:00Z"), events: ev }).length, 0);   // 08:00 local: too early
  assert.equal(planReminders({ ...t("2026-11-19T06:58:00Z"), events: ev }).length, 0);   // 2 min before: not yet
  const r = planReminders({ ...t("2026-11-19T06:59:30Z"), events: ev });                 // within a minute of the time
  assert.equal(r.length, 1); assert.equal(r[0].title, "Reminder: 4 PM visit to Sadar"); assert.equal(r[0].event_id, "e1"); assert.equal(r[0].body, "Sadar");
  assert.equal(planReminders({ ...t("2026-11-19T07:06:00Z"), events: ev }).length, 1);   // a late run still delivers
  assert.equal(planReminders({ ...t("2026-11-19T07:11:00Z"), events: ev }).length, 0);   // too late: dropped
  assert.equal(planReminders({ ...t("2026-11-19T06:59:30Z"), events: ev })[0].dedupe_key, planReminders({ ...t("2026-11-19T07:02:00Z"), events: ev })[0].dedupe_key); // same key every minute
});
test("tasks with a due time and meetings heads-up", () => {
  const r = planReminders({ ...t("2026-11-19T09:00:30Z"), timedTasks: [{ id: "t1", title: "Call the courier", due_at: "2026-11-19T09:00:00Z" }] });
  assert.equal(r[0].title, "Due now: Call the courier"); assert.equal(r[0].task_id, "t1");
  const m = [{ id: "m", title: "Demo", starts_at: "2026-11-19T10:00:00Z" }];
  assert.equal(planReminders({ ...t("2026-11-19T09:45:00Z"), meetingsSoon: m }).length, 0);
  assert.equal(planReminders({ ...t("2026-11-19T09:51:00Z"), meetingsSoon: m }).length, 1);
});
