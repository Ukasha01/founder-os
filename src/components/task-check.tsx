"use client";

import { useFormStatus } from "react-dom";
import { Icon } from "./icons";

// Round tick box used on lists. Pressing it completes (or reopens) the task without leaving the page.
export function TaskCheck({ done, label }: { done: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} aria-label={done ? `Reopen ${label}` : `Complete ${label}`} title={done ? "Reopen" : "Mark done"}
      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition active:scale-90 ${done ? "border-emerald-500 bg-emerald-500 text-white" : "border-line-strong bg-surface text-transparent hover:border-emerald-500 hover:text-emerald-500"} ${pending ? "animate-pulse" : ""}`}>
      <Icon name="check" className="h-3.5 w-3.5" />
    </button>
  );
}
