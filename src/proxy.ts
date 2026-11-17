import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/supabase/env";

// Next.js 16 "proxy" (formerly middleware): refreshes the session cookie and protects routes.
const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password", "/auth/callback", "/api/cron"]; // /api/cron/* authenticates itself with CRON_SECRET

export async function proxy(request: NextRequest) {
  const env = getSupabaseEnv();
  // Not configured yet: let the pages render their own setup message.
  if (!env) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getClaims() verifies the signed session token locally and refreshes it when expired. Unlike getUser() it does not
  // make a network call to Supabase Auth on every request (that call was a large part of the page-load delay).
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims ?? null;
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (user && (path === "/login" || path === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline.html|icons/).*)"],
};
