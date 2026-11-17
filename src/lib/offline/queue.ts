// Offline capture queue. The storage is injected so the logic can be tested without a browser.
export type QueuedCapture = {
  id: string;            // = client_request_id, so a replay can never create a second Inbox item
  raw_text: string;
  capture_type: string;
  workspace_id: string;
  captured_at: string;   // device time
  status: "pending" | "failed";
  error?: string;
};
export interface QueueStore {
  list(): Promise<QueuedCapture[]>;
  put(item: QueuedCapture): Promise<void>;
  remove(id: string): Promise<void>;
}
export type SendResult = { ok: true } | { ok: false; retry: boolean; error: string };

// Sends pending items oldest first. A network problem stops the run (keep order, try again later);
// a rejected item is marked failed and kept so nothing is ever lost silently.
export async function flushQueue(store: QueueStore, send: (item: QueuedCapture) => Promise<SendResult>): Promise<{ sent: number; failed: number; stoppedOffline: boolean }> {
  const items = (await store.list()).filter((i) => i.status === "pending").sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  let sent = 0, failed = 0;
  for (const item of items) {
    const r = await send(item);
    if (r.ok) { await store.remove(item.id); sent++; continue; }
    if (r.retry) return { sent, failed, stoppedOffline: true };
    await store.put({ ...item, status: "failed", error: r.error });
    failed++;
  }
  return { sent, failed, stoppedOffline: false };
}

export function memoryStore(): QueueStore {
  const m = new Map<string, QueuedCapture>();
  return {
    list: async () => [...m.values()],
    put: async (i) => { m.set(i.id, i); },
    remove: async (id) => { m.delete(id); },
  };
}
