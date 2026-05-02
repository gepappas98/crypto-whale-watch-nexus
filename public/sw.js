// Service worker kill switch.
// Removes previously shipped PWA caches/workers so Vite never serves stale React chunks.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));

    const clients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    await Promise.all(clients.map((client) => {
      const url = new URL(client.url);
      url.searchParams.set('sw-cleanup', Date.now().toString());
      return client.navigate(url.toString());
    }));

    await self.registration.unregister();
  })());
});