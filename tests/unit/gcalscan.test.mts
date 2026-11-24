import test from "node:test";
import assert from "node:assert/strict";
import { linksToScan } from "../../src/lib/gcal-sync.ts";

const link = (o: Record<string, unknown>) => ({ id: "l", owner_id: "o", source_type: "task", source_id: "t", google_event_id: "e", payload_hash: "h", status: "synced", attempts: 0, is_test: false, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-24T10:00:00Z", ...o }) as never;
const at = (iso: string) => new Date(iso);

test("recent links are scanned every minute", () => {
  assert.equal(linksToScan([link({})], new Set(), at("2026-11-24T10:07:00Z")).length, 1);
});
test("old history links are skipped except at minute 0", () => {
  const old = link({ updated_at: "2026-11-10T10:00:00Z" });
  assert.equal(linksToScan([old], new Set(), at("2026-11-24T10:07:00Z")).length, 0);
  assert.equal(linksToScan([old], new Set(), at("2026-11-24T10:00:00Z")).length, 1);
});
test("wanted, test and given-up links are never scanned", () => {
  const now = at("2026-11-24T10:00:00Z");
  assert.equal(linksToScan([link({ source_id: "w" })], new Set(["task:w"]), now).length, 0);
  assert.equal(linksToScan([link({ is_test: true })], new Set(), now).length, 0);
  assert.equal(linksToScan([link({ status: "skipped_past" })], new Set(), now).length, 0);
});
