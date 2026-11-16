"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { SECTIONS, isIn, sectionFor } from "./nav-config";
import { wsStyle } from "@/lib/ui";

type Ws = { id: string; name: string; color: string | null };
type Props = { workspaces: Ws[]; inboxCount: number; email: string; signOut: () => Promise<void> | void };

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-2 py-1">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink text-base font-bold text-white">F</span>
      <span className="text-[17px] font-semibold tracking-tight">Founder OS</span>
    </Link>
  );
}

function UserMenu({ email, signOut, placement }: { email: string; signOut: Props["signOut"]; placement: "up" | "down" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const item = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-tint";
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Account menu"
        className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-white/70">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ws-violet text-sm font-semibold text-white">{(email[0] ?? "?").toUpperCase()}</span>
        <span className="hidden min-w-0 flex-1 truncate text-sm text-neutral-600 md:block">{email}</span>
        <Icon name="chevron" className="hidden h-4 w-4 text-muted md:block" />
      </button>
      {open && (
        <div onClick={() => setOpen(false)} className={`panel absolute z-30 w-56 rounded-2xl border border-line bg-surface p-1.5 shadow-pop ${placement === "up" ? "bottom-full left-0 mb-2" : "right-0 top-full mt-2"}`}>
          <p className="truncate px-3 py-1.5 text-xs text-muted">{email}</p>
          <Link href="/workspaces" className={item}><Icon name="workspaces" className="h-4 w-4 text-muted" />Workspaces</Link>
          <Link href="/settings" className={item}><Icon name="settings" className="h-4 w-4 text-muted" />Settings</Link>
          <form action={signOut}><button className={item}><Icon name="logout" className="h-4 w-4 text-muted" />Sign out</button></form>
        </div>
      )}
    </div>
  );
}

export function AppNav({ workspaces, inboxCount, email, signOut }: Props) {
  const path = usePathname();
  const current = sectionFor(path);
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col gap-5 p-4 md:sticky md:top-0 md:flex md:h-dvh">
        <Brand />
        <nav aria-label="Main" className="flex flex-col gap-1">
          {SECTIONS.map((s) => {
            const active = current?.key === s.key;
            return (
              <Link key={s.key} href={s.href} aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-xl px-2.5 py-2 text-[15px] font-medium transition ${active ? "bg-surface text-ink ring-1 ring-line" : "text-neutral-600 hover:bg-white/70"}`}>
                <span className={`grid h-8 w-8 place-items-center rounded-lg transition ${active ? "bg-ink text-white" : "bg-tint text-neutral-600"}`}><Icon name={s.icon} className="h-[18px] w-[18px]" /></span>
                <span className="flex-1">{s.label}</span>
                {s.key === "today" && inboxCount > 0 && <span className="rounded-full bg-rose-500 px-2 py-0.5 text-xs font-semibold text-white">{inboxCount}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className="px-2.5 pb-1.5 text-sm font-semibold text-neutral-500">Workspaces</p>
          <ul className="flex flex-col gap-0.5">
            {workspaces.map((w) => {
              const c = wsStyle(w.color);
              return (
                <li key={w.id}>
                  <Link href={`/tasks?workspace=${w.id}`} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-neutral-700 hover:bg-white/70">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${c.dot}`} />
                    <span className="truncate">{w.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
        <UserMenu email={email} signOut={signOut} placement="up" />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between bg-canvas/90 px-4 py-2 backdrop-blur md:hidden">
        <Brand />
        <div className="w-12"><UserMenu email={email} signOut={signOut} placement="down" /></div>
      </header>

      {/* Mobile bottom bar */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-surface px-1 pb-[env(safe-area-inset-bottom)] md:hidden">
        {SECTIONS.map((s) => {
          const active = current?.key === s.key;
          return (
            <Link key={s.key} href={s.href} aria-current={active ? "page" : undefined} className="relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium">
              <span className={`grid h-7 w-12 place-items-center rounded-full transition ${active ? "bg-ink text-white" : "text-neutral-500"}`}><Icon name={s.icon} className="h-[18px] w-[18px]" /></span>
              <span className={active ? "text-ink" : "text-neutral-500"}>{s.label}</span>
              {s.key === "today" && inboxCount > 0 && <span className="absolute top-1 right-[22%] grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">{inboxCount}</span>}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

export { isIn };
