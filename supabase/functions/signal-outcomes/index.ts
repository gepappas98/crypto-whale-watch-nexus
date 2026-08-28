/* ══ SIGNAL OUTCOMES — Browser → Supabase Edge → DB, no Express in the path ══
 *  Part of the same v9.40+ migration as supabase/functions/alerts/index.ts —
 *  see that file's docstring for the full reasoning. Ports
 *  server/routes/signalOutcomes.ts, the profit-proof layer that records
 *  every CEO Signal fire and fills in 1h/4h/24h price outcomes.
 *
 *  Two non-trivial pieces, handled the same way as alerts'/tracked's were:
 *    - POST (record fire): the dedup constraint (idx_so_dedup) is on an
 *      EXPRESSION — (symbol, signal, date_trunc('hour', fired_at)) — not
 *      plain columns, so PostgREST's upsert can't target it at all. Uses
 *      the record_signal_fire() RPC (migration 010) instead, which does
 *      the exact `INSERT ... ON CONFLICT ON CONSTRAINT idx_so_dedup DO
 *      NOTHING` the original raw SQL did.
 *    - fill_prices: three separate windows (1h/4h/24h), each with its own
 *      "which rows still need this price" query and its own bulk UPDATE.
 *      Ported directly from fillOutcomePrices() — same three-window shape,
 *      same CoinGecko batching, same reasoning for each interval bound
 *      (e.g. the 25h upper bound on the 1h window: don't keep retrying a
 *      fire from a week ago just because its 1h price was never filled).
 *
 *  No ensureTable() here unlike the Express version — signal_outcomes is
 *  already created by migration 001_signal_outcomes.sql, so there's
 *  nothing to lazily create; an Edge Function assuming its schema exists
 *  (rather than creating it on first call) is the right serverless
 *  default anyway.
 *
 *  REQUEST SHAPE:
 *    { op: 'record', symbol, coin_id?, signal, score?, category?, vmcap?, entry_price }
 *    { op: 'eval' }
 *    { op: 'recent', limit?, signal? }
 *    { op: 'fill_prices' }   — meant for a scheduled trigger, see the
 *                               accompanying cron migration
 * ═══════════════════════════════════════════════════════════════════════════ */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

// ── record ───────────────────────────────────────────────────────────────
async function record(supabase: ReturnType<typeof supabaseClient>, body: Record<string, unknown>) {
  const { symbol, coin_id, signal, score, category, vmcap, entry_price } = body;
  if (!symbol || !signal || entry_price == null) {
    throw new Error('symbol, signal, entry_price required');
  }
  if (signal === 'HOLD') return { skipped: true };

  const { data, error } = await supabase.rpc('record_signal_fire', {
    p_symbol: String(symbol).toUpperCase(),
    p_coin_id: coin_id ?? null,
    p_signal: signal,
    p_score: score ?? null,
    p_category: category ?? null,
    p_vmcap: vmcap ?? null,
    p_entry_price: entry_price,
  });
  if (error) throw error;
  // ON CONFLICT DO NOTHING returns zero rows on a dedup hit — that's a
  // successful, expected outcome, not an error.
  return { ok: true, skipped: !data || data.length === 0 };
}

// ── eval ─────────────────────────────────────────────────────────────────
// v_signal_eval already exists (migration 001) and matches this exactly —
// no new view needed, just select from it like a table.
async function evalSignals(supabase: ReturnType<typeof supabaseClient>) {
  const { data, error } = await supabase
    .from('v_signal_eval')
    .select('*')
    .order('avg_4h_pct', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

// ── recent ───────────────────────────────────────────────────────────────
async function recent(supabase: ReturnType<typeof supabaseClient>, body: Record<string, unknown>) {
  const limit = Math.min(Number(body.limit) || 100, 500);
  let q = supabase.from('signal_outcomes').select('*').order('fired_at', { ascending: false }).limit(limit);
  if (typeof body.signal === 'string' && body.signal) q = q.eq('signal', body.signal);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// ── fill_prices ──────────────────────────────────────────────────────────
type FillRow = { id: number; coin_id: string | null; symbol: string; entry_price: string };

async function fetchNeeding(
  supabase: ReturnType<typeof supabaseClient>,
  priceCol: 'price_1h' | 'price_4h' | 'price_24h',
  minAgeHours: number,
  maxAgeHours: number,
): Promise<FillRow[]> {
  const { data, error } = await supabase
    .from('signal_outcomes')
    .select('id, coin_id, symbol, entry_price')
    .is(priceCol, null)
    .lt('fired_at', new Date(Date.now() - minAgeHours * 3_600_000).toISOString())
    .gt('fired_at', new Date(Date.now() - maxAgeHours * 3_600_000).toISOString())
    .limit(30);
  if (error) throw error;
  return (data ?? []) as FillRow[];
}

async function applyFill(
  supabase: ReturnType<typeof supabaseClient>,
  rows: FillRow[],
  prices: Record<string, number>,
  priceCol: 'price_1h' | 'price_4h' | 'price_24h',
  outcomeCol: 'outcome_1h' | 'outcome_4h' | 'outcome_24h',
  filledAtCol: 'filled_1h_at' | 'filled_4h_at' | 'filled_24h_at',
): Promise<number> {
  let filled = 0;
  for (const row of rows) {
    if (!row.coin_id) continue;
    const p = prices[row.coin_id];
    if (!p) continue;
    const entry = parseFloat(row.entry_price);
    const pct = entry > 0 ? ((p - entry) / entry) * 100 : null;
    const { error } = await supabase
      .from('signal_outcomes')
      .update({ [priceCol]: p, [outcomeCol]: pct, [filledAtCol]: new Date().toISOString() })
      .eq('id', row.id);
    if (!error) filled++;
  }
  return filled;
}

async function fillPrices(supabase: ReturnType<typeof supabaseClient>) {
  // Same three windows and bounds as the Express version's
  // fillOutcomePrices(): the upper bound on each stops retrying a fire old
  // enough that this price point will never be meaningful again (e.g. a
  // week-old fire's 1h price isn't worth backfilling at that point).
  const [need1h, need4h, need24h] = await Promise.all([
    fetchNeeding(supabase, 'price_1h', 1, 25),
    fetchNeeding(supabase, 'price_4h', 4, 49),
    fetchNeeding(supabase, 'price_24h', 24, 192), // 8 days
  ]);

  const allRows = [...need1h, ...need4h, ...need24h];
  if (!allRows.length) return { filled: 0 };

  const coinIds = [...new Set(allRows.map((r) => r.coin_id).filter((id): id is string => Boolean(id)))];
  if (!coinIds.length) return { filled: 0 };

  const prices: Record<string, number> = {};
  try {
    for (let i = 0; i < coinIds.length; i += 250) {
      const batch = coinIds.slice(i, i + 250);
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${batch.join(',')}&vs_currencies=usd`;
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
      if (!res.ok) continue;
      const body = (await res.json()) as Record<string, { usd?: number }>;
      for (const [id, v] of Object.entries(body)) {
        if (v.usd != null) prices[id] = v.usd;
      }
    }
  } catch (e) {
    console.error('[signal-outcomes fill_prices] CoinGecko fetch failed:', e);
    return { filled: 0 };
  }
  if (!Object.keys(prices).length) return { filled: 0 };

  const filled =
    (await applyFill(supabase, need1h, prices, 'price_1h', 'outcome_1h', 'filled_1h_at')) +
    (await applyFill(supabase, need4h, prices, 'price_4h', 'outcome_4h', 'filled_4h_at')) +
    (await applyFill(supabase, need24h, prices, 'price_24h', 'outcome_24h', 'filled_24h_at'));

  if (filled > 0) console.log(`[signal-outcomes fill_prices] Filled ${filled} outcome prices`);
  return { filled };
}

// ── dispatch ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const supabase = supabaseClient();
  try {
    switch (body.op) {
      case 'record':      return json(await record(supabase, body));
      case 'eval':         return json(await evalSignals(supabase));
      case 'recent':       return json(await recent(supabase, body));
      case 'fill_prices': return json(await fillPrices(supabase));
      default:
        return json({ error: `unknown op "${String(body.op)}"` }, 400);
    }
  } catch (err) {
    console.error('[signal-outcomes edge function]', err);
    return json({ error: (err as Error).message }, 500);
  }
});
