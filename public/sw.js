// Founder OS service worker (v2).
// It caches ONLY a static offline page and the app icons. It never caches pages or data, so it can
// never show stale or another user's information. When a page cannot be reached it shows the
// offline capture page, which saves notes on this device; they are sent next time the app is open online.
const CACHE = "fos-static-v2";
const FILES = ["/offline.html", "/icons/icon-192.png"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode !== "navigate") return;
  event.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
});

// Web Push: show the notification, and open the linked screen when it is tapped.
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = {}; }
  event.waitUntil(Promise.all([self.registration.pushManager.getSubscription().then((sub) => sub && fetch("/api/push/ack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }), keepalive: true })).catch(() => undefined), self.registration.showNotification(d.title || "Founder OS", { body: d.body || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", vibrate: [250, 120, 250, 120, 250], tag: "fos-" + Date.now(), renotify: true, requireInteraction: true, timestamp: Date.now(), actions: d.rid ? [{ action: "done", title: "Done" }, { action: "snooze", title: "Snooze 10 min" }] : [], data: { url: d.url || "/", rid: d.rid || null } })]));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rid = event.notification.data && event.notification.data.rid;
  const ack = rid ? fetch("/api/reminders/ack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: rid, action: event.action === "snooze" ? "snooze" : "done" }) }).catch(() => undefined) : Promise.resolve();
  if (event.action === "done" || event.action === "snooze") { event.waitUntil(ack); return; }   // buttons act without opening the app
  event.waitUntil(ack);
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(self.clients.matchAll({ type: "window" }).then((list) => {
    for (const c of list) { if ("focus" in c) { c.navigate(url); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
