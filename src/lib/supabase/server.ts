import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "./env";

// Server client bound to the signed-in user's session cookies, so Row Level Security applies
// to every query. The service-role key is deliberately NOT used anywhere in this file.
export async function createClient() {
  // Read cookies first: this marks the page as per-request (never prerendered), even when unconfigured.
  const cookieStore = await cookies();
  const env = getSupabaseEnv();
  if (!env) throw new Error("Supabase is not configured (missing NEXT_PUBLIC_SUPABASE_* variables).");
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are refreshed by the proxy instead.
        }
      },
    },
  });
}
