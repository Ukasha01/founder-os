import test from "node:test";
import assert from "node:assert/strict";
import { flushQueue, memoryStore, type QueuedCapture } from "../../src/lib/offline/queue.ts";

const item = (id: string, at: string): QueuedCapture => ({ id, raw_text: id, capture_type: "task", workspace_id: "", captured_at: at, status: "pending" });

test("sends oldest first and clears sent items", async () => {
  const s = memoryStore(); await s.put(item("b", "2026-01-02")); await s.put(item("a", "2026-01-01"));
  const order: string[] = [];
  const r = await flushQueue(s, async (i) => { order.push(i.id); return { ok: true }; });
  assert.deepEqual(order, ["a", "b"]); assert.equal(r.sent, 2); assert.equal((await s.list()).length, 0);
});
test("a network failure stops the run and keeps everything", async () => {
  const s = memoryStore(); await s.put(item("a", "1")); await s.put(item("b", "2"));
  const r = await flushQueue(s, async () => ({ ok: false, retry: true, error: "offline" }));
  assert.equal(r.stoppedOffline, true); assert.equal((await s.list()).length, 2);
});
test("a rejected item is kept as failed and the rest still send", async () => {
  const s = memoryStore(); await s.put(item("a", "1")); await s.put(item("b", "2"));
  const r = await flushQueue(s, async (i) => (i.id === "a" ? { ok: false, retry: false, error: "bad" } : { ok: true }));
  assert.deepEqual([r.sent, r.failed], [1, 1]);
  const left = await s.list(); assert.equal(left.length, 1); assert.equal(left[0].status, "failed"); assert.equal(left[0].error, "bad");
  const again = await flushQueue(s, async () => ({ ok: true })); assert.equal(again.sent, 0);
});
