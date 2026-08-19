/* ══ PUSH — browser client ═════════════════════════════════════════════════
 *  Same safety posture as strategyTraderBridge.ts: never holds a token,
 *  routes through the push-proxy Edge Function, which attaches the real
 *  server secret. Wraps subscribeToPush()/requestNotificationPermission()
 *  from src/lib/pwa.ts (the actual Push API calls) with the server round
 *  trips needed to register a subscription for real delivery.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { safeInvoke } from '@/lib/safeInvoke';
import { requestNotificationPermission, subscribeToPush } from '@/lib/pwa';

/** True once the proxy has told us the push bridge has no server secrets
 *  configured. Push is an optional, self-hosted feature — when it isn't set
 *  up we must degrade quietly instead of throwing on every alert. */
let pushUnavailable = false;

export class PushNotConfiguredError extends Error {}

function isNotConfigured(message: string): boolean {
  return /not configured|NEXUS_BOT_API_URL|503/i.test(message);
}

export function isPushConfigured(): boolean {
  return !pushUnavailable;
}

async function call<T>(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<T> {
  if (pushUnavailable) {
    throw new PushNotConfiguredError('Push notifications are not configured on the server');
  }
  const { data, error } = await safeInvoke<T>('push-proxy', { body: { method, path, payload } });
  if (error) {
    if (isNotConfigured(error.message)) {
      pushUnavailable = true;
      throw new PushNotConfiguredError('Push notifications are not configured on the server');
    }
    throw error;
  }
  return data as T;
}

export function getVapidPublicKey() {
  return call<{ key: string }>('GET', '/vapid-public-key');
}

function subToJSON(sub: PushSubscription) {
  const json = sub.toJSON();
  return { endpoint: json.endpoint, keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' } };
}

/** Full opt-in flow: permission → subscribe → register with the server.
 *  Returns the subscription on success, null if the user declined the
 *  permission prompt or push isn't configured server-side (503 from
 *  /vapid-public-key surfaces as a thrown error here, not a silent null —
 *  callers should show that, not swallow it). */
export async function enablePush(): Promise<PushSubscription | null> {
  const granted = await requestNotificationPermission();
  if (!granted) return null;
  const { key } = await getVapidPublicKey();
  const sub = await subscribeToPush(key);
  if (!sub) return null;
  await call('POST', '/subscribe', subToJSON(sub));
  return sub;
}

export async function disablePush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const sub = await registration.pushManager.getSubscription();
  if (!sub) return;
  const { endpoint } = subToJSON(sub);
  await sub.unsubscribe().catch(() => {}); // best-effort locally even if the server call below fails
  await call('POST', '/unsubscribe', { endpoint });
}

export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}

/** Broadcast a push. Resolves to a zero-delivery result (never rejects) when
 *  the push bridge isn't configured — auto-pushes on critical alerts must not
 *  surface as runtime errors on a deployment without push secrets. */
export async function sendPush(payload: PushPayload) {
  try {
    return await call<{ ok: boolean; sent: number; pruned: number; failed: number }>('POST', '/send', payload);
  } catch (e) {
    if (e instanceof PushNotConfiguredError) return { ok: false, sent: 0, pruned: 0, failed: 0 };
    throw e;
  }
}

export function sendTestPush(url = '/') {
  return sendPush({ title: 'Whale Radar', body: 'Test push — if you can see this, it works.', tag: 'whale-radar-test', url });
}
