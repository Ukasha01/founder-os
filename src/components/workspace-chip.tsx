import { wsStyle } from "@/lib/ui";

export function WorkspaceChip({ name, color }: { name: string; color: string | null | undefined }) {
  const c = wsStyle(color);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${c.tint} ${c.ink}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {name}
    </span>
  );
}
