/* ══ PUSH SERVICE — VAPID web push ═══════════════════════════════════════════
 *  The half that was actually missing for src/lib/pwa.ts's subscribeToPush()/
 *  triggerBackgroundSync() to do anything real (see README's Roadmap for the
 *  full history — the OLD public/sw.js was a self-unregistering kill switch,
 *  not a real service worker; that's fixed alongside this file).
 *
 *  Uses the 'web-push' npm package (RFC 8030/8291 web push + VAPID signing).
 *  No per-user targeting: subscriptions aren't tied to an account because
 *  this app has no login system — see push_subscriptions migration's
 *  comment. sendToAll() is a broadcast.
 * ═══════════════════════════════════════════════════════════════════════════ */
import webpush from 'web-push';
import { query } from '../db';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

export function isPushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

if (isPushConfigured()) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn('[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set — push notifications disabled. Generate a pair with: npx web-push generate-vapid-keys');
}

export function getVapidPublicKey(): string | null {
  return isPushConfigured() ? VAPID_PUBLIC_KEY : null;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function saveSubscription(sub: PushSubscriptionInput, userAgent?: string): Promise<void> {
  await query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent, last_seen_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, last_seen_at = now()`,
    [sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent ?? null]
  );
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}

/** Sends to every stored subscription. Any subscription the push service
 *  reports as gone (HTTP 404/410 — the browser unsubscribed, cleared site
 *  data, or the endpoint expired) is deleted here rather than left to fail
 *  forever on every future send. Returns a small summary, never throws. */
export async function sendToAll(payload: PushPayload): Promise<{ sent: number; pruned: number; failed: number }> {
  if (!isPushConfigured()) throw new Error('push not configured — set VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY');

  const subs = await query<{ endpoint: string; p256dh: string; auth: string }>(
    `SELECT endpoint, p256dh, auth FROM push_subscriptions`
  );

  let sent = 0, pruned = 0, failed = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload)
      );
      sent++;
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await removeSubscription(s.endpoint).catch(() => {});
        pruned++;
      } else {
        failed++;
        console.error('[push] send failed for one subscription:', (err as Error).message);
      }
    }
  }));

  return { sent, pruned, failed };
}
