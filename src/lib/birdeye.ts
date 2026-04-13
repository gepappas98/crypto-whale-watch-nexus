/* ══ WHALE RADAR — Birdeye API Client ═════════════════════════════════════════
 *  Fetches on-chain security data for Solana tokens.
 *  Uses: /defi/token_security (holder concentration, mint/freeze authority, age)
 *        /defi/token_overview  (LP info, liquidity)
 *  Free tier: ~100 req/min. Cached for CFG.BIRD_CACHE_MS (15 min).
 * ═══════════════════════════════════════════════════════════════════════════ */

import type { BirdeyeData } from './whaleRadarState';
import { cachedFetch } from './cachedFetch';
import { RL_KEYS } from './rateLimit';

const BASE = 'https://public-api.birdeye.so';
const BIRD_CACHE_MS = 15 * 60 * 1000; // 15 min — matches CFG.BIRD_CACHE_MS

// ── Security response shape ───────────────────────────────────────────────────
interface BirdeyeSecurityData {
  ownerPercentage?: number | null;
  creatorPercentage?: number | null;
  top10HolderPercent?: number | null;
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  isMutable?: boolean;
  nonTransferable?: boolean;
  creationTime?: number | null;    // unix seconds
  totalLpProviders?: number | null;
  lpHolders?: Array<{ percentage: number; address: string }>;
}

// ── Overview response shape (for LP burned estimate) ─────────────────────────
interface BirdeyeOverviewData {
  liquidity?: number | null;
  uniqueWallet24h?: number | null;
  trade24h?: number | null;
  numberMarkets?: number | null;
}

// ── Compute rug score from security data ─────────────────────────────────────
function computeRugScore(sec: BirdeyeSecurityData, ageDays: number | null): number {
  let score = 0;

  // Mint authority present = can print unlimited supply
  if (sec.mintAuthority) score += 30;

  // Freeze authority = can freeze wallets
  if (sec.freezeAuthority) score += 20;

  // Holder concentration
  const top10 = sec.top10HolderPercent ?? null;
  if (top10 != null) {
    if (top10 > 80) score += 30;
    else if (top10 > 60) score += 20;
    else if (top10 > 40) score += 10;
  }

  // Creator still holds large position
  const creatorPct = sec.creatorPercentage ?? null;
  if (creatorPct != null && creatorPct > 15) score += 15;

  // Brand new token (< 7 days) — high rug risk
  if (ageDays != null) {
    if (ageDays < 1) score += 20;
    else if (ageDays < 3) score += 15;
    else if (ageDays < 7) score += 8;
  }

  return Math.min(score, 100);
}

// ── LP burned estimate from LP holders ───────────────────────────────────────
// If one of the top LP holders is a known burn address, sum their percentage.
const BURN_ADDRESSES = new Set([
  '11111111111111111111111111111111',          // System Program (burn)
  '1nc1nerator11111111111111111111111111111111', // Incinerator
]);

function estimateLpBurned(lpHolders?: Array<{ percentage: number; address: string }>): number | null {
  if (!lpHolders?.length) return null;
  const burned = lpHolders
    .filter(h => BURN_ADDRESSES.has(h.address))
    .reduce((s, h) => s + (h.percentage ?? 0), 0);
  return burned; // 0–100
}

// ── Main fetch function ───────────────────────────────────────────────────────

export async function fetchBirdeyeToken(
  addr: string,
  sym: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<BirdeyeData | null> {
  if (!apiKey || !addr) return null;

  const headers = {
    'X-API-KEY': apiKey,
    'x-chain': 'solana',
  };

  // Parallel: security + overview
  const [secResult, ovResult] = await Promise.all([
    cachedFetch<{ success: boolean; data: BirdeyeSecurityData }>(
      `${BASE}/defi/token_security?address=${addr}`,
      {
        headers,
        signal,
        cacheTtl: BIRD_CACHE_MS,
        swrTtl: BIRD_CACHE_MS * 2,
        rateLimitKey: RL_KEYS.BIRDEYE,
        rateLimitName: 'Birdeye',
        silent: true,
      },
    ),
    cachedFetch<{ success: boolean; data: BirdeyeOverviewData }>(
      `${BASE}/defi/token_overview?address=${addr}`,
      {
        headers,
        signal,
        cacheTtl: BIRD_CACHE_MS,
        swrTtl: BIRD_CACHE_MS * 2,
        rateLimitKey: RL_KEYS.BIRDEYE,
        rateLimitName: 'Birdeye',
        silent: true,
      },
    ),
  ]);

  const sec = secResult.data?.data;
  if (!sec) return null;

  // Compute age
  let ageDays: number | null = null;
  if (sec.creationTime) {
    ageDays = Math.floor((Date.now() / 1000 - sec.creationTime) / 86400);
  }

  const lpBurned = estimateLpBurned(sec.lpHolders);
  const rugScore = computeRugScore(sec, ageDays);

  // devActivity: rough proxy from overview trade/wallet counts
  const ov = ovResult.data?.data;
  let devActivity = 'unknown';
  if (ov) {
    const wallets = ov.uniqueWallet24h ?? 0;
    const trades  = ov.trade24h ?? 0;
    devActivity = wallets > 1000 ? 'high' : wallets > 100 ? 'medium' : trades > 0 ? 'low' : 'none';
  }

  return {
    ts: Date.now(),
    sym,
    addr,
    top10pct:   sec.top10HolderPercent ?? null,
    creatorPct: sec.creatorPercentage  ?? null,
    lpBurned,
    isMintable:  Boolean(sec.mintAuthority),
    isFreezable: Boolean(sec.freezeAuthority),
    ageDays,
    rugScore,
    devActivity,
  };
}
