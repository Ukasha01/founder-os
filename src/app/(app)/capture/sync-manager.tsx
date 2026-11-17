"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { captureItem } from "./actions";
import { flushQueue, type QueuedCapture, type SendResult } from "@/lib/offline/queue";
import { idbStore } from "@/lib/offline/idb";

export const QUEUE_EVENT = "fos-queue-changed";

async function send(item: QueuedCapture): Promise<SendResult> {
  const fd = new FormData();
  fd.set("raw_text", item.raw_text); fd.set("capture_type", item.capture_type);
  fd.set("workspace_id", item.workspace_id); fd.set("client_request_id", item.id);
  try {
    const r = await captureItem(null, fd);
    return r.ok ? { ok: true } : { ok: false, retry: false, error: r.error };
  } catch {
    return { ok: false, retry: true, error: "offline" }; // network error: try again later
  }
}

// Sends captures saved while offline. Runs on load, when the connection returns, and every minute.
// Safe to repeat: each item carries its own request id, so the database never stores it twice.
export function SyncManager() {
  const router = useRouter();
  const [items, setItems] = useState<QueuedCapture[]>([]);

  const refresh = useCallback(async () => { try { setItems(await idbStore.list()); } catch { /* storage unavailable */ } }, []);
  const sync = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      const r = await flushQueue(idbStore, send);
      if (r.sent > 0) router.refresh();
    } catch { /* storage unavailable */ }
    await refresh();
  }, [refresh, router]);

  useEffect(() => {
    const first = setTimeout(sync, 0);
    const timer = setInterval(sync, 60000);
    const onChange = () => { void refresh(); };
    window.addEventListener("online", sync);
    window.addEventListener(QUEUE_EVENT, onChange);
    return () => { clearTimeout(first); clearInterval(timer); window.removeEventListener("online", sync); window.removeEventListener(QUEUE_EVENT, onChange); };
  }, [sync, refresh]);

  if (!items.length) return null;
  const pending = items.filter((i) => i.status === "pending").length;
  const failed = items.filter((i) => i.status === "failed");
  return (
    <div role="status" className="fixed right-4 bottom-36 z-20 max-w-xs rounded-2xl border border-line bg-surface p-3 text-sm shadow-pop md:right-8 md:bottom-24">
      {pending > 0 && <p className="font-medium text-amber-800">{pending} capture{pending > 1 ? "s" : ""} saved on this device, waiting to sync</p>}
      {failed.map((f) => (
        <div key={f.id} className="mt-1 flex items-center gap-2 text-rose-800">
          <span className="min-w-0 flex-1 truncate">Not saved: “{f.raw_text}” ({f.error})</span>
          <button className="text-xs underline" onClick={async () => { await idbStore.remove(f.id); await refresh(); }}>Discard</button>
        </div>
      ))}
    </div>
  );
}
