import type { IconName } from "./icons";

export type Tab = { href: string; label: string; icon?: IconName };
export type Section = { key: string; label: string; icon: IconName; href: string; match: string[]; tabs: Tab[] };

// Five places instead of sixteen. Tabs inside a section keep every feature one tap away.
export const SECTIONS: Section[] = [
  { key: "today", label: "Today", icon: "today", href: "/", match: ["/", "/inbox", "/review", "/time", "/assistant"],
    tabs: [{ href: "/", label: "Today" }, { href: "/inbox", label: "Inbox" }, { href: "/review", label: "Review" }, { href: "/time", label: "Time" }, { href: "/assistant", label: "Assistant" }] },
  { key: "tasks", label: "Tasks", icon: "tasks", href: "/tasks", match: ["/tasks"], tabs: [] },
  { key: "calendar", label: "Calendar", icon: "calendar", href: "/calendar", match: ["/calendar"], tabs: [] },
  { key: "plan", label: "Plan", icon: "plan", href: "/goals", match: ["/goals", "/habits", "/kpis", "/recurring"],
    tabs: [{ href: "/goals", label: "Goals" }, { href: "/habits", label: "Habits" }, { href: "/kpis", label: "KPIs" }, { href: "/recurring", label: "Recurring" }] },
  { key: "people", label: "People", icon: "people", href: "/people", match: ["/people", "/meetings", "/commitments"],
    tabs: [{ href: "/people", label: "People" }, { href: "/meetings", label: "Meetings" }, { href: "/commitments", label: "Commitments" }] },
];

export function isIn(path: string, prefix: string): boolean {
  return prefix === "/" ? path === "/" : path === prefix || path.startsWith(prefix + "/");
}
export function sectionFor(path: string): Section | undefined {
  return SECTIONS.find((s) => s.match.some((m) => isIn(path, m)));
}
