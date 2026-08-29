/* ══ NEXUS — Daily Risk / Reward Gate ═══════════════════════════════════════
 *  Hard block on new exposure when today's realized PnL (from botTradeStore)
 *  breaches max daily drawdown. Acts as a "Risk Management Agent" rule:
 *  other strategies cannot open size once the day is already down too far.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { getTradesSince } from "./botTradeStore";

const CONFIG_KEY = "nexus_daily_risk_cfg_v1";

export interface DailyRiskConfig {
  enabled: boolean;
  /** Fraction of starting equity — e.g. 0.03 = −3% day stops new entries. */
  maxDailyDrawdownPct: number;
  /** Notional equity baseline for converting trade closeProfit fractions
   *  into a day P&L estimate when trades store relative closeProfit. */
  equityBaselineUsd: number;
  /** Minimum absolute R:R (reward/risk) required on new signals when set.
   *  0 = disabled. */
  minRiskReward: number;
}

export const DEFAULT_DAILY_RISK_CONFIG: DailyRiskConfig = {
  enabled: true,
  maxDailyDrawdownPct: 0.03,
  equityBaselineUsd: 10_000,
  minRiskReward: 0,
};

export interface DailyRiskStatus {
  allowed: boolean;
  reason?: string;
  dayPnlPct: number;
  dayTradeCount: number;
  limitPct: number;
}

export function getDailyRiskConfig(): DailyRiskConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return DEFAULT_DAILY_RISK_CONFIG;
    return { ...DEFAULT_DAILY_RISK_CONFIG, ...(JSON.parse(raw) as Partial<DailyRiskConfig>) };
  } catch {
    return DEFAULT_DAILY_RISK_CONFIG;
  }
}

export function setDailyRiskConfig(cfg: DailyRiskConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  } catch (e) {
    console.error("[DailyRisk] persist failed:", e);
  }
}

function startOfUtcDayMs(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Sum closeProfit of trades closed since UTC midnight. closeProfit is a
 *  fraction of notional (same convention as protections.ts). */
export function getDayPnlFraction(now = Date.now()): { pnl: number; count: number } {
  const since = startOfUtcDayMs(now);
  const trades = getTradesSince(since);
  const pnl = trades.reduce((s, t) => s + (Number(t.closeProfit) || 0), 0);
  return { pnl, count: trades.length };
}

/**
 * Gate new entries. Optional proposedRiskReward = reward/risk for the
 * candidate trade (e.g. 2.0 means 2R). When minRiskReward > 0 and the
 * proposal is below it, block.
 */
export function checkDailyRiskGate(proposedRiskReward?: number): DailyRiskStatus {
  const cfg = getDailyRiskConfig();
  const { pnl, count } = getDayPnlFraction();
  const limit = cfg.maxDailyDrawdownPct;

  if (!cfg.enabled) {
    return { allowed: true, dayPnlPct: pnl, dayTradeCount: count, limitPct: limit };
  }

  // pnl is fractional return summed across trades — approximate day drawdown
  if (pnl <= -limit) {
    return {
      allowed: false,
      reason: `Daily risk limit hit: day PnL ${(pnl * 100).toFixed(2)}% ≤ −${(limit * 100).toFixed(1)}% (${count} trades). New entries blocked until UTC midnight.`,
      dayPnlPct: pnl,
      dayTradeCount: count,
      limitPct: limit,
    };
  }

  if (
    cfg.minRiskReward > 0 &&
    typeof proposedRiskReward === "number" &&
    Number.isFinite(proposedRiskReward) &&
    proposedRiskReward < cfg.minRiskReward
  ) {
    return {
      allowed: false,
      reason: `Risk/Reward ${proposedRiskReward.toFixed(2)} below minimum ${cfg.minRiskReward.toFixed(2)} (Risk Auditor).`,
      dayPnlPct: pnl,
      dayTradeCount: count,
      limitPct: limit,
    };
  }

  return { allowed: true, dayPnlPct: pnl, dayTradeCount: count, limitPct: limit };
}
