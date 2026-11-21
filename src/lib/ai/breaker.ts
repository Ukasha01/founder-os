// Tiny in-memory circuit breaker. After `limit` failures in a row a provider is skipped for `coolMs`, so one dead provider
// costs one slow request instead of a timeout on every sentence. Per server instance; resets itself when the cool-down ends.
type State = { fails: number; until: number };
const S = new Map<string, State>();
export const breaker = {
  open(name: string, now = Date.now()): boolean { const s = S.get(name); return !!s && s.until > now; },
  fail(name: string, opts: { limit?: number; coolMs?: number; now?: number } = {}) {
    const now = opts.now ?? Date.now(); const s = S.get(name) ?? { fails: 0, until: 0 };
    s.fails += 1; if (s.fails >= (opts.limit ?? 2)) { s.until = now + (opts.coolMs ?? 60_000); s.fails = 0; }
    S.set(name, s);
  },
  ok(name: string) { S.delete(name); },
  reset() { S.clear(); },
};
