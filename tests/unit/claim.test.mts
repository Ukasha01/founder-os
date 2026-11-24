import test from "node:test";
import assert from "node:assert/strict";
import { claimDelivery, claimNag } from "../../src/lib/claim.ts";

// A tiny in-memory stand-in for the part of the Supabase client the claim helpers use: update().eq()/is().select() applied to matching rows at once.
type Row = Record<string, unknown>;
function fakeDb(rows: Row[]) {
  return { from: () => ({ update: (patch: Row) => {
    const eqs: [string, unknown][] = [], nulls: string[] = [];
    const b = { eq(c: string, v: unknown) { eqs.push([c, v]); return b; }, is(c: string) { nulls.push(c); return b; },
      select() { const hit = rows.filter((r) => eqs.every(([c, v]) => r[c] === v) && nulls.every((c) => r[c] == null)); hit.forEach((r) => Object.assign(r, patch)); return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }); } };
    return b;
  } }) } as never;
}

test("only one of two overlapping runs claims a pending reminder", async () => {
  const rows = [{ id: "r1", status: "pending", attempts: 0 }];
  const db = fakeDb(rows);
  assert.equal(await claimDelivery(db, "r1", 0), true);
  assert.equal(await claimDelivery(db, "r1", 0), false);   // the second run read attempts=0 too, but it is 1 now
  assert.equal(rows[0].attempts, 1);
});
test("a reminder that is no longer pending cannot be claimed", async () => {
  assert.equal(await claimDelivery(fakeDb([{ id: "r1", status: "sent", attempts: 1 }]), "r1", 1), false);
});
test("a failed delivery can be claimed again for its retry", async () => {
  const rows = [{ id: "r1", status: "pending", attempts: 0 }]; const db = fakeDb(rows);
  assert.equal(await claimDelivery(db, "r1", 0), true);
  assert.equal(await claimDelivery(db, "r1", 1), true);
});
test("only one run sends a repeat alert, and the next repeat is scheduled by the claim", async () => {
  const rows = [{ id: "r1", status: "sent", nag_count: 0, acked_at: null }]; const db = fakeDb(rows);
  const next = new Date("2026-11-23T10:05:00Z");
  assert.equal(await claimNag(db, "r1", 0, next), true);
  assert.equal(await claimNag(db, "r1", 0, next), false);
  assert.equal(rows[0].nag_count, 1); assert.equal(rows[0].next_nag_at, next.toISOString());
});
test("an acknowledged reminder is not repeated", async () => {
  assert.equal(await claimNag(fakeDb([{ id: "r1", status: "sent", nag_count: 0, acked_at: "2026-11-23T10:00:00Z" }]), "r1", 0, null), false);
});
