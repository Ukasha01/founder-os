// Phase 1 service worker: makes the app installable. It deliberately caches NOTHING yet
// (no pages, no data), so it can never show stale or another user's data.
// Offline capture and caching arrive in Phase 5 and will be tested before being claimed.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
