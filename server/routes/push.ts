/* ══ PUSH — /api/push routes ══════════════════════════════════════════════════
 *  GET /vapid-public-key is on index.ts's PUBLIC_PATHS allowlist (a VAPID
 *  public key is, by design, meant to be public — it's shipped to every
 *  subscribing browser regardless). /subscribe, /unsubscribe, and /send are
 *  behind the normal bearer-token check — the browser reaches them via the
 *  push-proxy Edge Function, same indirection pattern as nexus-bot-proxy,
 *  so the token itself never reaches the browser.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { Router, Request, Response } from 'express';
import {
  isPushConfigured, getVapidPublicKey, saveSubscription, removeSubscription, sendToAll,
  type PushSubscriptionInput,
} from '../services/pushService';

export const pushRouter = Router();

pushRouter.get('/vapid-public-key', (_req: Request, res: Response) => {
  const key = getVapidPublicKey();
  if (!key) return res.status(503).json({ error: 'push not configured — set VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY' });
  res.json({ key });
});

pushRouter.post('/subscribe', async (req: Request, res: Response) => {
  if (!isPushConfigured()) return res.status(503).json({ error: 'push not configured' });
  const sub = req.body as PushSubscriptionInput;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return res.status(400).json({ error: 'malformed push subscription' });
  }
  try {
    await saveSubscription(sub, req.headers['user-agent'] as string | undefined);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

pushRouter.post('/unsubscribe', async (req: Request, res: Response) => {
  const { endpoint } = req.body as { endpoint?: string };
  if (!endpoint) return res.status(400).json({ error: 'endpoint is required' });
  try {
    await removeSubscription(endpoint);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// POST /send — broadcast to every subscribed browser. Reachable from the
// "Send Test Push" button in Settings, and automatically from a CRITICAL
// alert (client-side throttled to at most once/60s — see Index.tsx's
// addAlert). Anything more targeted than "everyone subscribed" would need
// real auth first — see push_subscriptions migration's comment.
pushRouter.post('/send', async (req: Request, res: Response) => {
  if (!isPushConfigured()) return res.status(503).json({ error: 'push not configured' });
  const { title, body, tag, url } = req.body as { title?: string; body?: string; tag?: string; url?: string };
  if (!title || !body) return res.status(400).json({ error: 'title and body are required' });
  try {
    const result = await sendToAll({ title, body, tag, url });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});
