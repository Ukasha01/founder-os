"use client";

import { useEffect, useRef } from "react";

// A number that counts up once when it appears. Without motion (or before scripts run) it simply shows the final value.
export function CountUp({ to, ms = 800 }: { to: number; ms?: number }) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const n = el.current;
    if (!n || to === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      n.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    n.textContent = "0"; raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return <span ref={el}>{to}</span>;
}
