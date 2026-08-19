/* ══ PUSH — browser client ═════════════════════════════════════════════════
 *  Same safety posture as strategyTraderBridge.ts: never holds a token,
 *  routes through the push-proxy Edge Function, which attaches the real
 *  server secret. Wraps subscribeToPush()/requestNotificationPermission()
 *  from src/lib/pwa.ts (the actual Push API calls) with the server round
 *  trips needed to register a subscription for real delivery.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { safeInvoke } from '@/lib/safeInvoke';
import { requestNotificationPermission, subscribeToPush } from '@/lib/pwa';

async function call<T>(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<T> {
  const { data, error } = await safeInvoke<T>('push-proxy', { body: { method, path, payload } });
  if (error) throw error;
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

export function sendPush(payload: PushPayload) {
  return call<{ ok: boolean; sent: number; pruned: number; failed: number }>('POST', '/send', payload);
}

export function sendTestPush(url = '/') {
  return sendPush({ title: 'Whale Radar', body: 'Test push — if you can see this, it works.', tag: 'whale-radar-test', url });
}
