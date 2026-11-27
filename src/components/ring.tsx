// Circular score meter. The arc draws itself once when the screen opens.
export function Ring({ value, size = 64, label }: { value: number | null; size?: number; label: string }) {
  const r = (size - 8) / 2, len = 2 * Math.PI * r, v = value === null ? 0 : Math.max(0, Math.min(100, value));
  const color = value === null ? "var(--color-neutral-400)" : v >= 70 ? "var(--color-emerald-800)" : v >= 40 ? "var(--color-amber-800)" : "var(--color-rose-800)";
  return (
    <div role="img" aria-label={label} className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(70 60 10 / .12)" strokeWidth="6" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={len} strokeDashoffset={len * (1 - v / 100)} className="ring-fill" style={{ ["--ring-len" as string]: len }} />
      </svg>
      <span className="absolute text-[15px] font-semibold tabular">{value === null ? "–" : v}</span>
    </div>
  );
}
