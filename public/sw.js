// Whale Radar service worker — v2.
//
// v1 of this file (kept below in git history) was a "kill switch": it
// unregistered itself immediately on every activation, specifically to undo
// an EARLIER, real caching service worker whose `fetch` handler served stale
// cached Vite JS chunks after a deploy — that broke React hook calls before
// the app could even render, in production, not just in Lovable preview
// iframes. Killing all service worker activity fixed it, but also meant
// subscribeToPush()/triggerBackgroundSync() (src/lib/pwa.ts) could never
// work: there was never a persistent worker around to receive push/sync
// events, and no `push` handler existed to show a notification anyway.
//
// This version restores a real, persistent worker WITHOUT reintroducing the
// bug: there is no `fetch` event listener anywhere in this file, and it
// never calls `caches.open()`/`cache.put()`. It cannot intercept navigation
// or asset requests, so it cannot serve a stale chunk — the browser's normal
// network/HTTP-cache path handles all of that untouched, exactly as if no
// service worker existed for that purpose. All this worker does is sit
// idle until a push/sync/notificationclick event arrives.
//
// If you're tempted to add a `fetch` handler here for offline support: don't,
// without re-reading the paragraph above and testing a full deploy cycle
// (old client + new server chunks) first. That's the exact scenario that
// broke production before.

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    // Belt-and-suspenders cleanup for any browser that still has caches left
    // over from the OLD real caching worker (pre-kill-switch) — this worker
    // never writes to Cache Storage itself, so this is safe to run every
    // activation and never removes anything of ours.
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));
  })());
});

// ── Push notifications ────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let payload = { title: 'Whale Radar', body: 'New alert', tag: 'whale-radar', url: '/' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // Non-JSON push payload (shouldn't happen — server always sends JSON via
    // pushService.ts) — fall back to the default text above rather than throw.
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      data: { url: payload.url },
      icon: '/favicon.ico',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = clientsList.find((c) => c.url.includes(self.location.origin));
    if (existing) {
      existing.focus();
      if ('navigate' in existing) existing.navigate(url);
    } else {
      await self.clients.openWindow(url);
    }
  })());
});

// ── Background sync ───────────────────────────────────────────────────────
// This worker deliberately does NOT perform the sync work itself (e.g. no
// IndexedDB queue, no direct fetch-and-store here) — app state lives in the
// page's own JS/localStorage, not the service worker, matching how the rest
// of Whale Radar is built. On a 'sync' event this just wakes any open tab up
// via postMessage; the page decides what "catching up" means.
self.addEventListener('sync', (event) => {
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clientsList.forEach((c) => c.postMessage({ type: 'BACKGROUND_SYNC', tag: event.tag }));
  })());
});

// ── Cache-clear message (used by clearAppCache() in src/lib/pwa.ts) ──────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_CACHE') {
    event.waitUntil((async () => {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
      event.ports[0]?.postMessage({ cleared: true });
    })());
  }
});
