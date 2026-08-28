/* ══ TRACKED TOKENS — Browser → Supabase Edge → DB, no Express in the path ═══
 *  Part of the same v9.40+ migration as supabase/functions/alerts/index.ts —
 *  see that file's docstring for the full reasoning. Ports
 *  server/routes/tracked.ts.
 *
 *  The one non-trivial piece: the upsert preserves the existing coin_id
 *  when the caller doesn't supply one (`COALESCE($2, tracked_tokens.coin_id)`
 *  in the original raw SQL) rather than overwriting it with NULL. A plain
 *  Supabase .upsert() always overwrites every column present in the
 *  payload, so this needs the upsert_tracked_token() RPC (migration 009)
 *  to do the COALESCE atomically in the database instead.
 *
 *  REQUEST SHAPE:
 *    { op: 'list' }
 *    { op: 'upsert', symbol, coin_id?, base_price? }
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
  const { data, error } = await supabase
    .from('tracked_tokens')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function upsertToken(supabase: ReturnType<typeof supabaseClient>, body: Record<string, unknown>) {
  const { symbol, coin_id, base_price } = body;
  if (!symbol || typeof symbol !== 'string') throw new Error('symbol required');
  const { data, error } = await supabase.rpc('upsert_tracked_token', {
    p_symbol: symbol.toUpperCase(),
    p_coin_id: coin_id ?? null,
    p_base_price: base_price ?? null,
  });
  if (error) throw error;
  if (!data || (Array.isArray(data) && data.length === 0)) throw new Error('upsert returned no row');
  return Array.isArray(data) ? data[0] : data;
}

async function remove(supabase: ReturnType<typeof supabaseClient>, symbol: unknown) {
  if (!symbol || typeof symbol !== 'string') throw new Error('symbol required');
  const { error } = await supabase.from('tracked_tokens').delete().eq('symbol', symbol.toUpperCase());
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
      case 'upsert': return json(await upsertToken(supabase, body));
      case 'delete': return json(await remove(supabase, body.symbol));
      default:
        return json({ error: `unknown op "${String(body.op)}"` }, 400);
    }
  } catch (err) {
    console.error('[tracked edge function]', err);
    return json({ error: (err as Error).message }, 500);
  }
});
