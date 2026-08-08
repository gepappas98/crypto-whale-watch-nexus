/* ══ NEXUS — Pair Performance Ranking ═════════════════════════════════════════
 *  Ported concept from freqtrade's plugins/pairlist/PerformanceFilter.py.
 *  Re-implemented from scratch in TS against this app's own signal ledger
 *  (lib/signalStore.ts) — no freqtrade source copied, only the idea: don't
 *  just gate pairs in/out (that's pairFilters.ts / pairQuality.ts), also
 *  RANK the ones that pass by how well signals on that symbol have actually
 *  performed historically. A pair that's technically tradeable but has a
 *  track record of bad outcomes should sort to the bottom, not disappear —
 *  freqtrade's PerformanceFilter re-orders the whitelist rather than
 *  rejecting from it, and this does the same.
 *
 *  Data source: every fired signal recorded in signalStore.ts already has
 *  a symbol + eventual outcome_4h. This aggregates that into a per-symbol
 *  performance score with no new tracking required.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { getAllSignalRecords } from '../signalStore';

export interface SymbolPerformance {
  symbol: string;
  fires: number;              // total signal fires for this symbol
  withOutcome: number;        // fires with a filled 4h outcome
  avgOutcomePct: number | null; // mean outcome_4h across filled fires
  winRate: number | null;     // % of filled fires with outcome_4h > 0
  /** Composite score used for sorting: avgOutcomePct weighted down when
   *  sample size is thin, so a single lucky 40% pump doesn't outrank a
   *  pair with 20 consistently-positive fires. Freqtrade's PerformanceFilter
   *  just averages raw pnl; this adds a light confidence discount because
   *  our per-symbol sample sizes are typically much smaller than a live
   *  trading bot's. */
  score: number;
}

const MIN_MINUTES_LOOKBACK_DEFAULT = 0; // 0 = no lookback cutoff, use full history

/**
 * Aggregates every recorded signal fire (with a filled 4h outcome) into a
 * per-symbol performance score. Mirrors PerformanceFilter's `minutes` /
 * `min_profit` config knobs via the options below.
 */
export function computeSymbolPerformance(opts: {
  lookbackMinutes?: number; // freqtrade's PerformanceFilter `minutes` param
  minFires?: number;        // require at least this many filled fires to be scored
} = {}): SymbolPerformance[] {
  const lookbackMinutes = opts.lookbackMinutes ?? MIN_MINUTES_LOOKBACK_DEFAULT;
  const minFires = opts.minFires ?? 1;

  const cutoff = lookbackMinutes > 0 ? Date.now() - lookbackMinutes * 60_000 : 0;
  const records = getAllSignalRecords().filter(
    (r) => r.signal && r.signal !== 'HOLD' && r.fired_at >= cutoff
  );

  const bySymbol = new Map<string, { outcomes: number[]; total: number }>();
  for (const r of records) {
    const entry = bySymbol.get(r.symbol) ?? { outcomes: [], total: 0 };
    entry.total++;
    if (r.outcome_4h !== null) entry.outcomes.push(r.outcome_4h);
    bySymbol.set(r.symbol, entry);
  }

  const rows: SymbolPerformance[] = [];
  for (const [symbol, { outcomes, total }] of bySymbol.entries()) {
    if (outcomes.length < minFires) continue;
    const avg = outcomes.reduce((a, b) => a + b, 0) / outcomes.length;
    const wins = outcomes.filter((o) => o > 0).length;
    const winRate = +((wins / outcomes.length) * 100).toFixed(1);

    // Confidence discount: sqrt(n) dampening keeps small samples from
    // dominating the ranking (same intuition as a Wilson-score interval,
    // simplified — this is a heuristic sort key, not a statistical test).
    const confidence = Math.sqrt(Math.min(outcomes.length, 20) / 20);
    const score = +(avg * confidence).toFixed(3);

    rows.push({
      symbol,
      fires: total,
      withOutcome: outcomes.length,
      avgOutcomePct: +avg.toFixed(2),
      winRate,
      score,
    });
  }

  return rows.sort((a, b) => b.score - a.score);
}

/**
 * Re-orders a candidate symbol list by historical performance, same as
 * freqtrade's PerformanceFilter.filter_pairlist(). Symbols with no
 * recorded performance are pushed to the end (unknown != bad, but a known
 * track record should rank above an unknown one when both pass the
 * existing pairFilters.ts / pairQuality.ts gates).
 */
export function rankByPerformance(
  symbols: string[],
  perf: SymbolPerformance[] = computeSymbolPerformance()
): string[] {
  const scoreOf = new Map(perf.map((p) => [p.symbol, p.score]));
  return [...symbols].sort((a, b) => {
    const sa = scoreOf.get(a);
    const sb = scoreOf.get(b);
    if (sa == null && sb == null) return 0;
    if (sa == null) return 1;
    if (sb == null) return -1;
    return sb - sa;
  });
}

/** Convenience lookup for a single symbol's performance row, e.g. for a
 *  small badge next to a symbol in the scanner ("62% WR / +3.1% avg"). */
export function getSymbolPerformance(
  symbol: string,
  perf: SymbolPerformance[] = computeSymbolPerformance()
): SymbolPerformance | null {
  return perf.find((p) => p.symbol === symbol) ?? null;
}
