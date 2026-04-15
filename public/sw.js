// Whale Radar Service Worker v9
// Strategy: Network-first for APIs, Cache-first for assets

const CACHE_NAME = 'whale-radar-v9';
const STATIC_CACHE = 'static-v9';
const API_CACHE = 'api-v9';
const IMAGE_CACHE = 'images-v9';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/src/main.tsx',
  '/assets/index.css',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// API endpoints to cache with network-first strategy
const API_ROUTES = [
  '/api/scan',
  'https://api.coingecko.com',
  'https://api.coinpaprika.com',
  'https://api.dexscreener.com'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Whale Radar v9...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Caching static assets...');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('[SW] Static assets cached');
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error('[SW] Static cache failed:', err);
      })
  );
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating new version...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => {
            return name.startsWith('whale-radar-') || 
                   name.startsWith('static-') || 
                   name.startsWith('api-');
          })
          .filter((name) => {
            return name !== STATIC_CACHE && 
                   name !== API_CACHE && 
                   name !== IMAGE_CACHE;
          })
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log('[SW] Claiming clients...');
      return self.clients.claim();
    })
  );
});

// Fetch event - routing strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Skip WebSocket connections (let them pass through)
  if (url.protocol === 'wss:' || url.protocol === 'ws:') {
    return;
  }
  
  // 1. API Routes - Network First (fresh crypto data)
  if (isAPIRequest(url)) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }
  
  // 2. Images - Cache First with network fallback
  if (request.destination === 'image') {
    event.respondWith(cacheFirstStrategy(request, IMAGE_CACHE));
    return;
  }
  
  // 3. Static assets - Cache First
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirstStrategy(request, STATIC_CACHE));
    return;
  }
  
  // 4. Default - Stale While Revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// ===== STRATEGIES =====

// Network First: Try network, fallback to cache (for APIs)
async function networkFirstStrategy(request) {
  const cache = await caches.open(API_CACHE);
  
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // Update cache with fresh data
      cache.put(request, networkResponse.clone());
      console.log('[SW] API updated from network:', request.url);
    }
    
    return networkResponse;
  } catch (error) {
    console.log('[SW] API network failed, using cache:', request.url);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Return offline fallback for API
    return new Response(
      JSON.stringify({ 
        error: 'offline', 
        message: 'You are offline. Using cached data if available.' 
      }),
      { 
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Cache First: Try cache, fallback to network (for assets)
async function cacheFirstStrategy(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.error('[SW] Fetch failed:', request.url);
    // Return fallback image or empty response
    if (request.destination === 'image') {
      return new Response('', { status: 204 });
    }
    throw error;
  }
}

// Stale While Revalidate: Fast response + background update
async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cachedResponse = await cache.match(request);
  
  const fetchPromise = fetch(request).then((networkResponse) => {
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  }).catch((err) => {
    console.log('[SW] Background fetch failed:', err);
    return cachedResponse;
  });
  
  return cachedResponse || fetchPromise;
}

// ===== HELPERS =====

function isAPIRequest(url) {
  return API_ROUTES.some((route) => url.href.includes(route)) ||
         url.pathname.startsWith('/api/');
}

function isStaticAsset(url) {
  const staticExtensions = [
    '.js', '.css', '.json', '.woff2', '.woff', '.ttf', 
    '.png', '.jpg', '.jpeg', '.svg', '.ico', '.webmanifest'
  ];
  return staticExtensions.some((ext) => url.pathname.endsWith(ext));
}

// ===== PUSH NOTIFICATIONS (Whale Alerts) =====

self.addEventListener('push', (event) => {
  console.log('[SW] Push received:', event);
  
  const data = event.data?.json() || {};
  const { title, body, icon, badge, tag, data: payload } = data;
  
  const options = {
    body: body || 'Whale activity detected!',
    icon: icon || '/icons/icon-192x192.png',
    badge: badge || '/icons/badge-72x72.png',
    tag: tag || 'whale-alert',
    requireInteraction: true,
    silent: false,
    vibrate: [200, 100, 200],
    data: payload || {},
    actions: [
      {
        action: 'view',
        title: 'View Alert',
        icon: '/icons/eye-96x96.png'
      },
      {
        action: 'dismiss',
        title: 'Dismiss',
        icon: '/icons/close-96x96.png'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(
      title || '🐋 Whale Radar Alert', 
      options
    )
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event);
  
  const { notification, action } = event;
  notification.close();
  
  if (action === 'dismiss') {
    return;
  }
  
  // Focus or open window
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      const payload = notification.data;
      
      // Try to focus existing window
      for (const client of clientList) {
        if (client.url.includes('/') && 'focus' in client) {
          client.focus();
          client.postMessage({
            type: 'NOTIFICATION_CLICK',
            payload
          });
          return;
        }
      }
      
      // Open new window if none exists
      if (clients.openWindow) {
        const url = payload?.url || '/';
        return clients.openWindow(url);
      }
    })
  );
});

// ===== BACKGROUND SYNC (Queue whale alerts when offline) =====

self.addEventListener('sync', (event) => {
  if (event.tag === 'whale-sync') {
    event.waitUntil(syncWhaleAlerts());
  }
});

async function syncWhaleAlerts() {
  console.log('[SW] Background sync triggered');
  
  // Get queued alerts from IndexedDB
  const db = await openDB('whale-radar', 1);
  const alerts = await db.getAll('queued-alerts');
  
  for (const alert of alerts) {
    try {
      await fetch('/api/alert', {
        method: 'POST',
        body: JSON.stringify(alert),
        headers: { 'Content-Type': 'application/json' }
      });
      
      // Remove from queue if successful
      await db.delete('queued-alerts', alert.id);
    } catch (err) {
      console.error('[SW] Failed to sync alert:', err);
    }
  }
}

// ===== MESSAGE HANDLING (From Main Thread) =====

self.addEventListener('message', (event) => {
  const { type, payload } = event.data;
  
  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'GET_VERSION':
      event.ports[0].postMessage({ version: CACHE_NAME });
      break;
      
    case 'CLEAR_CACHE':
      event.waitUntil(
        caches.keys().then((names) => {
          return Promise.all(names.map((name) => caches.delete(name)));
        }).then(() => {
          event.ports[0].postMessage({ cleared: true });
        })
      );
      break;
      
    case 'CACHE_ASSETS':
      event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) => {
          return cache.addAll(payload.assets);
        })
      );
      break;
  }
});

// ===== PERIODIC SYNC (Check for updates) =====

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'price-update') {
    event.waitUntil(updatePriceData());
  }
});

async function updatePriceData() {
  console.log('[SW] Periodic sync: updating prices');
  // Trigger price updates in background
  const cache = await caches.open(API_CACHE);
  // Logic to refresh critical price data
}

console.log('[SW] Whale Radar Service Worker loaded');
