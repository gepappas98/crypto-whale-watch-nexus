/* ══ WHALES (public, GPT-Actions friendly) — Browser/agent → Edge → DB ═══════
 *  Part of the same v9.40+ migration as supabase/functions/alerts/index.ts —
 *  see that file's docstring for the general reasoning. Ports
 *  server/routes/whales.ts: a stable, agent-facing read-only mirror of
 *  whale_events with renamed fields, meant for OpenAI Custom GPT Actions /
 *  other LLM agents to call directly, unauthenticated.
 *
 *  ⚠️ DEPLOYMENT REQUIRES --no-verify-jwt — UNLIKE every other function in
 *  this migration series (alerts/portfolio/tracked/signal-outcomes/
 *  whale-events), this one is genuinely meant to be reachable without a
 *  Supabase auth token at all — that's the entire point (a GPT Action
 *  calling this has no Supabase session to attach one). Supabase Edge
 *  Functions require a valid Authorization header by default; deploy this
 *  one with:
 *      supabase functions deploy whales --no-verify-jwt
 *  Every other function in this series should KEEP default JWT
 *  verification — this is the one deliberate exception, not a pattern to
 *  copy elsewhere.
 *
 *  Also unlike the rest of this series: GET requests, not POST+op, since
 *  that's the interface GPT Actions/agents expect and the original Express
 *  route already used query params, not a JSON body — changing the
 *  interface shape here would break the "stable, agent-facing shape" this
 *  route explicitly promises to be.
 *
 *  REQUEST SHAPE (query params, GET):
 *    GET /whales?limit=10&min_usd=100000&asset=BTC
 *    GET /whales/summary
 * ═══════════════════════════════════════════════════════════════════════════ */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
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

interface WhaleRow {
  id: number;
  symbol: string | null;
  side: string | null;
  usdt: number | null;
  exchange: string | null;
  created_at: string;
}

async function listWhales(supabase: ReturnType<typeof supabaseClient>, url: URL) {
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 10, 1), 500);
  const minUsd = Math.max(Number(url.searchParams.get('min_usd')) || 100_000, 0);
  const assetRaw = url.searchParams.get('asset')?.trim().toUpperCase();

  let q = supabase
    .from('whale_events')
    .select('id, symbol, side, price, qty, usdt, exchange, created_at')
    .gte('usdt', minUsd)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (assetRaw) q = q.like('symbol', `${assetRaw}%`);

  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as WhaleRow[];

  return {
    data: rows.map((r) => ({
      tx_hash: `${r.exchange ?? 'cex'}-${r.id}`,
      asset: String(r.symbol ?? ''),
      amount_usd: Number(r.usdt ?? 0),
      transaction_type: String(r.side ?? '').toUpperCase() === 'BUY' ? 'buy' : 'sell',
      timestamp: r.created_at,
    })),
  };
}

async function whalesSummary(supabase: ReturnType<typeof supabaseClient>) {
  // Reuses the same v_whale_events_summary_24h view as whale-events/index.ts
  // — the underlying aggregate is identical, only the field names in the
  // JSON response differ (agent-facing naming vs the internal shape).
  const { data, error } = await supabase.from('v_whale_events_summary_24h').select('*');
  if (error) throw error;
  return {
    data: (data ?? []).map((r: Record<string, unknown>) => ({
      asset: String(r.symbol ?? ''),
      trades: Number(r.trades ?? 0),
      total_usd: Number(r.total_usdt ?? 0),
      buy_usd: Number(r.buy_usdt ?? 0),
      sell_usd: Number(r.sell_usdt ?? 0),
      max_trade_usd: Number(r.max_trade ?? 0),
      last_seen: String(r.last_seen ?? ''),
    })),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return json({ error: 'GET only' }, 405);

  const url = new URL(req.url);
  const supabase = supabaseClient();
  try {
    if (url.pathname.endsWith('/summary')) {
      return json(await whalesSummary(supabase));
    }
    return json(await listWhales(supabase, url));
  } catch (err) {
    console.error('[whales edge function]', err);
    // Matches the original route's degrade-gracefully shape (data: []
    // alongside the error) — a GPT Action parsing this shouldn't have to
    // handle a totally different response shape on failure.
    return json({ error: 'Data temporarily unavailable', data: [] }, 500);
  }
});
