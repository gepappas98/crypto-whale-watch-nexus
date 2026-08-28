/* ══ ALERTS — Browser → Supabase Edge → DB, no Express in the path ══════════
 *  Closes part of step 4 of George's production-architecture plan (Greek:
 *  "Browser → Supabase Edge → persistent state/DB → alerts"). Ports
 *  server/routes/alerts.ts's CRUD + the v9.37 decision-outcome loop to a
 *  real Edge Function talking to Postgres directly via the Supabase
 *  service-role client — no dependency on the Express server being up.
 *
 *  DELIBERATELY SCOPED, NOT A FULL MIGRATION: this is the alerts vertical
 *  slice only — the newest, most self-contained piece of server-side logic
 *  this session touched, picked specifically because it's pure CRUD + one
 *  background job with zero dependency on ccxt/exchange execution (which
 *  is why nexus-bot-proxy/trading-bridge correctly stay Express-backed —
 *  see those files' own docstrings). server/routes/alerts.ts is left
 *  running exactly as before; nothing currently in production depends on
 *  this file until src/lib/db.ts is deliberately pointed at it. Treat this
 *  as the target implementation for that cutover, not a live swap made
 *  unilaterally without deploy/test access from this sandbox.
 *
 *  WHY NOT JUST QUERY THE alerts/alert_outcomes TABLES FROM THE BROWSER
 *  DIRECTLY VIA RLS? Two of the six operations need atomicity or
 *  server-computed values a client-side RLS-scoped query can't safely do:
 *    - PATCH pin: `pinned = NOT pinned` needs to be atomic (a read-then-
 *      write from the browser risks a lost update if two tabs toggle at
 *      once) — done here via the toggle_alert_pin() RPC (see the migration
 *      alongside this function).
 *    - POST outcome: resets price_24h/outcome_24h_pct/filled_24h_at back to
 *      NULL on every re-log, which needs to happen atomically with the new
 *      action/coin_id/entry_price in the same write.
 *  The rest (GET list, GET eval, POST create, DELETE) would be safe as
 *  direct client-side Supabase queries under a well-scoped RLS policy —
 *  routed through this function anyway, for one interface instead of a
 *  split "some tables direct, some through a function" model that's
 *  harder to reason about and audit later.
 *
 *  REQUEST SHAPE — mirrors server/routes/alerts.ts's route shapes, just
 *  dispatched by an `op` field instead of HTTP method + path, since a
 *  single Edge Function handles one URL:
 *    { op: 'list' }
 *    { op: 'create', level, tag, text, sizing?, pinned?, coin_id?, entry_price? }
 *    { op: 'toggle_pin', id }
 *    { op: 'delete', id }
 *    { op: 'log_outcome', id, action: 'reviewed'|'bought', coin_id?, entry_price? }
 *    { op: 'eval' }
 *    { op: 'fill_prices' }   — meant to be called by a scheduled trigger
 *                               (pg_cron + pg_net), not the browser; see
 *                               the migration file for the schedule setup.
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

// ── list ─────────────────────────────────────────────────────────────────
// PostgREST embedding via the alerts→alert_outcomes foreign key (see the
// migration) returns outcomes as an array (0 or 1 rows, enforced by the
// unique index on alert_id) — flattened to a single object here so the
// client shape matches what server/routes/alerts.ts's raw SQL LEFT JOIN
// already returns.
async function list(supabase: ReturnType<typeof supabaseClient>, limitParam: unknown) {
  const limit = Math.min(Number(limitParam) || 100, 500);
  const { data, error } = await supabase
    .from('alerts')
    .select('*, alert_outcomes(action, outcome_24h_pct)')
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => {
    const outcomes = row.alert_outcomes as Array<{ action: string; outcome_24h_pct: number | null }> | null;
    const outcome = outcomes?.[0] ?? null;
    const { alert_outcomes: _drop, ...rest } = row;
    return { ...rest, action: outcome?.action ?? null, outcome_24h_pct: outcome?.outcome_24h_pct ?? null };
  });
}

// ── create ───────────────────────────────────────────────────────────────
async function create(supabase: ReturnType<typeof supabaseClient>, body: Record<string, unknown>) {
  const { level, tag, text, sizing, pinned, coin_id, entry_price } = body;
  if (!level || !text) throw new Error('level and text required');
  if (level === 'info') return { skipped: true }; // info alerts are ephemeral, never persisted
  const { data, error } = await supabase
    .from('alerts')
    .insert({
      level, tag: tag ?? null, text, sizing: sizing ?? null, pinned: pinned ?? false,
      coin_id: coin_id ?? null, entry_price: entry_price ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── toggle_pin ───────────────────────────────────────────────────────────
// Atomic flip via RPC — see this migration's toggle_alert_pin() function.
// A read-then-write from here (SELECT pinned, then UPDATE the opposite)
// would race two tabs toggling the same alert at once; the RPC does the
// flip inside a single UPDATE ... RETURNING on the database side.
async function togglePin(supabase: ReturnType<typeof supabaseClient>, id: unknown) {
  const alertId = Number(id);
  if (!Number.isInteger(alertId) || alertId <= 0) throw new Error('id must be a positive integer');
  const { data, error } = await supabase.rpc('toggle_alert_pin', { p_alert_id: alertId });
  if (error) throw error;
  if (!data || (Array.isArray(data) && data.length === 0)) throw new Error('Alert not found');
  return Array.isArray(data) ? data[0] : data;
}

// ── delete ───────────────────────────────────────────────────────────────
async function remove(supabase: ReturnType<typeof supabaseClient>, id: unknown) {
  const alertId = Number(id);
  if (!Number.isInteger(alertId) || alertId <= 0) throw new Error('id must be a positive integer');
  const { error } = await supabase.from('alerts').delete().eq('id', alertId);
  if (error) throw error;
  return { ok: true };
}

// ── log_outcome ──────────────────────────────────────────────────────────
// upsert with onConflict: 'alert_id' — providing price_24h/outcome_24h_pct/
// filled_24h_at as null in the payload reproduces the raw-SQL version's
// `ON CONFLICT DO UPDATE SET ... price_24h = NULL, ...` reset exactly,
// since Supabase's upsert overwrites every column present in the payload.
async function logOutcome(supabase: ReturnType<typeof supabaseClient>, id: unknown, body: Record<string, unknown>) {
  const alertId = Number(id);
  if (!Number.isInteger(alertId) || alertId <= 0) throw new Error('id must be a positive integer');
  const { action, coin_id, entry_price } = body;
  if (action !== 'reviewed' && action !== 'bought') throw new Error("action must be 'reviewed' or 'bought'");
  const { data, error } = await supabase
    .from('alert_outcomes')
    .upsert(
      {
        alert_id: alertId,
        action,
        coin_id: action === 'bought' ? (coin_id ?? null) : null,
        entry_price: action === 'bought' ? (entry_price ?? null) : null,
        created_at: new Date().toISOString(),
        price_24h: null,
        outcome_24h_pct: null,
        filled_24h_at: null,
      },
      { onConflict: 'alert_id' },
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── eval ─────────────────────────────────────────────────────────────────
// Just queries the v_alert_decision_eval view (see migration) — PostgREST
// can select from a view exactly like a table, so this is simpler than the
// raw-SQL route's inline aggregate query, not a reimplementation of it.
async function evalOutcomes(supabase: ReturnType<typeof supabaseClient>) {
  const { data, error } = await supabase
    .from('v_alert_decision_eval')
    .select('*')
    .order('avg_bought_24h_pct', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

// ── fill_prices ──────────────────────────────────────────────────────────
// Meant to be invoked on a schedule (pg_cron + pg_net calling this
// function's URL with { op: 'fill_prices' }), not from the browser — see
// the migration file for the cron setup. Same logic as
// server/routes/alerts.ts's fillAlertOutcomePrices(), ported to run here
// instead of inside the long-lived Express process's own setInterval —
// that's the actual point of this migration: a periodic DB-touching job
// shouldn't need a permanently-running server process to exist at all.
async function fillPrices(supabase: ReturnType<typeof supabaseClient>) {
  const { data: rows, error: selErr } = await supabase
    .from('alert_outcomes')
    .select('id, coin_id, entry_price')
    .eq('action', 'bought')
    .not('coin_id', 'is', null)
    .is('price_24h', null)
    .lt('created_at', new Date(Date.now() - 24 * 3_600_000).toISOString())
    .gt('created_at', new Date(Date.now() - 8 * 24 * 3_600_000).toISOString())
    .limit(30);
  if (selErr) throw selErr;
  const need = (rows ?? []) as Array<{ id: number; coin_id: string; entry_price: string }>;
  if (!need.length) return { filled: 0 };

  const coinIds = [...new Set(need.map((r) => r.coin_id))];
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
    console.error('[alerts fill_prices] CoinGecko fetch failed:', e);
    return { filled: 0 };
  }
  if (!Object.keys(prices).length) return { filled: 0 };

  let filled = 0;
  for (const row of need) {
    const p = prices[row.coin_id];
    if (!p) continue;
    const entry = parseFloat(row.entry_price);
    const pct = entry > 0 ? ((p - entry) / entry) * 100 : null;
    const { error: updErr } = await supabase
      .from('alert_outcomes')
      .update({ price_24h: p, outcome_24h_pct: pct, filled_24h_at: new Date().toISOString() })
      .eq('id', row.id);
    if (!updErr) filled++;
  }
  console.log(`[alerts fill_prices] Filled ${filled} alert-decision outcome prices`);
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
      case 'list':        return json(await list(supabase, body.limit));
      case 'create':       return json(await create(supabase, body));
      case 'toggle_pin':   return json(await togglePin(supabase, body.id));
      case 'delete':        return json(await remove(supabase, body.id));
      case 'log_outcome':  return json(await logOutcome(supabase, body.id, body));
      case 'eval':          return json(await evalOutcomes(supabase));
      case 'fill_prices':  return json(await fillPrices(supabase));
      default:
        return json({ error: `unknown op "${String(body.op)}"` }, 400);
    }
  } catch (err) {
    console.error('[alerts edge function]', err);
    return json({ error: (err as Error).message }, 500);
  }
});
