/* ══ WHALE EVENTS — Browser → Supabase Edge → DB, no Express in the path ═════
 *  Part of the same v9.40+ migration as supabase/functions/alerts/index.ts —
 *  see that file's docstring for the full reasoning. Ports
 *  server/routes/whaleEvents.ts.
 *
 *  Only non-trivial piece: /summary's GROUP BY + CASE aggregate, exposed
 *  via v_whale_events_summary_24h (migration 012) rather than reimplemented
 *  here — PostgREST can select a view exactly like a table.
 *
 *  REQUEST SHAPE:
 *    { op: 'record', symbol, side, usdt, price?, qty?, exchange? }
 *    { op: 'list', limit?, symbol? }
 *    { op: 'summary' }
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

async function record(supabase: ReturnType<typeof supabaseClient>, body: Record<string, unknown>) {
  const { symbol, side, price, qty, usdt, exchange } = body;
  if (!symbol || !side || !usdt) throw new Error('symbol, side, usdt required');
  const { data, error } = await supabase
    .from('whale_events')
    .insert({
      symbol: String(symbol).toUpperCase(),
      side: String(side).toUpperCase(),
      price: price ?? null,
      qty: qty ?? null,
      usdt,
      exchange: exchange ?? null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return { ok: true, id: data.id };
}

async function list(supabase: ReturnType<typeof supabaseClient>, body: Record<string, unknown>) {
  const limit = Math.min(Number(body.limit) || 200, 1000);
  let q = supabase.from('whale_events').select('*').order('created_at', { ascending: false }).limit(limit);
  if (typeof body.symbol === 'string' && body.symbol) q = q.eq('symbol', body.symbol.toUpperCase());
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

async function summary(supabase: ReturnType<typeof supabaseClient>) {
  const { data, error } = await supabase.from('v_whale_events_summary_24h').select('*');
  if (error) throw error;
  return data ?? [];
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
      case 'record':  return json(await record(supabase, body));
      case 'list':    return json(await list(supabase, body));
      case 'summary': return json(await summary(supabase));
      default:
        return json({ error: `unknown op "${String(body.op)}"` }, 400);
    }
  } catch (err) {
    console.error('[whale-events edge function]', err);
    return json({ error: (err as Error).message }, 500);
  }
});
