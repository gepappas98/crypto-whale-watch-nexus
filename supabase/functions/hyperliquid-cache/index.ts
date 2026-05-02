// ══ HYPERLIQUID CACHE — Supabase Edge Function ════════════════════════════════
//
// Proxies and caches Hyperliquid TRADING API calls server-side.
// FIX: Was calling api.hypurrscan.io (block explorer — no perp data).
//      Now calls api.hyperliquid.xyz/info (trading API — real perp data).
//
// Endpoints served (via ?type=):
//   metaAndAssetCtxs → POST /info  (3 000ms TTL) ← main dashboard data
//   allMids          → POST /info  (1 000ms TTL)
//   meta             → POST /info  (30 000ms TTL) — rarely changes
//   fundingHistory   → POST /info  (5 000ms TTL)  — requires ?coin=BTC
//   l2Book           → POST /info  (1 000ms TTL)  — requires ?coin=BTC
//   clearinghouse    → POST /info  (3 000ms TTL)  — requires ?address=0x…
//
// Rate limiting: same Postgres counter as before (200 req/min hard cap).
// ══════════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  corsHeaders,
  optionsResponse,
  jsonResponse,
  errorResponse,
} from '../_shared/cors.ts';

// ── Constants ─────────────────────────────────────────────────────────────────

const HL_API = 'https://api.hyperliquid.xyz/info';   // ← THE FIX
const MAX_REQUESTS_PER_MIN = 200;
const STALE_PURGE_MS = 10_000;

type CacheType =
  | 'metaAndAssetCtxs'
  | 'allMids'
  | 'meta'
  | 'fundingHistory'
  | 'l2Book'
  | 'clearinghouse';

const TTL_MAP: Record<CacheType, number> = {
  metaAndAssetCtxs: 3_000,
  allMids:          1_000,
  meta:            30_000,
  fundingHistory:   5_000,
  l2Book:           1_000,
  clearinghouse:    3_000,
};

// ── Supabase client (service role — bypasses RLS) ─────────────────────────────

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// ── Rate limit check (unchanged from original) ────────────────────────────────

async function checkRateLimit(): Promise<{ allowed: boolean; remaining: number }> {
  const windowKey = new Date().toISOString().slice(0, 16);
  const { data, error } = await supabase.rpc('increment_hl_counter', {
    p_window: windowKey,
    p_max: MAX_REQUESTS_PER_MIN,
  });
  if (error) {
    console.warn('[HLCache] rate-limit RPC error, soft-allowing:', error.message);
    return { allowed: true, remaining: MAX_REQUESTS_PER_MIN };
  }
  const count: number = data ?? 0;
  return {
    allowed: count <= MAX_REQUESTS_PER_MIN,
    remaining: Math.max(0, MAX_REQUESTS_PER_MIN - count),
  };
}

// ── Cache helpers (unchanged from original) ───────────────────────────────────

async function readCache(key: string): Promise<{ payload: unknown; age_ms: number } | null> {
  const { data, error } = await supabase
    .from('hyperliquid_cache')
    .select('payload, fetched_at')
    .eq('cache_key', key)
    .single();
  if (error || !data) return null;
  const age_ms = Date.now() - new Date(data.fetched_at).getTime();
  return { payload: data.payload, age_ms };
}

async function writeCache(key: string, payload: unknown, ttl_ms: number): Promise<void> {
  await supabase
    .from('hyperliquid_cache')
    .upsert({ cache_key: key, payload, fetched_at: new Date().toISOString(), ttl_ms });
}

function purgeStaleRows(): void {
  const cutoff = new Date(Date.now() - STALE_PURGE_MS).toISOString();
  supabase
    .from('hyperliquid_cache')
    .delete()
    .lt('fetched_at', cutoff)
    .then(() => {}, () => {});
}

// ── Hyperliquid Trading API fetchers ──────────────────────────────────────────

async function hlPost(body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(HL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Hyperliquid API ${res.status}: ${await res.text()}`);
  return res.json();
}

// Returns merged array of markets + summary totals (powers the Whale Watch cards)
async function fetchMetaAndAssetCtxs(): Promise<unknown> {
  const data = await hlPost({ type: 'metaAndAssetCtxs' }) as [
    { universe: Array<{ name: string; szDecimals: number; maxLeverage: number }> },
    Array<{
      funding: string;
      openInterest: string;
      prevDayPx: string;
      dayNtlVlm: string;
      premium: string | null;
      oraclePx: string;
      markPx: string;
      midPx: string | null;
    }>
  ];

  const universe = data[0].universe;
  const ctxs     = data[1];

  const markets = universe.map((asset, i) => {
    const ctx        = ctxs[i] ?? {};
    const markPx     = parseFloat(ctx.markPx     ?? '0');
    const oraclePx   = parseFloat(ctx.oraclePx   ?? '0');
    const oi         = parseFloat(ctx.openInterest ?? '0');
    const funding    = parseFloat(ctx.funding     ?? '0');
    const dayVolUsd  = parseFloat(ctx.dayNtlVlm   ?? '0');
    const premium    = ctx.premium != null
      ? parseFloat(ctx.premium)
      : oraclePx > 0 ? (markPx - oraclePx) / oraclePx : 0;

    return {
      asset:           asset.name,
      markPx,
      oraclePx,
      premium,           // fraction e.g. 0.0002 = 0.02 %
      funding,           // 8-h rate as fraction
      openInterest:    oi,
      openInterestUsd: oi * markPx,
      dayVolumeUsd:    dayVolUsd,
      maxLeverage:     asset.maxLeverage,
      szDecimals:      asset.szDecimals,
    };
  });

  const totalOiUsd  = markets.reduce((s, m) => s + m.openInterestUsd, 0);
  const totalVolUsd = markets.reduce((s, m) => s + m.dayVolumeUsd, 0);
  const avgFunding  = markets.length > 0
    ? markets.reduce((s, m) => s + m.funding, 0) / markets.length
    : 0;

  return {
    markets,
    summary: {
      totalOiUsd,
      totalVolUsd,
      avgFunding8h: avgFunding,
      marketCount:  markets.length,
    },
    fetchedAt: new Date().toISOString(),
  };
}

// All mid prices { BTC: "104200.5", ETH: "2510.0", ... }
async function fetchAllMids(): Promise<unknown> {
  return hlPost({ type: 'allMids' });
}

// Universe metadata only (asset names, limits, etc.)
async function fetchMeta(): Promise<unknown> {
  return hlPost({ type: 'meta' });
}

// Hourly funding history for one coin — startTime in ms (defaults to 24h ago)
async function fetchFundingHistory(coin: string, startTime: number): Promise<unknown> {
  return hlPost({ type: 'fundingHistory', coin, startTime });
}

// L2 order book snapshot for one coin
async function fetchL2Book(coin: string): Promise<unknown> {
  return hlPost({ type: 'l2Book', coin });
}

// Perpetual account state for one address
async function fetchClearinghouse(address: string): Promise<unknown> {
  return hlPost({ type: 'clearinghouseState', user: address });
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

async function fetchFresh(
  type: CacheType,
  coin?: string,
  address?: string,
  startTime?: number,
): Promise<unknown> {
  switch (type) {
    case 'metaAndAssetCtxs': return fetchMetaAndAssetCtxs();
    case 'allMids':          return fetchAllMids();
    case 'meta':             return fetchMeta();
    case 'fundingHistory':   return fetchFundingHistory(coin!, startTime ?? Date.now() - 86_400_000);
    case 'l2Book':           return fetchL2Book(coin!);
    case 'clearinghouse':    return fetchClearinghouse(address!);
    default: throw new Error(`Unknown cache type: ${type}`);
  }
}

function cacheKey(type: CacheType, coin?: string, address?: string): string {
  if (coin)    return `${type}:${coin.toUpperCase()}`;
  if (address) return `${type}:${address.toLowerCase()}`;
  return type;
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return optionsResponse();
  if (req.method !== 'GET')    return errorResponse('Method not allowed', 405);

  const url       = new URL(req.url);
  const type      = url.searchParams.get('type') as CacheType | null;
  const coin      = url.searchParams.get('coin')      ?? undefined;
  const address   = url.searchParams.get('address')   ?? undefined;
  const startTime = url.searchParams.get('startTime') ? parseInt(url.searchParams.get('startTime')!, 10) : undefined;
  const debug     = url.searchParams.get('debug') === '1';

  // Default to the main dashboard endpoint if no type supplied
  const resolvedType: CacheType = (type && TTL_MAP[type]) ? type : 'metaAndAssetCtxs';

  if (type && !TTL_MAP[type]) {
    return errorResponse(
      `Invalid ?type=. Valid: ${Object.keys(TTL_MAP).join(', ')}`,
      400,
    );
  }

  if ((resolvedType === 'fundingHistory' || resolvedType === 'l2Book') && !coin) {
    return errorResponse('?coin= required for this type (e.g. ?coin=BTC)', 400);
  }

  if (resolvedType === 'clearinghouse' && !address) {
    return errorResponse('?address= required for clearinghouse type', 400);
  }

  const key = cacheKey(resolvedType, coin, address);
  const ttl = TTL_MAP[resolvedType];
  const now = Date.now();

  // ── 1. Try cache ────────────────────────────────────────────────────────────

  const cached = await readCache(key);

  if (cached && cached.age_ms < ttl) {
    const extraHeaders: Record<string, string> = {
      'X-Cache':     'HIT',
      'X-Cache-Age': String(cached.age_ms),
      'X-Cache-TTL': String(ttl),
    };
    if (debug) extraHeaders['X-Cache-Key'] = key;
    purgeStaleRows();
    return jsonResponse(
      { data: cached.payload, cached: true, age_ms: cached.age_ms, ts: now },
      200,
      extraHeaders,
    );
  }

  // ── Stale-while-revalidate (within 3× TTL) ──────────────────────────────────

  const staleWindow = ttl * 3;
  if (cached && cached.age_ms < staleWindow) {
    (async () => {
      try {
        const rl = await checkRateLimit();
        if (!rl.allowed) return;
        const fresh = await fetchFresh(resolvedType, coin, address, startTime);
        await writeCache(key, fresh, ttl);
      } catch (e) {
        console.error('[HLCache] Background revalidation failed:', e);
      }
    })();
    return jsonResponse(
      { data: cached.payload, cached: true, stale: true, age_ms: cached.age_ms, ts: now },
      200,
      { 'X-Cache': 'STALE', 'X-Cache-Age': String(cached.age_ms) },
    );
  }

  // ── 2. Rate limit check ─────────────────────────────────────────────────────

  const rl = await checkRateLimit();
  if (!rl.allowed) {
    if (cached) {
      return jsonResponse(
        { data: cached.payload, cached: true, rateLimited: true, age_ms: cached.age_ms, ts: now },
        200,
        { 'X-Cache': 'RATE-LIMITED', 'X-RateLimit-Remaining': '0' },
      );
    }
    return errorResponse('Rate limited (200/min) and no cached data', 429);
  }

  // ── 3. Fresh fetch from Hyperliquid trading API ─────────────────────────────

  try {
    const fetchStart = Date.now();
    const freshData  = await fetchFresh(resolvedType, coin, address, startTime);
    const fetchMs    = Date.now() - fetchStart;

    writeCache(key, freshData, ttl).catch((e) =>
      console.error('[HLCache] writeCache failed:', e),
    );
    purgeStaleRows();

    return jsonResponse(
      { data: freshData, cached: false, fetch_ms: fetchMs, ts: now },
      200,
      {
        'X-Cache':               'MISS',
        'X-Fetch-Ms':            String(fetchMs),
        'X-RateLimit-Remaining': String(rl.remaining),
      },
    );
  } catch (err) {
    console.error('[HLCache] Fetch failed:', err);
    if (cached) {
      return jsonResponse(
        { data: cached.payload, cached: true, stale: true, error: (err as Error).message, age_ms: cached.age_ms, ts: now },
        200,
        { 'X-Cache': 'ERROR-FALLBACK' },
      );
    }
    return errorResponse(`Upstream fetch failed: ${(err as Error).message}`, 502);
  }
});
