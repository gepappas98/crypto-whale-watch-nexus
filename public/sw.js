// Whale Radar Service Worker v9
// Strategy: injectManifest — Workbox injects precache list at self.__WB_MANIFEST
//
// ✅ FIX: Added self.__WB_MANIFEST placeholder (required by vite-plugin-pwa
//         injectManifest strategy — without it the build fails silently).
// ✅ FIX: Replaced bare openDB() call (idb not imported in SW scope) with
//         a lightweight inline IndexedDB helper to avoid ReferenceError.

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

// ─── Precache ────────────────────────────────────────────────────────────────
// self.__WB_MANIFEST is replaced at build time by vite-plugin-pwa with the
// list of versioned assets (JS, CSS, HTML, fonts, icons…).
precacheAndRoute(self.__WB_MANIFEST || []);
cleanupOutdatedCaches();

// ─── Cache names ─────────────────────────────────────────────────────────────
const API_CACHE    = 'api-v9';
const IMAGE_CACHE  = 'images-v9';
const STATIC_CACHE = 'static-v9';

// ─── Runtime caching routes ──────────────────────────────────────────────────

// CoinGecko — NetworkFirst, 5 min TTL
registerRoute(
  ({ url }) => url.hostname === 'api.coingecko.com',
  new NetworkFirst({
    cacheName: 'coingecko-cache',
    plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 300 })],
  })
);

// CoinPaprika — NetworkFirst, 5 min TTL
registerRoute(
  ({ url }) => url.hostname === 'api.coinpaprika.com',
  new NetworkFirst({
    cacheName: 'paprika-cache',
    plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 300 })],
  })
);

// DexScreener — NetworkFirst, 2 min TTL (fast-moving DEX data)
registerRoute(
  ({ url }) => url.hostname === 'api.dexscreener.com',
  new NetworkFirst({
    cacheName: 'dexscreener-cache',
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 120 })],
  })
);

// Local API routes (/api/*) — NetworkFirst, no cache on failure
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({ cacheName: API_CACHE })
);

// Images — CacheFirst (logos, icons rarely change)
registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: IMAGE_CACHE,
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 7 * 24 * 60 * 60 })],
  })
);

// Fonts & static assets — StaleWhileRevalidate
registerRoute(
  ({ url }) => ['.woff', '.woff2', '.ttf', '.css'].some(ext => url.pathname.endsWith(ext)),
  new StaleWhileRevalidate({ cacheName: STATIC_CACHE })
);

// ─── Lifecycle ───────────────────────────────────────────────────────────────

self.addEventListener('install', () => {
  console.log('[SW] Installing Whale Radar v9…');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating…');
  event.waitUntil(self.clients.claim());
});

// ─── Push Notifications (Whale Alerts) ───────────────────────────────────────

self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  const { title, body, icon, badge, tag, data: payload } = data;

  event.waitUntil(
    self.registration.showNotification(title || '🐋 Whale Radar Alert', {
      body:              body    || 'Whale activity detected!',
      icon:              icon    || '/icons/icon-192x192.png',
      badge:             badge   || '/icons/badge-72x72.png',
      tag:               tag     || 'whale-alert',
      requireInteraction: true,
      vibrate:           [200, 100, 200],
      data:              payload || {},
      actions: [
        { action: 'view',    title: 'View Alert' },
        { action: 'dismiss', title: 'Dismiss'    },
      ],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  const { notification, action } = event;
  notification.close();
  if (action === 'dismiss') return;

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({ type: 'NOTIFICATION_CLICK', payload: notification.data });
          return;
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(notification.data?.url || '/');
      }
    })
  );
});

// ─── Background Sync (queue alerts while offline) ────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'whale-sync') {
    event.waitUntil(syncWhaleAlerts());
  }
});

// ✅ FIX: Inline minimal IndexedDB helper — avoids bare openDB() ReferenceError
//         (idb package is not importable inside a classic SW without a bundler step)
function openWhaleDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('whale-radar', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('queued-alerts', { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function getAllFromStore(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function deleteFromStore(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

async function syncWhaleAlerts() {
  console.log('[SW] Background sync triggered');
  try {
    const db     = await openWhaleDB();
    const alerts = await getAllFromStore(db, 'queued-alerts');

    for (const alert of alerts) {
      try {
        await fetch('/api/alert', {
          method:  'POST',
          body:    JSON.stringify(alert),
          headers: { 'Content-Type': 'application/json' },
        });
        await deleteFromStore(db, 'queued-alerts', alert.id);
      } catch (err) {
        console.error('[SW] Failed to sync alert:', err);
      }
    }
  } catch (err) {
    console.error('[SW] syncWhaleAlerts error:', err);
  }
}

// ─── Periodic Sync ───────────────────────────────────────────────────────────

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'price-update') {
    event.waitUntil(updatePriceData());
  }
});

async function updatePriceData() {
  console.log('[SW] Periodic sync: refreshing price cache');
  // Workbox runtime cache will handle the actual re-fetch on next request.
  // Add custom background fetch logic here if needed.
}

// ─── Message Handling (from main thread) ─────────────────────────────────────

self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'GET_VERSION':
      event.ports[0]?.postMessage({ version: 'whale-radar-v9' });
      break;

    case 'CLEAR_CACHE':
      caches.keys()
        .then((names) => Promise.all(names.map((n) => caches.delete(n))))
        .then(() => event.ports[0]?.postMessage({ cleared: true }));
      break;

    case 'CACHE_ASSETS':
      caches.open(STATIC_CACHE).then((cache) => cache.addAll(payload?.assets ?? []));
      break;
  }
});

console.log('[SW] Whale Radar Service Worker v9 loaded ✅');
