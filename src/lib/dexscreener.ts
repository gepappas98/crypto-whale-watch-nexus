/* ══ WHALE RADAR — DexScreener API Client ═════════════════════════════════════
 *  Fetches DEX liquidity, pair count, and trending status.
 *  No API key needed. Rate limit: ~300 req/min free tier.
 *  Used by detection.ts for: LOW DEX LIQ, DEX TRENDING signals.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { cachedFetch } from './cachedFetch';
import { RL_KEYS } from './rateLimit';

const BASE = 'https://api.dexscreener.com/latest/dex';
const DEX_CACHE_MS = 3 * 60 * 1000; // 3 min — matches CFG.DEX_THROTTLE

export interface DexData {
  dexHot: boolean;
  dsLiq: { liq: number; pairs: number } | null;
}

interface DexPair {
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  priceChange?: { h24?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  pairCreatedAt?: number;
}

interface DexSearchResponse {
  pairs: DexPair[] | null;
}

// A token is "dexHot" if:
// - It has ≥3 active pairs AND
// - Top pair volume is significant relative to liquidity
function isHot(pairs: DexPair[], vol: number): boolean {
  if (pairs.length < 2) return false;
  const topLiq = Math.max(...pairs.map(p => p.liquidity?.usd ?? 0));
  if (topLiq < 10_000) return false; // too illiquid to matter
  const topVol = Math.max(...pairs.map(p => p.volume?.h24 ?? 0));
  return topVol > topLiq * 0.5 || vol > topLiq * 2; // vol > 50% of liq OR CoinGecko vol > 2× DEX liq
}

export async function fetchDexData(
  symbol: string,
  cgVolume: number,
  signal?: AbortSignal,
): Promise<DexData> {
  const result = await cachedFetch<DexSearchResponse>(
    `${BASE}/search/?q=${encodeURIComponent(symbol)}`,
    {
      signal,
      cacheTtl: DEX_CACHE_MS,
      swrTtl: DEX_CACHE_MS * 2,
      rateLimitKey: RL_KEYS.DEXSCREENER,
      rateLimitName: 'DexScreener',
      silent: true,
    },
  );

  const pairs = result.data?.pairs;
  if (!pairs?.length) return { dexHot: false, dsLiq: null };

  // Filter to relevant pairs: USDT/USDC/SOL/BNB quote only, not stale
  const relevant = pairs.filter(p => {
    const liq = p.liquidity?.usd ?? 0;
    return liq > 5_000; // ignore ghost pairs
  });

  if (!relevant.length) return { dexHot: false, dsLiq: null };

  const totalLiq  = relevant.reduce((s, p) => s + (p.liquidity?.usd ?? 0), 0);
  const pairCount = relevant.length;
  const dexHot    = isHot(relevant, cgVolume);

  return {
    dexHot,
    dsLiq: totalLiq > 0 ? { liq: totalLiq, pairs: pairCount } : null,
  };
}
