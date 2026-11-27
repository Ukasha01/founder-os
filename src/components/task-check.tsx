"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Icon } from "./icons";

// Round tick box used on lists. Pressing it completes (or reopens) the task without leaving the page,
// and answers instantly with a pop so you never wonder whether the tap registered.
export function TaskCheck({ done, label }: { done: boolean; label: string }) {
  const { pending } = useFormStatus();
  const [fx, setFx] = useState(false);
  const shown = done || fx;
  return (
    <button disabled={pending} onClick={() => { if (!done) setFx(true); }} aria-label={done ? `Reopen ${label}` : `Complete ${label}`} title={done ? "Reopen" : "Mark done"}
      className={`relative grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 transition active:scale-90 ${shown ? "border-emerald-500 bg-emerald-500 text-canvas" : "border-line-strong bg-white/[.04] text-transparent hover:border-emerald-500 hover:text-emerald-500"} ${fx ? "check-pop check-burst" : ""} ${pending ? "opacity-80" : ""}`}>
      <Icon name="check" className="h-3.5 w-3.5" />
    </button>
  );
}
