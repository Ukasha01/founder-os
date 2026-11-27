import { redirect } from "next/navigation";
import { getAuth, getInboxCount, getWorkspaces } from "@/lib/data";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { signOut } from "../(auth)/actions";
import { CaptureButton } from "./capture/capture-button";
import { SyncManager } from "./capture/sync-manager";
import { LiveAssistant } from "./live-assistant";
import { AppNav } from "@/components/app-nav";
import { SectionTabs } from "@/components/section-tabs";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!getSupabaseEnv()) redirect("/login");
  const [claims, workspaces, inboxCount] = await Promise.all([getAuth(), getWorkspaces(), getInboxCount()]);
  if (!claims) redirect("/login");

  return (
    <div className="min-h-dvh md:flex">
      <AppNav workspaces={workspaces} inboxCount={inboxCount} email={(claims.email as string | undefined) ?? ""} signOut={signOut} />
      <main className="min-w-0 flex-1 px-4 pt-3 pb-40 md:px-10 md:pt-8 md:pb-12">
        <div className="max-w-5xl">
          <SectionTabs inboxCount={inboxCount} />
          {children}
        </div>
      </main>
      <CaptureButton workspaces={workspaces.map((w) => ({ id: w.id, name: w.name }))} />
      <SyncManager />
      <LiveAssistant enabled={!!(process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY)} />
    </div>
  );
}
