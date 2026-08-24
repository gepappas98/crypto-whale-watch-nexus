/* ══ WHALE RADAR — RugCheck API Client ════════════════════════════════════════
 *  Free, keyless on-chain risk report for Solana mints.
 *  Endpoint: https://api.rugcheck.xyz/v1/tokens/{mint}/report
 *  Returns:  normalised risk score, mint/freeze authority, LP lock %.
 *  Cached for 15 min (same TTL as Birdeye enrichment).
 * ═══════════════════════════════════════════════════════════════════════════ */

import type { RugCheckData } from './whaleRadarState';
import { cachedFetch } from './cachedFetch';
import { RL_KEYS } from './rateLimit';

const BASE = 'https://api.rugcheck.xyz/v1';
const RUG_CACHE_MS = 15 * 60 * 1000;

interface RugCheckMarket {
  lp?: {
    lpLockedPct?: number | null;
    lpLocked?: number | null;
    lpTotalSupply?: number | null;
  } | null;
}

interface RugCheckRisk {
  name?: string;
  level?: string;
  score?: number;
}

interface RugCheckReport {
  score?: number | null;
  score_normalised?: number | null;
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  token?: {
    mintAuthority?: string | null;
    freezeAuthority?: string | null;
  } | null;
  totalMarketLiquidity?: number | null;
  totalLPProviders?: number | null;
  markets?: RugCheckMarket[] | null;
  risks?: RugCheckRisk[] | null;
  rugged?: boolean;
}

/** Highest LP lock percentage across all markets (best-case pool). */
function maxLpLocked(markets?: RugCheckMarket[] | null): number | null {
  if (!markets?.length) return null;
  const pcts = markets
    .map(m => m.lp?.lpLockedPct)
    .filter((v): v is number => typeof v === 'number' && !isNaN(v));
  if (!pcts.length) return null;
  return Math.max(...pcts);
}

/** RugCheck's raw score is unbounded; score_normalised is 0-100 (higher = riskier). */
function normaliseScore(r: RugCheckReport): number | null {
  if (typeof r.score_normalised === 'number' && !isNaN(r.score_normalised)) {
    return Math.max(0, Math.min(100, Math.round(r.score_normalised)));
  }
  if (typeof r.score === 'number' && !isNaN(r.score)) {
    // Raw scores commonly run 0-10000+; compress to 0-100.
    return Math.max(0, Math.min(100, Math.round(r.score / 100)));
  }
  return null;
}

export async function fetchRugCheck(
  addr: string,
  sym: string,
  signal?: AbortSignal,
): Promise<RugCheckData | null> {
  if (!addr) return null;

  const res = await cachedFetch<RugCheckReport>(
    `${BASE}/tokens/${addr}/report`,
    {
      signal,
      cacheTtl: RUG_CACHE_MS,
      swrTtl: RUG_CACHE_MS * 2,
      rateLimitKey: RL_KEYS.RUGCHECK,
      rateLimitName: 'RugCheck',
      silent: true,
    },
  );

  const rep = res.data;
  if (!rep) return null;

  const mintAuthority   = rep.mintAuthority   ?? rep.token?.mintAuthority   ?? null;
  const freezeAuthority = rep.freezeAuthority ?? rep.token?.freezeAuthority ?? null;

  const topRisks = (rep.risks ?? [])
    .filter(r => !!r?.name)
    .slice(0, 4)
    .map(r => r.name as string);

  return {
    ts: Date.now(),
    sym,
    addr,
    score: normaliseScore(rep),
    mintAuthority,
    freezeAuthority,
    isMintable:  Boolean(mintAuthority),
    isFreezable: Boolean(freezeAuthority),
    lpLockedPct: maxLpLocked(rep.markets),
    lpProviders: rep.totalLPProviders ?? null,
    liquidityUsd: rep.totalMarketLiquidity ?? null,
    rugged: Boolean(rep.rugged),
    risks: topRisks,
  };
}
