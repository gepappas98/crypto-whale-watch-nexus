// PWA Registration and utilities for Whale Radar
//
// registerServiceWorker() below registers public/sw.js in real production
// contexts. As of v9.15, sw.js is a real persistent worker (push/sync/
// notificationclick handlers, no fetch handler — see sw.js's own header for
// why that matters) — previously it was a self-unregistering kill switch,
// which is why subscribeToPush()/triggerBackgroundSync() below existed but
// could never actually deliver anything. See src/lib/pushBridge.ts for the
// higher-level opt-in flow (permission + subscribe + register with server)
// that most callers should use instead of calling subscribeToPush() bare.
import { useState, useEffect } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

declare global {
  interface WindowEventMap {
    'beforeinstallprompt': BeforeInstallPromptEvent;
  }
}

export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  const isInIframe = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();

  const isLovablePreview =
    window.location.hostname.includes('lovableproject.com') ||
    window.location.hostname.includes('lovable.app') ||
    window.location.hostname.includes('id-preview--');

  const unregisterAndClear = async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));

    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  };

  // Lovable previews run inside iframes and must never keep SW-controlled Vite chunks.
  // Mixed cached React chunks cause invalid hook calls before the app can render.
  if (import.meta.env.DEV || isInIframe || isLovablePreview) {
    await unregisterAndClear().catch(() => {});
    return;
  }

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'imports'
      });

      console.log('[PWA] SW registered:', registration.scope);

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('[PWA] New version available');
            window.dispatchEvent(new CustomEvent('sw-update-available'));
          }
        });
      });

      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'NOTIFICATION_CLICK') {
          console.log('[PWA] Notification clicked:', event.data.payload);
        }
      });

    } catch (error) {
      console.error('[PWA] SW registration failed:', error);
    }
  });
}

// Request notification permission
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) {
    console.log('[PWA] Notifications not supported');
    return false;
  }

  const permission = await Notification.requestPermission();
  return permission === 'granted';
}

// Subscribe to push notifications
export async function subscribeToPush(publicKey: string): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const keyBytes = urlBase64ToUint8Array(publicKey);
    // Copy into a fresh ArrayBuffer-backed view to satisfy BufferSource typing
    // (some lib.dom builds reject Uint8Array<ArrayBufferLike>).
    const appServerKey = new Uint8Array(keyBytes.byteLength);
    appServerKey.set(keyBytes);
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appServerKey.buffer,
    });

    return subscription;
  } catch (err) {
    console.error('[PWA] Push subscription failed:', err);
    return null;
  }
}

// Background sync for offline alerts
export async function triggerBackgroundSync(tag: string = 'whale-sync'): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    console.log('[PWA] Background sync not supported');
    return;
  }

  const registration = await navigator.serviceWorker.ready;
  if (!('sync' in registration)) {
    console.log('[PWA] Background sync not supported');
    return;
  }

  try {
    await (registration as ServiceWorkerRegistration & { sync: { register(tag: string): Promise<void> } }).sync.register(tag);
    console.log('[PWA] Background sync registered:', tag);
  } catch (err) {
    console.error('[PWA] Background sync failed:', err);
  }
}

// Add to home screen prompt
export function setupInstallPrompt(callback: (event: BeforeInstallPromptEvent) => void): void {
  let deferredPrompt: BeforeInstallPromptEvent | null = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    callback(e);
  });

  // Expose install function
  (window as Window & { installPWA?: () => Promise<void> }).installPWA = async () => {
    if (!deferredPrompt) return;
    
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      console.log('[PWA] User accepted install');
    }
    
    deferredPrompt = null;
  };
}

/** React-friendly wrapper around the same beforeinstallprompt/appinstalled
 *  events setupInstallPrompt() listens for — that function's approach (a
 *  window.installPWA global) works for any non-React caller, but a
 *  component wants state, not a global. This is the actual path
 *  WRHeader's install button and WRSettingsPanel's 📲 APP group use.
 *  Renders nothing meaningful on Safari/Firefox (they never fire
 *  beforeinstallprompt) or once already installed — canInstall stays false. */
export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(() => isStandalone());

  useEffect(() => {
    const onBeforeInstall = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const onInstalled = () => {
      setDeferredPrompt(null);
      setIsInstalled(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!deferredPrompt) return 'unavailable';
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    return outcome;
  };

  return { canInstall: Boolean(deferredPrompt), isInstalled, promptInstall };
}

// Check if app is installed
export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
         (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

// Helper: Convert base64 to Uint8Array for VAPID
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  
  return outputArray;
}

// Cache management
export async function clearAppCache(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  
  const registration = await navigator.serviceWorker.ready;
  
  const channel = new MessageChannel();
  
  return new Promise((resolve, reject) => {
    channel.port1.onmessage = (event) => {
      if (event.data?.cleared) {
        resolve();
      } else {
        reject(new Error('Failed to clear cache'));
      }
    };
    
    registration.active?.postMessage(
      { type: 'CLEAR_CACHE' },
      [channel.port2]
    );
  });
}
