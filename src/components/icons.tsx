import type { ReactNode } from "react";

const P = (d: string) => <path key={d} d={d} />;
const SHAPES: Record<string, ReactNode[]> = {
  today: [P("M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z")],
  tasks: [P("M9 11l3 3 8-8"), P("M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h9")],
  calendar: [<rect key="r" x="3" y="4" width="18" height="18" rx="2" />, P("M16 2v4M8 2v4M3 10h18")],
  plan: [<circle key="a" cx="12" cy="12" r="10" />, <circle key="b" cx="12" cy="12" r="6" />, <circle key="c" cx="12" cy="12" r="2" />],
  people: [P("M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"), <circle key="c" cx="9" cy="7" r="4" />, P("M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75")],
  inbox: [P("M22 12h-6l-2 3h-4l-2-3H2"), P("M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z")],
  review: [P("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"), P("M14 2v6h6M16 13H8M16 17H8")],
  time: [<circle key="c" cx="12" cy="12" r="10" />, P("M12 6v6l4 2")],
  goals: [P("M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"), P("M4 22v-7")],
  habits: [P("M17 1l4 4-4 4"), P("M3 11V9a4 4 0 0 1 4-4h14"), P("M7 23l-4-4 4-4"), P("M21 13v2a4 4 0 0 1-4 4H3")],
  kpis: [P("M12 20V10M18 20V4M6 20v-4")],
  recurring: [P("M23 4v6h-6M1 20v-6h6"), P("M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15")],
  meetings: [P("M23 7l-7 5 7 5V7z"), <rect key="r" x="1" y="5" width="15" height="14" rx="2" />],
  commitments: [P("M22 11.08V12a10 10 0 1 1-5.93-9.14"), P("M22 4L12 14.01l-3-3")],
  settings: [P("M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6")],
  workspaces: [P("M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z")],
  plus: [P("M12 5v14M5 12h14")],
  check: [P("M20 6L9 17l-5-5")],
  chevron: [P("M6 9l6 6 6-6")],
  logout: [P("M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9")],
};

export type IconName = keyof typeof SHAPES;

export function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {SHAPES[name]}
    </svg>
  );
}
