"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { btn, btnPrimary } from "@/lib/ui";

// Shows that something is happening and blocks double submits.
export function SubmitButton({ children, variant = "secondary", className }: { children: ReactNode; variant?: "primary" | "secondary"; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} aria-busy={pending} className={`${variant === "primary" ? btnPrimary : btn} ${className ?? ""} ${pending ? "animate-pulse" : ""}`}>
      {pending ? "Saving…" : children}
    </button>
  );
}
