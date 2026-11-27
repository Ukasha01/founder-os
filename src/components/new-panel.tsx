import type { ReactNode } from "react";
import { Icon } from "./icons";

// Creation forms stay out of the way: a button that opens the form in place. No JavaScript needed.
export function NewPanel({ label, children, open = false }: { label: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group mt-4">
      <summary className="inline-flex cursor-pointer select-none items-center gap-1.5 rounded-[10px] bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition hover:brightness-110 active:scale-[.98] group-open:bg-tint group-open:text-ink">
        <Icon name="plus" className="h-4 w-4 transition group-open:rotate-45" />
        {label}
      </summary>
      <div className="panel mt-3">{children}</div>
    </details>
  );
}
