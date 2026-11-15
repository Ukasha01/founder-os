// Pure helpers for the task tree. No database access here, so they are easy to unit test.
export type TaskRow = {
  id: string;
  parent_task_id: string | null;
  workspace_id: string;
  title: string;
  status: string;
  priority: string;
  current_deadline: string | null;
  original_deadline: string | null;
  child_count: number;
  actual_minutes: number;
  is_overdue: boolean;
};

export type TaskNode = TaskRow & { children: TaskNode[] };

/** Builds a forest from a flat list. Tasks whose parent is not in the list become roots. */
export function buildTree(rows: TaskRow[]): TaskNode[] {
  const byId = new Map<string, TaskNode>();
  for (const r of rows) byId.set(r.id, { ...r, children: [] });
  const roots: TaskNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_task_id ? byId.get(node.parent_task_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const rank: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
  const sort = (list: TaskNode[]) => {
    list.sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9) || a.title.localeCompare(b.title));
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

/** Idempotent-insert helper: a unique violation on client_request_id means "already saved". */
export function isDuplicate(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}
