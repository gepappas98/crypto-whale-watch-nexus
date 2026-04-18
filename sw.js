/* ═══════════════════════════════════════════════════════════════════════════
 *  WHALE RADAR v9 — SERVICE WORKER (Production Ready)
 *  Caching strategy: Network-first για real-time data + Stale-while-revalidate για assets
 *  Version: v9.2
 * ═══════════════════════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'v9.2';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const API_CACHE = `api-${CACHE_VERSION}`;
const IMAGE_CACHE = `images-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/og-image.jpg',
];

// Εξαιρέσεις που δεν θέλουμε να cache-άρουμε ποτέ
const EXCLUDED_URLS = [
  '/api/',           // αν έχεις custom backend API
  'wss://',
  'ws://',
];

// Install event — precache static assets
self.addEventListener('install', (event) => {
  console.log(`[SW] Installing Whale Radar Service Worker ${CACHE_VERSION}...`);

  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );

  // Αμέσως ενεργοποίηση νέου SW (γρήγορη ενημέρωση)
  self.skipWaiting();
});

// Activate event — καθαρισμός παλιών caches
self.addEventListener('activate', (event) => {
  console.log(`[SW] Activating ${CACHE_VERSION}`);

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (
            cacheName !== STATIC_CACHE &&
            cacheName !== API_CACHE &&
            cacheName !== IMAGE_CACHE
          ) {
            console.log(`[SW] Deleting old cache: ${cacheName}`);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );

  // Αναλάβετε αμέσως όλες τις σελίδες
  self.clients.claim();
});

// Fetch event — κύρια λογική
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Αγνόησε WebSocket requests (real-time streams)
  if (request.url.startsWith('ws://') || request.url.startsWith('wss://')) {
    return;
  }

  // Αγνόησε συγκεκριμένα paths
  if (EXCLUDED_URLS.some(ex => request.url.includes(ex))) {
    return;
  }

  // Static assets (JS, CSS, fonts, manifest)
  if (request.destination === 'script' ||
      request.destination === 'style' ||
      request.destination === 'font' ||
      STATIC_ASSETS.some(asset => request.url.endsWith(asset))) {

    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        return cachedResponse || fetch(request).then((networkResponse) => {
          // Cache successful responses
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(STATIC_CACHE).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // Images (icons, charts, token logos)
  if (request.destination === 'image') {
    event.respondWith(
      caches.open(IMAGE_CACHE).then((cache) => {
        return cache.match(request).then((cachedResponse) => {
          return cachedResponse || fetch(request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(request, networkResponse.clone());
            }
            return networkResponse;
          });
        });
      })
    );
    return;
  }

  // API calls & dynamic data → Network First με fallback σε cache
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        // Cache επιτυχημένες απαντήσεις (status 200)
        if (networkResponse && networkResponse.status === 200 && !request.headers.has('range')) {
          const responseClone = networkResponse.clone();
          caches.open(API_CACHE).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Offline → επιστροφή από cache
        return caches.match(request);
      })
  );
});

// Optional: Message από την εφαρμογή για αναγκαστικό refresh
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log(`[SW] Whale Radar Service Worker ${CACHE_VERSION} loaded successfully`);
