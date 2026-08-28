/* ══ SCANS — Browser → Supabase Edge → DB, no Express in the path ═══════════
 *  Part of the same v9.40+ migration as supabase/functions/alerts/index.ts —
 *  see that file's docstring for the general reasoning. Ports
 *  server/routes/scans.ts.
 *
 *  Three non-trivial pieces:
 *    - POST (persist a scan): the original raw SQL hand-built a multi-row
 *      INSERT with dynamically-computed $N placeholders for scan_coins (a
 *      spot that had a real off-by-one bug once — see that file's own
 *      comment: "was wrongly 13, causing corrupt $N offsets for i > 0").
 *      Supabase's .insert() natively accepts an ARRAY of row objects and
 *      does the bulk insert itself — no hand-built placeholder arithmetic
 *      at all, which structurally can't have that class of bug again.
 *    - GET /symbol/:sym: a JOIN between scan_coins and scan_sessions (for
 *      the session's scanned_at) — done via PostgREST's foreign-key
 *      embedding (scan_coins.session_id → scan_sessions.id, an actual FK,
 *      not a manual join) rather than raw SQL.
 *    - GET /threats/top: a GROUP BY + CASE/ARRAY worst-threat ranking with
 *      no PostgREST equivalent, exposed via v_scan_top_threats (migration
 *      012) instead of reimplemented here.
 *
 *  REQUEST SHAPE:
 *    { op: 'record', coins: [...] }
 *    { op: 'list' }
 *    { op: 'symbol', sym }
 *    { op: 'top_threats' }
 *    { op: 'session', id }
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
  const coins = body.coins as Record<string, unknown>[] | undefined;
  if (!Array.isArray(coins) || coins.length === 0) throw new Error('coins array required');

  const critCount = coins.filter((c) => c.threat === 'CRITICAL').length;
  const highCount = coins.filter((c) => c.threat === 'HIGH').length;

  const { data: session, error: sessionErr } = await supabase
    .from('scan_sessions')
    .insert({ coin_count: coins.length, crit_count: critCount, high_count: highCount })
    .select('id')
    .single();
  if (sessionErr) throw sessionErr;

  // Bulk insert — .insert() accepts an array natively, no hand-built
  // placeholder SQL (see this file's header comment on why that matters).
  const rows = coins.map((c) => ({
    session_id: session.id,
    symbol: c.symbol,
    name: c.name ?? null,
    rank: c.rank ?? null,
    price: c.price ?? null,
    change_24h: c.change ?? null,
    volume: c.volume ?? null,
    mcap: c.mcap ?? null,
    vmcap: c.vmcap ?? null,
    vol_spike: c.volSpike ?? null,
    score: c.score ?? null,
    threat: c.threat ?? null,
    category: c.category ?? null,
    confidence: c.confidence ?? null,
    reasons: c.reasons ?? [],
    is_sol: c.isSol ?? false,
    bird_data: c.birdData ?? null,
  }));
  const { error: coinsErr } = await supabase.from('scan_coins').insert(rows);
  if (coinsErr) throw coinsErr;

  return { session_id: session.id, saved: coins.length };
}

// ── list ─────────────────────────────────────────────────────────────────
async function list(supabase: ReturnType<typeof supabaseClient>) {
  const { data, error } = await supabase
    .from('scan_sessions')
    .select('id, scanned_at, coin_count, crit_count, high_count')
    .order('scanned_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

// ── symbol history ──────────────────────────────────────────────────────
// FK embedding (scan_coins.session_id → scan_sessions.id) stands in for the
// original route's manual JOIN. PostgREST nests the related row as a
// single object (not an array) here since this is the many→one direction —
// flattened below to match the original route's flat response shape.
async function symbolHistory(supabase: ReturnType<typeof supabaseClient>, sym: unknown) {
  if (!sym || typeof sym !== 'string') throw new Error('sym required');
  const { data, error } = await supabase
    .from('scan_coins')
    .select('score, threat, category, vmcap, price, change_24h, scan_sessions(scanned_at)')
    .eq('symbol', sym.toUpperCase())
    .order('scanned_at', { ascending: false, referencedTable: 'scan_sessions' })
    .limit(90);
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => {
    const session = row.scan_sessions as { scanned_at: string } | null;
    const { scan_sessions: _drop, ...rest } = row;
    return { ...rest, scanned_at: session?.scanned_at ?? null };
  });
}

// ── top threats ──────────────────────────────────────────────────────────
async function topThreats(supabase: ReturnType<typeof supabaseClient>) {
  const { data, error } = await supabase.from('v_scan_top_threats').select('*');
  if (error) throw error;
  return data ?? [];
}

// ── single session's coins ──────────────────────────────────────────────
async function session(supabase: ReturnType<typeof supabaseClient>, id: unknown) {
  const sessionId = Number(id);
  if (!Number.isInteger(sessionId) || sessionId <= 0) throw new Error('id must be a positive integer');
  const { data, error } = await supabase
    .from('scan_coins')
    .select('*')
    .eq('session_id', sessionId)
    .order('score', { ascending: false });
  if (error) throw error;
  return data ?? [];
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
      case 'list':          return json(await list(supabase));
      case 'symbol':        return json(await symbolHistory(supabase, body.sym));
      case 'top_threats':  return json(await topThreats(supabase));
      case 'session':      return json(await session(supabase, body.id));
      default:
        return json({ error: `unknown op "${String(body.op)}"` }, 400);
    }
  } catch (err) {
    console.error('[scans edge function]', err);
    return json({ error: (err as Error).message }, 500);
  }
});
