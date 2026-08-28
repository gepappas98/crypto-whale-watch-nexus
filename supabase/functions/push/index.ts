/* ══ PUSH — Browser → Supabase Edge → DB, Express dropped entirely ═══════════
 *  Different reasoning from every other function in this series (alerts/
 *  portfolio/tracked/signal-outcomes/whale-events/whales/scans): those were
 *  ALREADY unauthenticated, direct-to-Express CRUD with no auth-token
 *  concern. Push was different — subscribe/unsubscribe/send previously went
 *  through the push-proxy Edge Function specifically so API_AUTH_TOKEN
 *  (needed to call Express) never reached the browser (see
 *  server/routes/push.ts's own docstring, and supabase/functions/push-proxy/
 *  index.ts). That reasoning evaporates once push runs natively here: there
 *  is no Express, therefore no bearer token to protect. This is why v9.40's
 *  README entry flagged push.ts as "a real candidate to drop the Express
 *  dependency entirely rather than just re-route it" — done here, not just
 *  re-routed.
 *
 *  Uses the 'web-push' npm package (RFC 8030/8291 web push + VAPID signing)
 *  via Deno's npm: specifier support — the same library server/services/
 *  pushService.ts used, just imported the Deno-compatible way instead of a
 *  package.json dependency.
 *
 *  ⚠️ push-proxy/index.ts becomes redundant once this is adopted — it exists
 *  purely to bridge to Express, which this function no longer needs. Not
 *  deleted here (same reasoning as market-data/index.ts's note in v9.40:
 *  can't rule out something outside this repo still calling it), but it's
 *  a second, more clear-cut candidate for removal once this is live.
 *
 *  VAPID keys: set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT as
 *  Edge Function secrets (`supabase secrets set`), not env vars on a server
 *  that no longer needs to run for this to work.
 *
 *  REQUEST SHAPE:
 *    GET  /push                          → { key } | 503 if unconfigured
 *    POST { op: 'subscribe', endpoint, keys: { p256dh, auth } }
 *    POST { op: 'unsubscribe', endpoint }
 *    POST { op: 'send', title, body, tag?, url? }
 * ═══════════════════════════════════════════════════════════════════════════ */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import webpush from 'npm:web-push@3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

function supabaseClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') || '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') || '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';

function isPushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}
if (isPushConfigured()) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn('[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set — push notifications disabled.');
}

interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

// ── subscribe ────────────────────────────────────────────────────────────
// Plain upsert — every column present gets overwritten on conflict, no
// COALESCE-preserve-if-absent need here (unlike tracked_tokens' coin_id in
// the tracked/index.ts migration), so no RPC needed.
async function subscribe(supabase: ReturnType<typeof supabaseClient>, body: Record<string, unknown>, userAgent: string | null) {
  if (!isPushConfigured()) throw new Error('push not configured — set VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY');
  const sub = body as unknown as PushSubscriptionInput;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    throw new Error('malformed push subscription');
  }
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        user_agent: userAgent,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    );
  if (error) throw error;
  return { ok: true };
}

// ── unsubscribe ──────────────────────────────────────────────────────────
async function unsubscribe(supabase: ReturnType<typeof supabaseClient>, endpoint: unknown) {
  if (!endpoint || typeof endpoint !== 'string') throw new Error('endpoint is required');
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) throw error;
  return { ok: true };
}

// ── send (broadcast) ─────────────────────────────────────────────────────
// No per-user targeting — subscriptions aren't tied to an account (this
// app has no login system, see push_subscriptions migration's comment),
// so this sends to every stored subscription. Any subscription web-push
// reports as gone (404/410 — browser unsubscribed, cleared site data, or
// the endpoint expired) is pruned here rather than left to fail forever on
// every future send. Ported directly from pushService.ts's sendToAll().
async function send(supabase: ReturnType<typeof supabaseClient>, body: Record<string, unknown>) {
  if (!isPushConfigured()) throw new Error('push not configured — set VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY');
  const { title, body: msgBody, tag, url } = body as { title?: string; body?: string; tag?: string; url?: string };
  if (!title || !msgBody) throw new Error('title and body are required');

  const { data: subs, error } = await supabase.from('push_subscriptions').select('endpoint, p256dh, auth');
  if (error) throw error;

  let sent = 0, pruned = 0, failed = 0;
  const payload = JSON.stringify({ title, body: msgBody, tag, url });
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      );
      sent++;
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        pruned++;
      } else {
        failed++;
        console.error('[push] send failed for one subscription:', (err as Error).message);
      }
    }
  }));
  return { ok: true, sent, pruned, failed };
}

// ── dispatch ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // GET is the VAPID-public-key fetch — deliberately kept as a plain GET
  // (no op/body needed) matching the original route, since it's meant to
  // be trivially fetchable, same spirit as it being on the old Express
  // server's PUBLIC_PATHS allowlist: a VAPID public key is meant to be
  // public, shipped to every subscribing browser regardless.
  if (req.method === 'GET') {
    if (!isPushConfigured()) {
      return json({ error: 'push not configured — set VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY' }, 503);
    }
    return json({ key: VAPID_PUBLIC_KEY });
  }

  if (req.method !== 'POST') return json({ error: 'GET or POST only' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const supabase = supabaseClient();
  try {
    switch (body.op) {
      case 'subscribe':   return json(await subscribe(supabase, body, req.headers.get('user-agent')));
      case 'unsubscribe': return json(await unsubscribe(supabase, body.endpoint));
      case 'send':          return json(await send(supabase, body));
      default:
        return json({ error: `unknown op "${String(body.op)}"` }, 400);
    }
  } catch (err) {
    console.error('[push edge function]', err);
    const status = /not configured/.test((err as Error).message) ? 503 : 502;
    return json({ error: (err as Error).message }, status);
  }
});
