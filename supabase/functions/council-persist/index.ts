/* ══ COUNCIL PERSIST ══════════════════════════════════════════════════════════
 * Server-side writer for council_decisions.
 *
 * The table's INSERT/UPDATE grants are restricted to the service role, so all
 * writes funnel through here. Two narrow, validated operations are exposed:
 *
 *   save                — insert one decision with a strictly validated shape
 *   update_performance  — recompute realised performance from a SERVER-fetched
 *                         live price; callers cannot supply the numbers
 *
 * This prevents anonymous clients from forging decisions or tampering with the
 * stored verdict/performance analytics.
 */
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

// Must stay in sync with CouncilVerdict in src/types/council.ts — this used
// to list a stale set ('HOLD'/'WAIT' instead of the real 'NEUTRAL'/
// 'STRONG_LONG'/'STRONG_SHORT'), which silently rejected every decision
// except plain LONG/SHORT/AVOID and meant memory never persisted for most
// calls. Verified against the actual enum, not re-guessed.
const VERDICTS = new Set(['STRONG_LONG', 'LONG', 'NEUTRAL', 'SHORT', 'STRONG_SHORT', 'AVOID']);
const DEPTHS = new Set(['quick', 'standard', 'deep']);

/** Cap a JSON blob's serialised size so a caller can't stuff the table. */
function boundedJson(value: unknown, maxBytes: number, field: string): unknown {
  const encoded = JSON.stringify(value ?? null);
  if (encoded.length > maxBytes) {
    throw new Error(`${field} exceeds ${maxBytes} bytes`);
  }
  return value ?? null;
}

function cleanSymbol(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('symbol is required');
  const sym = raw.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,20}$/.test(sym)) throw new Error('symbol is invalid');
  return sym;
}

async function fetchLivePrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const body = await res.json();
    const price = Number(body?.price);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

/** Which realised-return bucket a decision of this age falls into. */
/** Which realised-return bucket a decision of this age falls into. 30d added
 *  for 'swing'/'position' time-horizon calls — the old 7d ceiling meant a
 *  multi-week thesis never got a performance reading past its first week. */
function bucketFor(ageMs: number): string | null {
  if (ageMs >= 30 * 864e5) return '30d';
  if (ageMs >= 7 * 864e5) return '7d';
  if (ageMs >= 864e5) return '24h';
  if (ageMs >= 4 * 36e5) return '4h';
  if (ageMs >= 36e5) return '1h';
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const body = await req.json();
    const action = body?.action;

    // ── Insert a new decision ────────────────────────────────────────────────
    if (action === 'save') {
      const p = body.payload ?? {};
      const symbol = cleanSymbol(p.symbol);

      if (!VERDICTS.has(p.final_verdict)) throw new Error('final_verdict is invalid');
      if (!DEPTHS.has(p.depth)) throw new Error('depth is invalid');

      const conviction = Number(p.conviction);
      if (!Number.isFinite(conviction) || conviction < 0 || conviction > 100) {
        throw new Error('conviction must be between 0 and 100');
      }

      const priceAt = p.price_at === null || p.price_at === undefined ? null : Number(p.price_at);
      if (priceAt !== null && (!Number.isFinite(priceAt) || priceAt <= 0)) {
        throw new Error('price_at is invalid');
      }

      const row = {
        symbol,
        token_id: typeof p.token_id === 'string' ? p.token_id.slice(0, 120) : null,
        depth: p.depth,
        final_verdict: p.final_verdict,
        conviction,
        decision: boundedJson(p.decision, 200_000, 'decision'),
        context: boundedJson(p.context, 200_000, 'context'),
        transcript: boundedJson(p.transcript, 400_000, 'transcript'),
        price_at: priceAt,
        reflection: typeof p.reflection === 'string' ? p.reflection.slice(0, 8000) : null,
        // performance is never client-supplied; it starts empty.
        performance: {},
      };

      const { data, error } = await supabase
        .from('council_decisions')
        .insert(row)
        .select('id')
        .single();

      if (error) {
        console.error('[council-persist] insert failed:', error.message);
        return json({ error: 'Could not save decision', details: error.message }, 500);
      }
      return json({ id: data.id });
    }

    // ── Recompute performance from a server-fetched price ────────────────────
    if (action === 'update_performance') {
      const id = body.id;
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
        throw new Error('id is invalid');
      }

      const { data: row, error: readErr } = await supabase
        .from('council_decisions')
        .select('id, symbol, price_at, created_at, performance')
        .eq('id', id)
        .single();

      if (readErr || !row) return json({ error: 'Decision not found' }, 404);
      if (!row.price_at) return json({ performance: row.performance ?? {} });

      const bucket = bucketFor(Date.now() - new Date(row.created_at).getTime());
      if (!bucket) return json({ performance: row.performance ?? {} });

      const live = await fetchLivePrice(row.symbol);
      if (live === null) return json({ performance: row.performance ?? {} });

      const ret = Number((((live - row.price_at) / row.price_at) * 100).toFixed(2));
      const performance = { ...(row.performance ?? {}), [bucket]: ret };

      const { error: updErr } = await supabase
        .from('council_decisions')
        .update({ performance })
        .eq('id', id);

      if (updErr) {
        console.error('[council-persist] update failed:', updErr.message);
        return json({ error: 'Could not update performance', details: updErr.message }, 500);
      }
      return json({ performance });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Bad request';
    console.error('[council-persist] rejected:', message);
    return json({ error: message }, 400);
  }
});
