// ══ HYPERLIQUID CACHE — Supabase Edge Function ════════════════════════════════
// Proxies and caches Hypurrscan API calls server-side.
//
// Endpoints served (via ?type=):
//   blocks          → GET /api/recentBlocks       (500ms TTL)
//   txs             → GET /api/recentTxs          (500ms TTL)
//   address         → GET /api/address/:addr       (2000ms TTL)
//   balance         → RPC rpc.hypurrscan.io        (2000ms TTL)
//   leaderboard     → GET /api/leaderboard         (5000ms TTL)
//
// Rate limiting: tracks outgoing Hypurrscan calls in a Postgres counter table.
// Hard cap: 200 requests/minute (≈ 3.3/sec).
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

const HYPURRSCAN_API = 'https://api.hypurrscan.io';
const HYPURRSCAN_RPC = 'https://rpc.hypurrscan.io';
const MAX_REQUESTS_PER_MIN = 200;
const STALE_PURGE_MS = 10_000; // purge cache rows older than 10s

type CacheType = 'blocks' | 'txs' | 'address' | 'balance' | 'leaderboard';

const TTL_MAP: Record<CacheType, number> = {
  blocks:      500,
  txs:         500,
  address:     2_000,
  balance:     2_000,
  leaderboard: 5_000,
};

// ── Supabase client (service role — bypasses RLS) ─────────────────────────────

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// ── Rate limit check ──────────────────────────────────────────────────────────

async function checkRateLimit(): Promise<{ allowed: boolean; remaining: number }> {
  // Minute-bucket key e.g. "2024-01-15T14:32"
  const windowKey = new Date().toISOString().slice(0, 16);

  // Upsert atomically via Postgres function pattern
  const { data, error } = await supabase.rpc('increment_hl_counter', {
    p_window: windowKey,
    p_max: MAX_REQUESTS_PER_MIN,
  });

  // If the RPC doesn't exist yet (first deploy), fall back gracefully
  if (error) {
    // Soft-allow if we can't check — log and continue
    console.warn('[HLCache] rate-limit RPC error, soft-allowing:', error.message);
    return { allowed: true, remaining: MAX_REQUESTS_PER_MIN };
  }

  const count: number = data ?? 0;
  return {
    allowed: count <= MAX_REQUESTS_PER_MIN,
    remaining: Math.max(0, MAX_REQUESTS_PER_MIN - count),
  };
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

async function readCache(key: string): Promise<{
  payload: unknown;
  age_ms: number;
} | null> {
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

// Fire-and-forget stale row purge (non-blocking)
function purgeStaleRows(): void {
  const cutoff = new Date(Date.now() - STALE_PURGE_MS).toISOString();
  supabase
    .from('hyperliquid_cache')
    .delete()
    .lt('fetched_at', cutoff)
    .then(() => {})
    .catch(() => {});
}

// ── Hypurrscan fetchers ───────────────────────────────────────────────────────

async function fetchBlocks(): Promise<unknown> {
  const res = await fetch(`${HYPURRSCAN_API}/api/recentBlocks`, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'WhaleRadar/9.0' },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`Hypurrscan blocks ${res.status}`);
  return res.json();
}

async function fetchRecentTxs(): Promise<unknown> {
  const res = await fetch(`${HYPURRSCAN_API}/api/recentTxs`, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'WhaleRadar/9.0' },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`Hypurrscan txs ${res.status}`);
  return res.json();
}

async function fetchAddress(addr: string): Promise<unknown> {
  const res = await fetch(`${HYPURRSCAN_API}/api/address/${encodeURIComponent(addr)}`, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'WhaleRadar/9.0' },
    signal: AbortSignal.timeout(6_000),
  });
  if (!res.ok) throw new Error(`Hypurrscan address ${res.status}`);
  return res.json();
}

async function fetchBalance(addr: string): Promise<unknown> {
  // Use the RPC endpoint for direct balance queries
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_getBalance',
    params: [addr, 'latest'],
  };
  const res = await fetch(HYPURRSCAN_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'WhaleRadar/9.0' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`Hypurrscan RPC ${res.status}`);
  return res.json();
}

async function fetchLeaderboard(): Promise<unknown> {
  const res = await fetch(`${HYPURRSCAN_API}/api/leaderboard`, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'WhaleRadar/9.0' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Hypurrscan leaderboard ${res.status}`);
  return res.json();
}

// ── Dispatch by type ──────────────────────────────────────────────────────────

async function fetchFresh(type: CacheType, addr?: string): Promise<unknown> {
  switch (type) {
    case 'blocks':      return fetchBlocks();
    case 'txs':         return fetchRecentTxs();
    case 'address':     return fetchAddress(addr!);
    case 'balance':     return fetchBalance(addr!);
    case 'leaderboard': return fetchLeaderboard();
    default:            throw new Error(`Unknown cache type: ${type}`);
  }
}

function cacheKey(type: CacheType, addr?: string): string {
  return addr ? `${type}:${addr.toLowerCase()}` : type;
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') return optionsResponse();
  if (req.method !== 'GET') return errorResponse('Method not allowed', 405);

  const url = new URL(req.url);
  const type = url.searchParams.get('type') as CacheType | null;
  const addr = url.searchParams.get('address') ?? undefined;
  const debug = url.searchParams.get('debug') === '1';

  if (!type || !TTL_MAP[type]) {
    return errorResponse(
      `Missing or invalid ?type=. Valid: ${Object.keys(TTL_MAP).join(', ')}`,
      400,
    );
  }
  if ((type === 'address' || type === 'balance') && !addr) {
    return errorResponse('?address= required for this type', 400);
  }

  const key = cacheKey(type, addr);
  const ttl = TTL_MAP[type];
  const now = Date.now();

  // ── 1. Try cache ────────────────────────────────────────────────────────────
  const cached = await readCache(key);
  if (cached && cached.age_ms < ttl) {
    // Fresh cache hit — return immediately
    const extraHeaders: Record<string, string> = {
      'X-Cache': 'HIT',
      'X-Cache-Age': String(cached.age_ms),
      'X-Cache-TTL': String(ttl),
    };
    if (debug) extraHeaders['X-Cache-Key'] = key;

    // Kick off stale purge in background
    purgeStaleRows();

    return jsonResponse(
      { data: cached.payload, cached: true, age_ms: cached.age_ms, ts: now },
      200,
      extraHeaders,
    );
  }

  // Stale-while-revalidate: if within 3× TTL, return stale + revalidate async
  const staleWindow = ttl * 3;
  if (cached && cached.age_ms < staleWindow) {
    // Return stale immediately, revalidate in the background
    EdgeRuntime.waitUntil(
      (async () => {
        try {
          const rl = await checkRateLimit();
          if (!rl.allowed) return;
          const fresh = await fetchFresh(type, addr);
          await writeCache(key, fresh, ttl);
        } catch (e) {
          console.error('[HLCache] Background revalidation failed:', e);
        }
      })(),
    );

    return jsonResponse(
      { data: cached.payload, cached: true, stale: true, age_ms: cached.age_ms, ts: now },
      200,
      { 'X-Cache': 'STALE', 'X-Cache-Age': String(cached.age_ms) },
    );
  }

  // ── 2. Check rate limit before making fresh request ─────────────────────────
  const rl = await checkRateLimit();
  if (!rl.allowed) {
    // Rate limited — return stale if we have anything at all
    if (cached) {
      return jsonResponse(
        { data: cached.payload, cached: true, rateLimited: true, age_ms: cached.age_ms, ts: now },
        200,
        { 'X-Cache': 'RATE-LIMITED', 'X-RateLimit-Remaining': '0' },
      );
    }
    return errorResponse('Rate limited (200/min) and no cached data', 429);
  }

  // ── 3. Fresh fetch from Hypurrscan ──────────────────────────────────────────
  try {
    const fetchStart = Date.now();
    const freshData = await fetchFresh(type, addr);
    const fetchMs = Date.now() - fetchStart;

    // Write to cache (non-blocking path: fire and continue)
    EdgeRuntime.waitUntil(writeCache(key, freshData, ttl));
    purgeStaleRows();

    return jsonResponse(
      { data: freshData, cached: false, fetch_ms: fetchMs, ts: now },
      200,
      {
        'X-Cache': 'MISS',
        'X-Fetch-Ms': String(fetchMs),
        'X-RateLimit-Remaining': String(rl.remaining),
      },
    );
  } catch (err) {
    console.error('[HLCache] Fetch failed:', err);

    // Any stale fallback is better than nothing
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
