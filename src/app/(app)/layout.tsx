import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { signOut } from "../(auth)/actions";
import { CaptureButton } from "./capture/capture-button";
import { SyncManager } from "./capture/sync-manager";
import { AppNav } from "@/components/app-nav";
import { SectionTabs } from "@/components/section-tabs";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!getSupabaseEnv()) redirect("/login");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: workspaces }, { count: inboxCount }] = await Promise.all([
    supabase.from("workspaces").select("id, name, color").is("archived_at", null).order("sort_order").order("name"),
    supabase.from("quick_capture").select("id", { count: "exact", head: true }).eq("status", "inbox").is("deleted_at", null),
  ]);

  return (
    <div className="min-h-dvh md:flex">
      <AppNav workspaces={workspaces ?? []} inboxCount={inboxCount ?? 0} email={user.email ?? ""} signOut={signOut} />
      <main className="min-w-0 flex-1 px-4 pt-3 pb-32 md:px-10 md:pt-8 md:pb-12">
        <div className="max-w-5xl">
          <SectionTabs inboxCount={inboxCount ?? 0} />
          {children}
        </div>
      </main>
      <CaptureButton workspaces={(workspaces ?? []).map((w) => ({ id: w.id, name: w.name }))} />
      <SyncManager />
    </div>
  );
}
