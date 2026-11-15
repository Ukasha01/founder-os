import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { signOut } from "../(auth)/actions";
import { CaptureButton } from "./capture/capture-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!getSupabaseEnv()) redirect("/login");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: workspaces } = await supabase
    .from("workspaces").select("id, name").is("archived_at", null).order("sort_order").order("name");
  const { count: inboxCount } = await supabase
    .from("quick_capture").select("id", { count: "exact", head: true })
    .eq("status", "inbox").is("deleted_at", null);

  const link = "rounded-md px-3 py-2 text-sm hover:bg-neutral-100 focus-visible:outline-2";
  const inbox = `Inbox${inboxCount ? ` (${inboxCount})` : ""}`;
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col gap-1 border-r border-neutral-200 p-3 md:flex">
        <span className="px-3 py-2 text-lg font-semibold">Founder OS</span>
        <nav aria-label="Main" className="flex flex-col gap-1">
          <Link href="/" className={link}>Home</Link>
          <Link href="/inbox" className={link}>{inbox}</Link>
          <Link href="/tasks" className={link}>Tasks</Link>
          <Link href="/calendar" className={link}>Calendar</Link>
          <Link href="/time" className={link}>Time</Link>
          <Link href="/goals" className={link}>Goals</Link>
          <Link href="/review" className={link}>Review</Link>
          <Link href="/recurring" className={link}>Recurring</Link>
          <Link href="/habits" className={link}>Habits</Link>
          <Link href="/kpis" className={link}>KPIs</Link>
          <Link href="/meetings" className={link}>Meetings</Link>
          <Link href="/commitments" className={link}>Commitments</Link>
          <Link href="/people" className={link}>People</Link>
          <Link href="/workspaces" className={link}>Workspaces</Link>
          <Link href="/settings" className={link}>Settings</Link>
          <p className="mt-3 px-3 text-xs font-medium uppercase tracking-wide text-neutral-500">Your workspaces</p>
          {workspaces?.map((w) => (
            <Link key={w.id} href={`/tasks?workspace=${w.id}`} className={link}>{w.name}</Link>
          ))}
        </nav>
        <form action={signOut} className="mt-auto">
          <p className="truncate px-3 text-xs text-neutral-500">{user.email}</p>
          <button className={`${link} w-full text-left`}>Sign out</button>
        </form>
      </aside>

      <main className="flex-1 p-4 pb-32 md:p-8 md:pb-8">{children}</main>

      <CaptureButton workspaces={workspaces ?? []} />

      {/* Mobile bottom bar */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-10 flex border-t border-neutral-200 bg-white md:hidden">
        <Link href="/" className="flex-1 py-3 text-center text-sm">Home</Link>
        <Link href="/inbox" className="flex-1 py-3 text-center text-sm">{inbox}</Link>
        <Link href="/tasks" className="flex-1 py-3 text-center text-sm">Tasks</Link>
        <Link href="/calendar" className="flex-1 py-3 text-center text-sm">Calendar</Link>
        <details className="relative flex-1 text-center">
          <summary className="cursor-pointer list-none py-3 text-sm [&::-webkit-details-marker]:hidden">More</summary>
          <div className="absolute right-0 bottom-full flex w-40 flex-col rounded-md border border-neutral-200 bg-white p-1 text-left shadow-lg">
            <Link href="/time" className="rounded px-3 py-2 text-sm hover:bg-neutral-100">Time</Link>
            <Link href="/goals" className="rounded px-3 py-2 text-sm hover:bg-neutral-100">Goals</Link>
            <Link href="/review" className="rounded px-3 py-2 text-sm hover:bg-neutral-100">Review</Link>
            <Link href="/recurring" className="rounded px-3 py-2 text-sm hover:bg-neutral-100">Recurring</Link>
            <Link href="/settings" className="rounded px-3 py-2 text-sm hover:bg-neutral-100">Settings</Link>
            <Link href="/habits" className="rounded px-3 py-2 text-sm hover:bg-neutral-100">Habits</Link>
            <Link href="/kpis" className="rounded px-3 py-2 text-sm hover:bg-neutral-100">KPIs</Link>
            <Link href="/meetings" className="rounded px-3 py-2 text-sm hover:bg-neutral-100">Meetings</Link>
            <Link href="/commitments" className="rounded px-3 py-2 text-sm hover:bg-neutral-100">Commitments</Link>
            <Link href="/people" className="rounded px-3 py-2 text-sm hover:bg-neutral-100">People</Link>
            <Link href="/workspaces" className="rounded px-3 py-2 text-sm hover:bg-neutral-100">Workspaces</Link>
            <form action={signOut}><button className="w-full rounded px-3 py-2 text-left text-sm hover:bg-neutral-100">Sign out</button></form>
          </div>
        </details>
      </nav>
    </div>
  );
}
