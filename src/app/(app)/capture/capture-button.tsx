"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { captureItem, type CaptureResult } from "./actions";
import { CAPTURE_TYPES, input, btnPrimary, btn } from "@/lib/ui";
import { Icon } from "@/components/icons";
import { idbStore } from "@/lib/offline/idb";
import { QUEUE_EVENT } from "./sync-manager";

type Ws = { id: string; name: string };

// Floating button available on every screen. Offline, the capture is kept on this device and sent automatically later.
export function CaptureButton({ workspaces }: { workspaces: Ws[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [requestId, setRequestId] = useState("");
  const [state, action, pending] = useActionState<CaptureResult | null, FormData>(captureItem, null);
  const [note, setNote] = useState("");

  const open = () => {
    setRequestId(crypto.randomUUID());
    dialog.current?.showModal();
  };

  useEffect(() => {
    if (state?.ok) dialog.current?.close();
  }, [state]);

  // No connection: keep the text on this device instead of failing.
  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    if (navigator.onLine) return;
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await idbStore.put({ id: requestId, raw_text: String(fd.get("raw_text") ?? "").trim(), capture_type: String(fd.get("capture_type") ?? "general"),
        workspace_id: String(fd.get("workspace_id") ?? ""), captured_at: new Date().toISOString(), status: "pending" });
      window.dispatchEvent(new Event(QUEUE_EVENT));
      e.currentTarget.reset();
      dialog.current?.close();
    } catch { setNote("This device could not store the capture. Copy your text and try again when you are online."); }
  };

  return (
    <>
      <button
        onClick={open}
        aria-label="Quick Capture"
        className="fixed right-4 bottom-20 z-20 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white shadow-pop transition hover:bg-[#2c3659] active:scale-95 md:right-8 md:bottom-8"
      >
        <Icon name="plus" className="h-4 w-4" />Capture
      </button>
      <dialog ref={dialog} className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl bg-surface p-5 text-ink shadow-pop backdrop:bg-ink/40 backdrop:backdrop-blur-[2px]">
        <form action={action} onSubmit={onSubmit} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Quick capture</h2>
          <input type="hidden" name="client_request_id" value={requestId} />
          <label className="flex flex-col gap-1 text-sm">Type
            <select name="capture_type" defaultValue="task" className={input}>
              {CAPTURE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">What do you want to capture?
            <textarea name="raw_text" required rows={4} autoFocus className={input} />
          </label>
          <label className="flex flex-col gap-1 text-sm">Workspace (optional)
            <select name="workspace_id" defaultValue="" className={input}>
              <option value="">Decide later</option>
              {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          {note && <p role="alert" className="text-sm text-red-700">{note}</p>}
          {state && !state.ok && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={btn} onClick={() => dialog.current?.close()}>Cancel</button>
            <button className={btnPrimary} disabled={pending}>{pending ? "Saving…" : "Save to Inbox"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
