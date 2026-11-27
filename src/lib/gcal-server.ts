import { makeClient, parseGcalEnv, type GcalClient } from "./gcal.ts";

// One Google client per server instance, so the sign-in token is reused between requests.
let cached: { key: string; client: GcalClient } | null = null;
export function googleClient(): { ok: true; client: GcalClient } | { ok: false; reason: string } {
  const g = parseGcalEnv(process.env);
  if (!g.on) return { ok: false, reason: g.reason };
  const key = `${g.cfg.clientEmail}:${g.cfg.calendarId}`;
  if (cached?.key !== key) cached = { key, client: makeClient(g.cfg) };
  return { ok: true, client: cached.client };
}
