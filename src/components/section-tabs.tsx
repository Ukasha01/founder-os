"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isIn, sectionFor } from "./nav-config";

// Pill tabs for the section you are in (Plan: Goals, Habits, KPIs, Recurring). Hidden for single-page sections.
export function SectionTabs({ inboxCount }: { inboxCount: number }) {
  const path = usePathname();
  const section = sectionFor(path);
  if (!section || section.tabs.length < 2) return null;
  return (
    <nav aria-label={`${section.label} sections`} className="mb-6 flex gap-1 overflow-x-auto rounded-2xl bg-tint p-1 [scrollbar-width:none]">
      {section.tabs.map((t) => {
        const active = isIn(path, t.href);
        return (
          <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-xl px-4 py-1.5 text-sm font-medium transition ${active ? "bg-surface text-ink shadow-sm" : "text-neutral-600 hover:text-ink"}`}>
            {t.label}
            {t.href === "/inbox" && inboxCount > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-xs font-semibold text-white">{inboxCount}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
