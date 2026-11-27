"use client";

import Link from "next/link";
import { useRef } from "react";

// A link that leans toward the pointer (mouse only) and presses in when tapped. Pure transform, no re-render, no cost on phones.
export function TiltLink({ href, className = "", bar = "", children }: { href: string; className?: string; bar?: string; children: React.ReactNode }) {
  const el = useRef<HTMLAnchorElement>(null);
  const frame = useRef(0);
  const move = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || !el.current) return;
    const r = el.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const n = el.current; if (!n) return;
      n.style.transform = `rotateX(${(-y * 9).toFixed(2)}deg) rotateY(${(x * 11).toFixed(2)}deg) translateZ(6px)`;
      n.style.setProperty("--gx", `${(x + 0.5) * 100}%`); n.style.setProperty("--gy", `${(y + 0.5) * 100}%`);
    });
  };
  const reset = () => { cancelAnimationFrame(frame.current); if (el.current) el.current.style.transform = ""; };
  return (
    <div className="[perspective:700px]">
      <Link ref={el} href={href} onPointerMove={move} onPointerLeave={reset}
        className={`group relative block overflow-hidden transition-[transform,box-shadow] duration-150 ease-out will-change-transform active:scale-[.97] ${className}`}
        style={{ transformStyle: "preserve-3d" }}>
        <span aria-hidden className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100" style={{ background: "radial-gradient(circle at var(--gx,50%) var(--gy,50%), rgb(255 255 255 / .55), transparent 55%)" }} />
        {bar && <span aria-hidden className={`absolute inset-x-0 top-0 h-1.5 ${bar}`} />}
        <span className="relative block">{children}</span>
      </Link>
    </div>
  );
}
