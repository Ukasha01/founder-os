import { createClient } from "@supabase/supabase-js";

// Service-role client: bypasses Row Level Security. SERVER ONLY, used by scheduled jobs.
// Every query made with it MUST filter by owner_id itself. Returns null when not configured.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
