/* ══ NEXUS — Protection Threshold Optimizer ═══════════════════════════════════
 *  Ported concept from freqtrade's optimize/hyperopt.py: instead of guessing
 *  protection thresholds (cooldown minutes, max-drawdown %, stoploss-guard
 *  trade limit), search a small grid of candidate values and score each
 *  against real trade history to see which would have produced the best
 *  outcome. This is a lightweight local grid-search, not a real optimizer
 *  (no Bayesian search, no walk-forward validation) — appropriate for the
 *  handful of trades this app's own botTradeStore actually accumulates,
 *  where a heavyweight optimizer would just be overfitting noise.
 *
 *  Re-implemented from scratch against this app's own trade ledger
 *  (botTradeStore.ts) and protection engine (protections.ts) — no
 *  freqtrade source copied, only the "search config space, score against
 *  history" idea.
 *
 *  IMPORTANT (same caveat freqtrade gives about hyperopt overfitting):
 *  this optimizes against PAST trades. A result is a suggestion to review,
 *  not a guarantee — thresholds tuned to fit history can still fail on
 *  future trades that don't look like the past ones. Never auto-apply the
 *  suggestion; surface it for the user to confirm.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { getAllBotTrades, type BotTradeRecord } from "./botTradeStore";
import { DEFAULT_PROTECTION_CONFIG, getProtectionConfig, type ProtectionConfig } from "./protections";

export interface OptimizationCandidate {
  maxDrawdown: { maxAllowedDrawdown: number; lockMinutes: number };
  stoplossGuard: { tradeLimit: number; lockMinutes: number };
  lowProfitPairs: { requiredProfit: number; lookbackMinutes: number };
}

export interface OptimizationResult {
  candidate: OptimizationCandidate;
  /** Net PnL (sum of closeProfit) the trade history would have produced
   *  had every trade opened AFTER a lock was triggered been skipped. */
  simulatedNetProfit: number;
  /** How many of the actual historical trades this candidate would have blocked. */
  tradesBlocked: number;
  tradesTotal: number;
}

// Small, deliberately coarse grids — this is a sanity-check tool, not a
// production hyperparameter search. Each axis searched independently
// holding the others at DEFAULT_PROTECTION_CONFIG, then combined for the
// final candidate (a simplification vs. freqtrade's full joint search,
// appropriate given how few trades this app's ledger typically holds).
const DRAWDOWN_GRID = [0.05, 0.1, 0.15, 0.2];
const STOPLOSS_LIMIT_GRID = [2, 3, 4, 6];
const LOW_PROFIT_REQUIRED_GRID = [0, -0.01, -0.02];

/**
 * Replays trade history chronologically, applying a simplified version of
 * the max-drawdown and stoploss-guard checks with the given thresholds,
 * and returns what net profit would have resulted if every trade that
 * "should have been blocked" under those thresholds were excluded.
 *
 * This is necessarily a simplification of the real canTrade() logic (it
 * doesn't model cooldown/pair-specific locks or lock expiry precisely) —
 * good enough to compare candidate thresholds against each other, not a
 * drop-in replacement for protections.ts itself.
 */
function simulate(
  trades: BotTradeRecord[],
  cfg: OptimizationCandidate
): { netProfit: number; blocked: number } {
  const chronological = [...trades].sort((a, b) => a.closedAt - b.closedAt);

  let equity = 0;
  let peak = 0;
  let netProfit = 0;
  let blocked = 0;
  let lockedUntil = 0;
  const recentStopExits: number[] = []; // timestamps

  for (const t of chronological) {
    // Would this trade have been blocked by an active lock from a
    // previous iteration's decision?
    if (t.closedAt < lockedUntil) {
      blocked++;
      continue;
    }

    // Include this trade's outcome.
    equity += t.closeProfit;
    netProfit += t.closeProfit;
    if (equity > peak) peak = equity;
    const drawdown = peak - equity;

    if (t.isStopExit) recentStopExits.push(t.closedAt);
    // Trim stop-exit window to last hour (matches DEFAULT_PROTECTION_CONFIG.stoplossGuard.lookbackMinutes)
    while (recentStopExits.length && t.closedAt - recentStopExits[0] > 60 * 60_000) {
      recentStopExits.shift();
    }

    if (drawdown > cfg.maxDrawdown.maxAllowedDrawdown) {
      lockedUntil = t.closedAt + cfg.maxDrawdown.lockMinutes * 60_000;
    } else if (recentStopExits.length >= cfg.stoplossGuard.tradeLimit) {
      lockedUntil = t.closedAt + cfg.stoplossGuard.lockMinutes * 60_000;
    }
  }

  return { netProfit: +netProfit.toFixed(4), blocked };
}

/**
 * Runs the grid-search and returns the top N candidates by simulated net
 * profit, best first. Requires a minimum trade count to avoid tuning
 * thresholds to a handful of noisy data points (freqtrade's hyperopt has
 * the same "not enough data" failure mode with small backtests).
 */
export function optimizeProtectionThresholds(opts: {
  minTrades?: number;
  topN?: number;
} = {}): { results: OptimizationResult[]; insufficientData: boolean; tradeCount: number } {
  const minTrades = opts.minTrades ?? 15;
  const topN = opts.topN ?? 3;

  const trades = getAllBotTrades();
  if (trades.length < minTrades) {
    return { results: [], insufficientData: true, tradeCount: trades.length };
  }

  const candidates: OptimizationCandidate[] = [];
  for (const dd of DRAWDOWN_GRID) {
    for (const sl of STOPLOSS_LIMIT_GRID) {
      for (const lp of LOW_PROFIT_REQUIRED_GRID) {
        candidates.push({
          maxDrawdown: { maxAllowedDrawdown: dd, lockMinutes: DEFAULT_PROTECTION_CONFIG.maxDrawdown.lockMinutes },
          stoplossGuard: { tradeLimit: sl, lockMinutes: DEFAULT_PROTECTION_CONFIG.stoplossGuard.lockMinutes },
          lowProfitPairs: { requiredProfit: lp, lookbackMinutes: DEFAULT_PROTECTION_CONFIG.lowProfitPairs.lookbackMinutes },
        });
      }
    }
  }

  const results: OptimizationResult[] = candidates.map((candidate) => {
    const sim = simulate(trades, candidate);
    return {
      candidate,
      simulatedNetProfit: sim.netProfit,
      tradesBlocked: sim.blocked,
      tradesTotal: trades.length,
    };
  });

  results.sort((a, b) => b.simulatedNetProfit - a.simulatedNetProfit);
  return { results: results.slice(0, topN), insufficientData: false, tradeCount: trades.length };
}

/**
 * Merges the best candidate's thresholds into a full ProtectionConfig,
 * leaving cooldown untouched (cooldown isn't part of this simplified
 * search — it interacts with pair-level timing in a way this grid-search
 * doesn't model well). Returns null if there's no result to apply.
 */
export function applyBestCandidate(
  base: ProtectionConfig = getProtectionConfig()
): ProtectionConfig | null {
  const { results, insufficientData } = optimizeProtectionThresholds();
  if (insufficientData || results.length === 0) return null;
  const best = results[0].candidate;
  return {
    ...base,
    maxDrawdown: { ...base.maxDrawdown, ...best.maxDrawdown },
    stoplossGuard: { ...base.stoplossGuard, ...best.stoplossGuard },
    lowProfitPairs: { ...base.lowProfitPairs, ...best.lowProfitPairs },
  };
}
