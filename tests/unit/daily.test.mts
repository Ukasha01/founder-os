import test from "node:test";
import assert from "node:assert/strict";
import { dailyOccurrences } from "../../src/lib/daily-reminders.ts";
import { looksMultiPart } from "../../src/lib/ai/multipart.ts";
import { TOOLS, isRead, isToolName, routeTools } from "../../src/lib/ai/tools.ts";

const TZ = "Asia/Karachi";
const rule = { id: "r1", title: "Push-ups and plank", at_time: "23:45:00", weekdays: null };

test("daily rule owes today's and tomorrow's reminder, with stable keys", () => {
  const now = new Date("2026-11-28T10:00:00Z");   // 15:00 Karachi
  const o = dailyOccurrences([rule], now, TZ);
  assert.deepEqual(o.map((x) => x.key), ["custom:daily:r1:2026-11-28", "custom:daily:r1:2026-11-29"]);
  assert.equal(o[0].at.toISOString(), "2026-11-28T18:45:00.000Z");   // 23:45 Karachi
  assert.deepEqual(dailyOccurrences([rule], now, TZ).map((x) => x.key), o.map((x) => x.key));   // planning twice yields the same keys
});

test("daily rule: a time already past is skipped (with five minutes of grace)", () => {
  const late = new Date("2026-11-28T19:00:00Z");   // 00:00 Karachi on the 29th: the 28th's 23:45 is 15 min old
  assert.deepEqual(dailyOccurrences([rule], late, TZ).map((x) => x.date), ["2026-11-29", "2026-11-30"]);
  const justMissed = new Date("2026-11-28T18:48:00Z");   // 3 minutes after 23:45
  assert.equal(dailyOccurrences([rule], justMissed, TZ)[0].date, "2026-11-28");
});

test("daily rule: weekdays filter (0 = Sunday)", () => {
  const now = new Date("2026-11-28T10:00:00Z");   // Saturday
  const monWed = { ...rule, weekdays: [1, 3] };
  assert.deepEqual(dailyOccurrences([monWed], now, TZ), []);   // Sat and Sun are not Mon/Wed
  const satOnly = { ...rule, weekdays: [6] };
  assert.deepEqual(dailyOccurrences([satOnly], now, TZ).map((x) => x.date), ["2026-11-28"]);
});

test("multi-part messages are detected", () => {
  assert.equal(looksMultiPart("add a task to call Ali and delete the old report task"), true);
  assert.equal(looksMultiPart("Wapsi pe task add karo aur purana delete karo"), true);
  assert.equal(looksMultiPart("complete the pitch deck"), false);
});

test("reminder tools exist, are routed to every provider, and validate their input", () => {
  for (const n of ["list_reminders", "set_daily_reminder", "cancel_reminder", "reschedule_reminder"]) assert.ok(isToolName(n), n);
  assert.ok(isRead("list_reminders")); assert.ok(!isRead("set_daily_reminder"));
  const routed = routeTools("hello");
  for (const n of ["list_reminders", "set_daily_reminder", "cancel_reminder", "reschedule_reminder"]) assert.ok(routed.includes(n), `${n} routed`);
  const sd = TOOLS.set_daily_reminder.schema;
  assert.ok(sd.safeParse({ title: "x", time: "23:45" }).success);
  assert.ok(!sd.safeParse({ title: "x", time: "24:30" }).success);
  assert.ok(!sd.safeParse({ title: "x", time: "9:00" }).success);
  assert.ok(!sd.safeParse({ title: "x", time: "09:00", weekdays: [7] }).success);
  assert.ok(!TOOLS.reschedule_reminder.schema.safeParse({ reminder_id: "11111111-1111-4111-8111-111111111111" }).success);
  assert.ok(TOOLS.reschedule_reminder.schema.safeParse({ reminder_id: "11111111-1111-4111-8111-111111111111", time: "07:30" }).success);
});
