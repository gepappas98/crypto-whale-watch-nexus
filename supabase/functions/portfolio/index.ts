/* ══ PORTFOLIO — Browser → Supabase Edge → DB, no Express in the path ═══════
 *  Part of the same v9.40+ migration as supabase/functions/alerts/index.ts —
 *  see that file's docstring for the full reasoning (why this vertical
 *  slice, why not just RLS-scoped direct client queries, why the Express
 *  version stays running unswapped). Ports server/routes/portfolio.ts.
 *
 *  The one non-trivial piece: GET's LATERAL JOIN against the latest
 *  scan_coins row per symbol has no PostgREST equivalent, so it's exposed
 *  via the v_portfolio_with_pnl view (migration 008) instead of reimplemented
 *  here — PostgREST can select from a view exactly like a table.
 *
 *  REQUEST SHAPE:
 *    { op: 'list' }
 *    { op: 'upsert', symbol, amount, entry_price }
 *    { op: 'delete', symbol }
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

async function list(supabase: ReturnType<typeof supabaseClient>) {
  const { data, error } = await supabase.from('v_portfolio_with_pnl').select('*');
  if (error) throw error;
  return data ?? [];
}

// Full-overwrite upsert — unlike tracked_tokens' coin_id, nothing here needs
// a COALESCE-preserve-if-absent, so this is a plain .upsert() rather than
// needing its own RPC (compare tracked/index.ts's upsertToken()).
async function upsert(supabase: ReturnType<typeof supabaseClient>, body: Record<string, unknown>) {
  const { symbol, amount, entry_price } = body;
  if (!symbol || amount == null || entry_price == null) {
    throw new Error('symbol, amount, entry_price required');
  }
  if (Number(entry_price) <= 0) {
    throw new Error('entry_price must be greater than 0');
  }
  const { data, error } = await supabase
    .from('portfolio')
    .upsert(
      { symbol: String(symbol).toUpperCase(), amount, entry_price, updated_at: new Date().toISOString() },
      { onConflict: 'symbol' },
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function remove(supabase: ReturnType<typeof supabaseClient>, symbol: unknown) {
  if (!symbol || typeof symbol !== 'string') throw new Error('symbol required');
  const { error } = await supabase.from('portfolio').delete().eq('symbol', symbol.toUpperCase());
  if (error) throw error;
  return { ok: true };
}

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
      case 'list':   return json(await list(supabase));
      case 'upsert': return json(await upsert(supabase, body));
      case 'delete': return json(await remove(supabase, body.symbol));
      default:
        return json({ error: `unknown op "${String(body.op)}"` }, 400);
    }
  } catch (err) {
    console.error('[portfolio edge function]', err);
    return json({ error: (err as Error).message }, 500);
  }
});
