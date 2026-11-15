import { getSupabaseEnv } from "@/lib/supabase/env";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Founder OS</h1>
        <p className="text-sm text-neutral-500">Your private operating system.</p>
      </div>
      {!getSupabaseEnv() && (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Supabase is not configured. Copy <code>.env.example</code> to <code>.env.local</code> and set
          <code> NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, then restart.
        </p>
      )}
      {children}
    </main>
  );
}
