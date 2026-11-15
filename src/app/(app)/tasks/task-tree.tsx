import Link from "next/link";
import type { TaskNode } from "@/lib/tasks";
import { STATUS_LABEL, PRIORITY_LABEL, formatMinutes } from "@/lib/ui";

export type Progress = Record<string, number | undefined>;

function Row({ node, progress }: { node: TaskNode; progress: Progress }) {
  const pct = progress[node.id];
  const done = node.status === "completed" || node.status === "cancelled";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
      <Link href={`/tasks/${node.id}`} className={`font-medium hover:underline ${done ? "text-neutral-400 line-through" : ""}`}>
        {node.title}
      </Link>
      <span className="text-xs text-neutral-500">{STATUS_LABEL[node.status]}</span>
      <span className="text-xs text-neutral-500">{PRIORITY_LABEL[node.priority]}</span>
      {node.current_deadline && (
        <span className={`text-xs ${node.is_overdue ? "font-medium text-red-700" : "text-neutral-500"}`}>
          {node.is_overdue ? "Overdue · " : "Due "}{node.current_deadline}
        </span>
      )}
      {node.child_count > 0 && <span className="text-xs text-neutral-500">{node.child_count} subtask{node.child_count > 1 ? "s" : ""}</span>}
      {pct !== undefined && node.child_count > 0 && <span className="text-xs text-neutral-500">{pct}%</span>}
      {node.actual_minutes > 0 && <span className="text-xs text-neutral-500">{formatMinutes(node.actual_minutes)} logged</span>}
    </div>
  );
}

// Unlimited nesting: each level is a <details> that can be expanded or collapsed.
export function TaskTree({ nodes, progress, depth = 0 }: { nodes: TaskNode[]; progress: Progress; depth?: number }) {
  return (
    <ul className={depth ? "ml-4 border-l border-neutral-200 pl-3" : ""}>
      {nodes.map((n) => (
        <li key={n.id}>
          {n.children.length ? (
            <details open={depth < 1}>
              <summary className="cursor-pointer list-none marker:hidden [&::-webkit-details-marker]:hidden">
                <span aria-hidden className="mr-1 text-neutral-400">▸</span>
                <span className="inline-block align-middle"><Row node={n} progress={progress} /></span>
              </summary>
              <TaskTree nodes={n.children} progress={progress} depth={depth + 1} />
            </details>
          ) : (
            <div className="pl-4"><Row node={n} progress={progress} /></div>
          )}
        </li>
      ))}
    </ul>
  );
}
