import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// Per-request shared data. React's cache() means that when the layout and a page both ask for the
// same thing during one page load, the database is only asked once.

// Who is signed in. getClaims() checks the session token locally (no network round trip to Supabase Auth);
// the database still enforces Row Level Security with the same token on every query.
export const getAuth = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
});

export const getWorkspaces = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.from("workspaces").select("id, name, description, color").is("archived_at", null).order("sort_order").order("name");
  return data ?? [];
});

export const getInboxCount = cache(async () => {
  const supabase = await createClient();
  const { count } = await supabase.from("quick_capture").select("id", { count: "exact", head: true }).eq("status", "inbox").is("deleted_at", null);
  return count ?? 0;
});
