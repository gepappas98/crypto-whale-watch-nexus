/* ══ WHALE RADAR — PAIR FILTERS ════════════════════════════════════════════
 *
 *  Ported concept from freqtrade's plugins/pairlist/* (VolatilityFilter,
 *  RangeStabilityFilter, SpreadFilter, AgeFilter). Freqtrade uses these to
 *  decide which pairs are even worth trading BEFORE running strategy logic.
 *  Here we use the same idea to decide which coins are worth ALERTING on
 *  BEFORE they hit the signal store / alert feed — cuts noise from bad
 *  data, dead pairs, and illiquid tokens without touching detection.ts
 *  scoring itself or hiding rows from the main table.
 *
 *  Each filter is a small pure function: (coin) => FilterResult.
 *  applyPairFilters() runs the whole chain and returns only the coins that
 *  passed every filter, plus a rejection log for debugging/UI badges.
 *
 *  NOTE: freqtrade is GPLv3-licensed. Nothing here is copied from its
 *  source — only the filtering *pattern* (named, composable, short-circuit
 *  filters with a short_desc()-style reason) has been re-implemented in TS.
 * ═══════════════════════════════════════════════════════════════════════════ */

import type { CoinData } from './whaleRadarState';
import { computeSymbolPerformance, type SymbolPerformance } from './nexus/pairPerformance';
import { getRemotePairListUrl, getCachedRemotePairList } from './nexus/remotePairList';

export interface FilterResult {
  pass: boolean;
  reason?: string;
}

export type PairFilter = (coin: CoinData) => FilterResult;

export interface PairFilterConfig {
  /** RangeStabilityFilter analog — reject coins barely moving (dead pairs / stale feed). */
  minAbsChangePct: number;
  /** VolatilityFilter analog — reject coins moving implausibly fast (likely bad tick / API glitch, not a real whale move). */
  maxAbsChangePct: number;
  /** SpreadFilter analog — when DEX liquidity data is present, reject illiquid pools (wide effective spread → false signals). */
  minDexLiquidityUsd: number;
  /** AgeFilter analog — when token age is known, reject brand-new tokens below this (high rug risk, not "whale accumulation"). */
  minAgeDays: number;
  /** Absolute floor for volume/mcap ratio — below this, "volume spike" is just rounding noise. */
  minVmcap: number;
  /** PerformanceFilter analog — min filled signal fires on this symbol before its track
   *  record is trusted enough to suppress alerts on it. Below this, unknown ≠ bad. */
  minPerfSamples: number;
  /** PerformanceFilter analog — a symbol's confidence-discounted avg 4h outcome below this
   *  (with enough samples) means "this symbol's alerts have historically lost money". */
  minPerfScore: number;
}

export const DEFAULT_PAIR_FILTER_CONFIG: PairFilterConfig = {
  minAbsChangePct: 0.5,
  maxAbsChangePct: 500,
  minDexLiquidityUsd: 2_000,
  minAgeDays: 1,
  minVmcap: 5,
  minPerfSamples: 5,
  minPerfScore: -1.5,
};

// ── Individual filters (freqtrade plugin pattern: one concern each) ──────────

const rangeStabilityFilter = (cfg: PairFilterConfig): PairFilter => (coin) => {
  if (Math.abs(coin.change) < cfg.minAbsChangePct && coin.vmcap < cfg.minVmcap) {
    return { pass: false, reason: `flat pair (Δ${coin.change.toFixed(2)}% / vmcap ${coin.vmcap.toFixed(0)}%)` };
  }
  return { pass: true };
};

const volatilityFilter = (cfg: PairFilterConfig): PairFilter => (coin) => {
  if (Math.abs(coin.change) > cfg.maxAbsChangePct) {
    return { pass: false, reason: `implausible Δ${coin.change.toFixed(0)}% — likely bad tick, not a real move` };
  }
  return { pass: true };
};

const dexLiquidityFilter = (cfg: PairFilterConfig): PairFilter => (coin) => {
  if (coin.dexHot && coin.dsLiq && coin.dsLiq.liq < cfg.minDexLiquidityUsd) {
    return { pass: false, reason: `illiquid DEX pool ($${coin.dsLiq.liq.toFixed(0)} < $${cfg.minDexLiquidityUsd})` };
  }
  return { pass: true };
};

const ageFilter = (cfg: PairFilterConfig): PairFilter => (coin) => {
  const age = coin.birdData?.ageDays;
  if (age != null && age < cfg.minAgeDays) {
    return { pass: false, reason: `token age ${age.toFixed(2)}d < ${cfg.minAgeDays}d — rug risk, not whale signal` };
  }
  return { pass: true };
};

/** PerformanceFilter analog (freqtrade plugins/pairlist/PerformanceFilter.py)
 *  — reuses lib/nexus/pairPerformance.ts's confidence-discounted per-symbol
 *  score instead of re-deriving it, since it already aggregates the same
 *  signalStore.ts ledger this app already keeps. Computed ONCE per filter
 *  build (not per coin) — see buildDefaultFilters() — so a scan of N coins
 *  costs one signalStore pass, not N. A symbol with too few filled outcomes
 *  passes through unfiltered: no track record isn't the same as a bad one. */
const performanceFilter = (cfg: PairFilterConfig, perf: SymbolPerformance[]): PairFilter => {
  const bySymbol = new Map(perf.map((p) => [p.symbol, p]));
  return (coin) => {
    const p = bySymbol.get(coin.symbol);
    if (!p || p.withOutcome < cfg.minPerfSamples) return { pass: true };
    if (p.score < cfg.minPerfScore) {
      return {
        pass: false,
        reason: `${coin.symbol} has a poor track record (${p.avgOutcomePct}% avg outcome over ${p.withOutcome} fires) — alerting suppressed`,
      };
    }
    return { pass: true };
  };
};

/** RemotePairList analog (freqtrade plugins/pairlist/RemotePairList.py) —
 *  opt-in symbol whitelist gate. This was previously "configure a URL in
 *  Settings, see a fetched count, and nothing else happens" — the fetched
 *  list was never actually consulted anywhere. This closes that gap: if a
 *  URL is configured AND the cache has content, only symbols on that list
 *  make it through. No URL configured, or cache still empty (first load,
 *  before any fetch has completed) → passes everything, same as freqtrade's
 *  RemotePairList falling through when its remote is unreachable and no
 *  cache exists yet. Reads the sync cache (see remotePairList.ts) rather
 *  than fetching — keeping the actual network call out of the filter's
 *  hot path is why useMarketData.ts refreshes the cache separately. */
const remoteWhitelistFilter: PairFilter = (coin) => {
  const url = getRemotePairListUrl();
  if (!url) return { pass: true }; // feature not enabled
  const list = getCachedRemotePairList();
  if (list.length === 0) return { pass: true }; // configured but nothing fetched yet — don't block everything on that
  if (!list.includes(coin.symbol.toUpperCase())) {
    return { pass: false, reason: `${coin.symbol} not on the configured remote pairlist (${list.length} symbols)` };
  }
  return { pass: true };
};

export function buildDefaultFilters(
  cfg: PairFilterConfig = DEFAULT_PAIR_FILTER_CONFIG,
  perf: SymbolPerformance[] = computeSymbolPerformance(),
): PairFilter[] {
  return [
    rangeStabilityFilter(cfg),
    volatilityFilter(cfg),
    dexLiquidityFilter(cfg),
    ageFilter(cfg),
    performanceFilter(cfg, perf),
    remoteWhitelistFilter,
  ];
}

export interface PairFilterOutcome {
  passed: CoinData[];
  rejected: { coin: CoinData; reason: string }[];
}

/**
 * Runs the filter chain against a set of coins. Short-circuits per coin on
 * first failing filter (mirrors freqtrade's sequential pairlist processing).
 */
export function applyPairFilters(
  coins: CoinData[],
  filters: PairFilter[] = buildDefaultFilters(),
): PairFilterOutcome {
  const passed: CoinData[] = [];
  const rejected: { coin: CoinData; reason: string }[] = [];

  for (const coin of coins) {
    let ok = true;
    let failReason = '';
    for (const filter of filters) {
      const res = filter(coin);
      if (!res.pass) {
        ok = false;
        failReason = res.reason ?? 'filtered';
        break;
      }
    }
    if (ok) passed.push(coin);
    else rejected.push({ coin, reason: failReason });
  }

  return { passed, rejected };
}
