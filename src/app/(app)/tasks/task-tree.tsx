import Link from "next/link";
import type { TaskNode } from "@/lib/tasks";
import { STATUS_LABEL, PRIORITY_LABEL, STATUS_STYLE, PRIORITY_STYLE, badge, formatMinutes, wsStyle } from "@/lib/ui";
import { TaskCheck } from "@/components/task-check";
import { toggleTaskDone } from "./actions";

export type Progress = Record<string, number | undefined>;
export type WsMap = Record<string, { name: string; color: string | null }>;

export function TaskRowContent({ node, progress, ws, showWorkspace }: { node: TaskNode; progress: Progress; ws: WsMap; showWorkspace: boolean }) {
  const pct = progress[node.id];
  const done = node.status === "completed" || node.status === "cancelled";
  const c = wsStyle(ws[node.workspace_id]?.color);
  return (
    <div className="flex items-start gap-3">
      <form action={toggleTaskDone} className="pt-0.5">
        <input type="hidden" name="id" value={node.id} />
        <input type="hidden" name="done" value={String(node.status === "completed")} />
        <TaskCheck done={node.status === "completed"} label={node.title} />
      </form>
      <div className="min-w-0 flex-1">
        <Link href={`/tasks/${node.id}`} className={`block font-medium leading-snug hover:underline ${done ? "text-neutral-400 line-through" : "text-ink"}`}>{node.title}</Link>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {showWorkspace && <span className={`${badge} ${c.tint} ${c.ink}`}><span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${c.dot}`} />{ws[node.workspace_id]?.name}</span>}
          {node.status !== "not_started" && node.status !== "completed" && <span className={`${badge} ${STATUS_STYLE[node.status]}`}>{STATUS_LABEL[node.status]}</span>}
          {(node.priority === "critical" || node.priority === "high" || node.priority === "low") && <span className={`${badge} ${PRIORITY_STYLE[node.priority]}`}>{PRIORITY_LABEL[node.priority]}</span>}
          {node.current_deadline && !done && <span className={`${badge} ${node.is_overdue ? "bg-rose-100 text-rose-800" : "bg-neutral-100 text-neutral-600"}`}>{node.is_overdue ? "Overdue " : ""}{node.current_deadline}</span>}
          {node.actual_minutes > 0 && <span className={`${badge} bg-neutral-100 text-neutral-600`}>{formatMinutes(node.actual_minutes)} logged</span>}
          {node.child_count > 0 && pct !== undefined && (
            <span className="flex items-center gap-1.5 text-xs text-neutral-500">
              <span className="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-100"><span className={`block h-full rounded-full ${c.dot}`} style={{ width: `${Math.min(100, pct)}%` }} /></span>
              {pct}% of {node.child_count} subtask{node.child_count > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Children({ nodes, progress, ws }: { nodes: TaskNode[]; progress: Progress; ws: WsMap }) {
  return (
    <ul className="mt-3 flex flex-col gap-3 border-l-2 border-line pl-4">
      {nodes.map((n) => (
        <li key={n.id}>
          {n.children.length ? (
            <details open>
              <summary className="cursor-pointer"><span className="inline-block w-[calc(100%-1rem)] align-top"><TaskRowContent node={n} progress={progress} ws={ws} showWorkspace={false} /></span></summary>
              <Children nodes={n.children} progress={progress} ws={ws} />
            </details>
          ) : <TaskRowContent node={n} progress={progress} ws={ws} showWorkspace={false} />}
        </li>
      ))}
    </ul>
  );
}

// Each top-level task is a card with its workspace colour down the left edge; subtasks nest inside it, to any depth.
export function TaskTree({ nodes, progress, ws, showWorkspace }: { nodes: TaskNode[]; progress: Progress; ws: WsMap; showWorkspace: boolean }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {nodes.map((n) => {
        const c = wsStyle(ws[n.workspace_id]?.color);
        return (
          <li key={n.id} className={`rounded-2xl border border-l-4 border-line bg-surface p-3.5 transition hover:border-line-strong ${c.edge}`}>
            <TaskRowContent node={n} progress={progress} ws={ws} showWorkspace={showWorkspace} />
            {n.children.length > 0 && <Children nodes={n.children} progress={progress} ws={ws} />}
          </li>
        );
      })}
    </ul>
  );
}
