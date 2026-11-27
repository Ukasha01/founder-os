"use client";

import { useEffect, useState } from "react";
import { savePushSubscription, removePushSubscription, sendTestNotification, listPushDevices } from "./actions";

const b64ToBytes = (s: string) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
const bytesToB64 = (b: ArrayBuffer | null) => (b ? btoa(String.fromCharCode(...new Uint8Array(b))) : "");

// Turns phone/browser notifications on or off for THIS device only.
export function PushToggle({ publicKey }: { publicKey: string | null }) {
  const [state, setState] = useState<"checking" | "unsupported" | "off" | "on" | "blocked">("checking");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
      if (Notification.permission === "denied") return setState("blocked");
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        setState(sub ? "on" : "off");
        // Self-heal: this browser is subscribed, so make sure the server knows it (a missing row means no notifications ever arrive).
        if (sub) await savePushSubscription({ endpoint: sub.endpoint, p256dh: bytesToB64(sub.getKey("p256dh")), auth: bytesToB64(sub.getKey("auth")), label: navigator.userAgent.slice(0, 90) });
      } catch { setState("off"); }
    })();
  }, []);

  if (!publicKey) return <p className="text-sm text-neutral-600">Phone notifications are not switched on yet: the push keys have not been added to the server. In-app notifications still work.</p>;
  if (state === "checking") return null;
  if (state === "unsupported") return <p className="text-sm text-neutral-600">This browser cannot receive push notifications. On iPhone, add the app to your Home Screen first.</p>;
  if (state === "blocked") return <p className="text-sm text-neutral-600">Notifications are blocked for this site. Allow them in your browser settings, then reload.</p>;

  const turnOn = async () => {
    setMsg("");
    try {
      if ((await Notification.requestPermission()) !== "granted") return setState("blocked");
      const reg = await navigator.serviceWorker.ready;
      const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      const r = await savePushSubscription({ endpoint: s.endpoint, p256dh: bytesToB64(s.getKey("p256dh")), auth: bytesToB64(s.getKey("auth")), label: navigator.userAgent.slice(0, 90) });
      if (!r.ok) { await s.unsubscribe(); return setMsg(r.error ?? "Could not save this device."); }
      setState("on");
    } catch { setMsg("Could not turn notifications on. The app must be installed or opened over https."); }
  };
  const turnOff = async () => {
    const reg = await navigator.serviceWorker.ready;
    const s = await reg.pushManager.getSubscription();
    if (s) { await removePushSubscription(s.endpoint); await s.unsubscribe(); }
    setState("off");
  };
  return (
    <div>
      <button onClick={state === "on" ? turnOff : turnOn} className="inline-flex items-center rounded-[10px] bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:brightness-110">
        {state === "on" ? "Turn off notifications on this device" : "Turn on notifications on this device"}
      </button>
      {state === "on" && (
        <button onClick={async () => { setMsg("Sending..."); const r = await sendTestNotification(); if (r.ok) setTimeout(async () => { const d = await listPushDevices(); const t = new Date(Date.now() - 150_000).toISOString(); setMsg(d.map((x) => `${x.label}: ${x.received && x.received > t ? "received it" : "did NOT receive it"}`).join(" | ")); }, 75_000);
          setMsg(r.ok ? (r.devices ? `Test queued for ${r.devices} device(s). It should arrive within a minute.` : "No device is registered yet. Turn notifications off and on again on this device.") : (r.error ?? "Could not queue the test.")); }} className="ml-2 inline-flex items-center rounded-[10px] border border-line-strong px-4 py-2 text-sm font-semibold">Send test notification</button>
      )}
      {msg && <p role="alert" className="mt-2 text-sm text-rose-800">{msg}</p>}
    </div>
  );
}
