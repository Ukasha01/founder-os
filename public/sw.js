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
  event.waitUntil(self.registration.showNotification(d.title || "Founder OS", { body: d.body || "", icon: "/icons/icon-192.png", data: { url: d.url || "/" } }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(self.clients.matchAll({ type: "window" }).then((list) => {
    for (const c of list) { if ("focus" in c) { c.navigate(url); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
