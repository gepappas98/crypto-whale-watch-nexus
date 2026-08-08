/* ══ WHALE RADAR — BACKTEST RISK METRICS ══════════════════════════════════════
 *
 *  Ported concept from freqtrade's optimize/backtesting.py results report.
 *  freqtrade's backtest report doesn't stop at "win rate" — it reports
 *  Profit Factor, Expectancy, Max Drawdown, and Sharpe/Sortino because a
 *  strategy with a 55% win rate can still be a net loser if the losses are
 *  bigger than the wins, and a strategy with a great average return can
 *  still be un-tradeable if the drawdown along the way is brutal.
 *
 *  WRSignalEval.tsx / lib/signalStore.ts already do the freqtrade
 *  "forward-test" half of this (record every signal fire, fill in the
 *  1h/4h/24h outcome price, compute win-rate/avg-% per signal label). This
 *  module adds the risk-metrics half on top of that same data — nothing
 *  new to record, just deeper analysis of what's already there.
 *
 *  Nothing here is copied from freqtrade's source — only the metric
 *  definitions (standard, textbook trading-performance stats) and the
 *  "one row per strategy/group" report shape are re-implemented in TS.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { getAllSignalRecords, type SignalRecord } from './signalStore';

export type Horizon = '1h' | '4h' | '24h';

export interface RiskMetricsRow {
  group: string;
  trades: number;               // trades with a filled outcome at this horizon
  totalProfitPct: number;       // sum of per-trade % returns (equal-weighted, sequential)
  avgProfitPct: number;
  winRate: number | null;       // % of trades with outcome > 0
  profitFactor: number | null;  // sum(wins) / abs(sum(losses)) — null if no losses AND no wins
  expectancy: number | null;    // winRate*avgWin + lossRate*avgLoss, i.e. expected % per trade
  maxDrawdownPct: number;       // worst peak-to-trough decline of the cumulative equity curve
  sharpe: number | null;        // mean(returns) / stddev(returns) — per-trade, NOT annualized
  sortino: number | null;       // mean(returns) / downside-deviation — like Sharpe but only penalizes losses
  calmar: number | null;        // totalProfitPct / maxDrawdownPct — return per unit of worst drawdown
  sqn: number | null;           // System Quality Number: sqrt(n) * mean(returns) / stddev(returns)
}

function outcomeKey(h: Horizon): 'outcome_1h' | 'outcome_4h' | 'outcome_24h' {
  return h === '1h' ? 'outcome_1h' : h === '4h' ? 'outcome_4h' : 'outcome_24h';
}

function stddev(vals: number[]): number {
  if (vals.length < 2) return 0;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length - 1);
  return Math.sqrt(variance);
}

/**
 * Downside deviation: same as stddev() but only counts returns below the
 * mean (or below 0 for the "target" variant) — Sortino's whole point is
 * that upside volatility shouldn't be penalized the way downside is.
 * Uses 0% as the minimum acceptable return (MAR), matching how freqtrade's
 * hyperopt Sortino loss function treats it by default.
 */
function downsideDeviation(vals: number[], mar = 0): number {
  const downside = vals.filter((v) => v < mar).map((v) => (v - mar) ** 2);
  if (downside.length === 0) return 0;
  const meanSq = downside.reduce((a, b) => a + b, 0) / vals.length; // divide by N, not just downside count
  return Math.sqrt(meanSq);
}

/**
 * Max drawdown of the cumulative equity curve built by summing per-trade %
 * returns in fire order (oldest first). This mirrors how freqtrade's
 * backtest report treats sequential equal-weighted trades — it is NOT a
 * compounded/geometric drawdown, just cumulative additive %, which is the
 * simplest honest read given we don't track actual position sizing.
 */
function maxDrawdown(returnsOldestFirst: number[]): number {
  let equity = 0;
  let peak = 0;
  let worstDD = 0;
  for (const r of returnsOldestFirst) {
    equity += r;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > worstDD) worstDD = dd;
  }
  return +worstDD.toFixed(2);
}

function computeGroupMetrics(group: string, records: SignalRecord[], horizon: Horizon): RiskMetricsRow {
  const key = outcomeKey(horizon);
  // signalStore stores newest-first; reverse for chronological equity-curve order.
  const chronological = [...records].sort((a, b) => a.fired_at - b.fired_at);
  const returns = chronological
    .map(r => r[key])
    .filter((v): v is number => v !== null);

  const trades = returns.length;
  const totalProfitPct = +returns.reduce((a, b) => a + b, 0).toFixed(2);
  const avgProfitPct = trades > 0 ? +(totalProfitPct / trades).toFixed(2) : 0;

  const wins = returns.filter(r => r > 0);
  const losses = returns.filter(r => r <= 0);
  const winRate = trades > 0 ? +((wins.length / trades) * 100).toFixed(1) : null;

  const sumWins = wins.reduce((a, b) => a + b, 0);
  const sumLossesAbs = Math.abs(losses.reduce((a, b) => a + b, 0));
  const profitFactor =
    trades === 0 ? null
    : sumLossesAbs === 0 ? (sumWins > 0 ? Infinity : null)
    : +(sumWins / sumLossesAbs).toFixed(2);

  const avgWin = wins.length ? sumWins / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
  const expectancy = trades > 0
    ? +(((winRate ?? 0) / 100) * avgWin + (1 - (winRate ?? 0) / 100) * avgLoss).toFixed(2)
    : null;

  const dd = maxDrawdown(returns);

  const sd = stddev(returns);
  const sharpe = trades >= 2 && sd > 0 ? +(avgProfitPct / sd).toFixed(2) : null;

  // Sortino: like Sharpe but only downside volatility is "risk".
  const downsideDev = downsideDeviation(returns);
  const sortino = trades >= 2 && downsideDev > 0 ? +(avgProfitPct / downsideDev).toFixed(2) : null;

  // Calmar: return earned per unit of worst drawdown suffered getting there.
  // Freqtrade's Calmar ratio divides annualized return by max drawdown; we
  // don't annualize (same non-annualized convention as `sharpe` above), so
  // this is total return / max drawdown over the sample window as-is.
  const calmar = dd > 0 ? +(totalProfitPct / dd).toFixed(2) : null;

  // SQN (Van Tharp's System Quality Number): sqrt(n) * mean / stddev.
  // Rewards both a good average return AND enough trades to trust it —
  // a strategy with 3 great trades scores worse than one with 30 solid ones.
  const sqn = trades >= 2 && sd > 0 ? +((Math.sqrt(trades) * avgProfitPct) / sd).toFixed(2) : null;

  return {
    group, trades, totalProfitPct, avgProfitPct, winRate,
    profitFactor, expectancy, maxDrawdownPct: dd, sharpe, sortino, calmar, sqn,
  };
}

/**
 * One row per signal label (AGGRESSIVE LONG / LONG / WATCH / etc.), computed
 * from every locally recorded signal fire that has a filled outcome at the
 * given horizon. Mirrors freqtrade's per-strategy backtest report, but
 * grouped by this app's signal label instead of a strategy name.
 */
export function computeRiskMetrics(horizon: Horizon = '4h'): RiskMetricsRow[] {
  const records = getAllSignalRecords().filter(r => r.signal && r.signal !== 'HOLD');
  const groups = new Map<string, SignalRecord[]>();
  for (const r of records) {
    const arr = groups.get(r.signal) ?? [];
    arr.push(r);
    groups.set(r.signal, arr);
  }

  const rows = Array.from(groups.entries())
    .map(([group, recs]) => computeGroupMetrics(group, recs, horizon))
    .filter(row => row.trades > 0);

  return rows.sort((a, b) => b.totalProfitPct - a.totalProfitPct);
}

/**
 * Single combined row across every signal — the "portfolio-level" summary,
 * i.e. what happens if you'd taken every fired signal equally.
 */
export function computePortfolioMetrics(horizon: Horizon = '4h'): RiskMetricsRow {
  const records = getAllSignalRecords().filter(r => r.signal && r.signal !== 'HOLD');
  return computeGroupMetrics('ALL SIGNALS', records, horizon);
}
