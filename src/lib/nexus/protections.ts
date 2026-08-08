/* ══ NEXUS — Protection Engine ════════════════════════════════════════════════
 *  Textbook risk-control checks (concept ported from freqtrade's
 *  plugins/protections/*, re-implemented from scratch in TS against this
 *  app's own bot trade ledger — no freqtrade source copied). Nothing here
 *  places trades; it only decides whether the bot is ALLOWED to open a new
 *  one right now, and records WHY when it says no.
 *
 *  Four checks, each independently toggleable:
 *   - CooldownPeriod  — block new entries on a pair right after it closes
 *   - StoplossGuard   — too many stopped-out losses recently → lock
 *   - MaxDrawdown     — equity curve drawdown exceeds threshold → lock all
 *   - LowProfitPairs  — a pair's recent net PnL is negative → lock that pair
 *
 *  Call `canTrade(pair, side)` before any bot execute/create call in
 *  bot.ts / useNexusBot.ts. Locks are persisted so a refresh doesn't reset
 *  an active cooldown.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { getTradesSince, type BotTradeRecord, type TradeSide } from "./botTradeStore";

const LOCK_STORE_KEY = "nexus_protection_locks_v1";

export interface ProtectionLock {
  pair: string; // "*" = applies to every pair
  side: TradeSide;
  reason: string;
  until: number; // epoch ms
  source: "cooldown" | "stoploss_guard" | "max_drawdown" | "low_profit_pairs";
}

export interface ProtectionConfig {
  cooldown: { enabled: boolean; lookbackMinutes: number };
  stoplossGuard: {
    enabled: boolean;
    lookbackMinutes: number;
    tradeLimit: number; // this many stop-exits...
    lockMinutes: number;
    onlyPerPair: boolean; // if true, never locks *all* pairs, only the offending one
  };
  maxDrawdown: {
    enabled: boolean;
    lookbackMinutes: number;
    tradeLimit: number; // minimum trades in window before evaluating
    maxAllowedDrawdown: number; // fraction, e.g. 0.10 = 10%
    lockMinutes: number;
  };
  lowProfitPairs: {
    enabled: boolean;
    lookbackMinutes: number;
    tradeLimit: number;
    requiredProfit: number; // fraction; net profit below this locks the pair
    lockMinutes: number;
  };
}

export const DEFAULT_PROTECTION_CONFIG: ProtectionConfig = {
  cooldown: { enabled: true, lookbackMinutes: 15 },
  stoplossGuard: {
    enabled: true,
    lookbackMinutes: 60,
    tradeLimit: 4,
    lockMinutes: 120,
    onlyPerPair: false,
  },
  maxDrawdown: {
    enabled: true,
    lookbackMinutes: 24 * 60,
    tradeLimit: 5,
    maxAllowedDrawdown: 0.1,
    lockMinutes: 240,
  },
  lowProfitPairs: {
    enabled: true,
    lookbackMinutes: 6 * 60,
    tradeLimit: 3,
    requiredProfit: 0,
    lockMinutes: 60,
  },
};

// ── Persisted, user/optimizer-adjustable config ───────────────────────────────
// Defaults above stay the fallback; this layer lets the Settings UI or the
// hyperopt-style optimizer (protectionOptimizer.ts) persist a tuned config
// without editing source. canTrade() reads this by default.

const CONFIG_STORE_KEY = "nexus_protection_config_v1";

export function getProtectionConfig(): ProtectionConfig {
  try {
    const raw = localStorage.getItem(CONFIG_STORE_KEY);
    if (!raw) return DEFAULT_PROTECTION_CONFIG;
    const parsed = JSON.parse(raw) as Partial<ProtectionConfig>;
    // Shallow-merge each section over defaults so a config saved before a
    // new field was added doesn't end up missing it.
    return {
      cooldown: { ...DEFAULT_PROTECTION_CONFIG.cooldown, ...parsed.cooldown },
      stoplossGuard: { ...DEFAULT_PROTECTION_CONFIG.stoplossGuard, ...parsed.stoplossGuard },
      maxDrawdown: { ...DEFAULT_PROTECTION_CONFIG.maxDrawdown, ...parsed.maxDrawdown },
      lowProfitPairs: { ...DEFAULT_PROTECTION_CONFIG.lowProfitPairs, ...parsed.lowProfitPairs },
    };
  } catch {
    return DEFAULT_PROTECTION_CONFIG;
  }
}

export function setProtectionConfig(cfg: ProtectionConfig): void {
  try {
    localStorage.setItem(CONFIG_STORE_KEY, JSON.stringify(cfg));
  } catch (e) {
    console.error("[Protections] failed to persist config:", e);
  }
}

export function resetProtectionConfig(): void {
  localStorage.removeItem(CONFIG_STORE_KEY);
}

// ── Lock persistence ─────────────────────────────────────────────────────────

function loadLocks(): ProtectionLock[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCK_STORE_KEY) || "[]") as ProtectionLock[];
    const now = Date.now();
    return raw.filter((l) => l.until > now); // drop expired on read
  } catch {
    return [];
  }
}

function persistLocks(locks: ProtectionLock[]): void {
  try {
    localStorage.setItem(LOCK_STORE_KEY, JSON.stringify(locks));
  } catch (e) {
    console.error("[Protections] failed to persist locks:", e);
  }
}

function addLock(lock: ProtectionLock): void {
  const locks = loadLocks();
  locks.push(lock);
  persistLocks(locks);
}

/** Manually clear a lock early (e.g. an "unlock" button in the UI). */
export function clearLock(pair: string, source?: ProtectionLock["source"]): void {
  const locks = loadLocks().filter((l) => !(l.pair === pair && (!source || l.source === source)));
  persistLocks(locks);
}

export function clearAllLocks(): void {
  localStorage.removeItem(LOCK_STORE_KEY);
}

/** Active locks right now, for UI display (e.g. a banner in Nexus Bot panel). */
export function getActiveLocks(): ProtectionLock[] {
  return loadLocks();
}

// ── Individual checks ────────────────────────────────────────────────────────
// Each returns a lock to apply, or null if the check passes.

function checkCooldown(
  cfg: ProtectionConfig["cooldown"],
  pair: string,
  now: number
): ProtectionLock | null {
  if (!cfg.enabled) return null;
  const since = now - cfg.lookbackMinutes * 60_000;
  const recent = getTradesSince(since, { pair });
  if (recent.length === 0) return null;

  const lastClose = Math.max(...recent.map((t) => t.closedAt));
  const until = lastClose + cfg.lookbackMinutes * 60_000;
  if (until <= now) return null;

  return {
    pair,
    side: "*",
    reason: `Cooldown: ${pair} closed a trade within the last ${cfg.lookbackMinutes}m`,
    until,
    source: "cooldown",
  };
}

function checkStoplossGuard(
  cfg: ProtectionConfig["stoplossGuard"],
  pair: string | null,
  side: TradeSide,
  now: number
): ProtectionLock | null {
  if (!cfg.enabled) return null;
  const since = now - cfg.lookbackMinutes * 60_000;
  const candidates = getTradesSince(since, pair ? { pair } : {});
  const stopExits = candidates.filter((t) => t.isStopExit);

  if (stopExits.length < cfg.tradeLimit) return null;

  const until = now + cfg.lockMinutes * 60_000;
  return {
    pair: cfg.onlyPerPair ? pair ?? "*" : "*",
    side,
    reason: `${stopExits.length} stop-losses within ${cfg.lookbackMinutes}m (limit ${cfg.tradeLimit})`,
    until,
    source: "stoploss_guard",
  };
}

/** Max-drawdown over the equity curve built from every trade's closeProfit
 *  in the lookback window (sequential, additive — same simplification
 *  lib/backtestMetrics.ts already uses for signal equity curves). */
function checkMaxDrawdown(
  cfg: ProtectionConfig["maxDrawdown"],
  now: number
): ProtectionLock | null {
  if (!cfg.enabled) return null;
  const since = now - cfg.lookbackMinutes * 60_000;
  const trades = getTradesSince(since).sort((a, b) => a.closedAt - b.closedAt);
  if (trades.length < cfg.tradeLimit) return null;

  let equity = 0;
  let peak = 0;
  let worstDrawdown = 0;
  for (const t of trades) {
    equity += t.closeProfit;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > worstDrawdown) worstDrawdown = dd;
  }

  if (worstDrawdown <= cfg.maxAllowedDrawdown) return null;

  const until = now + cfg.lockMinutes * 60_000;
  return {
    pair: "*",
    side: "*",
    reason: `Max drawdown ${(worstDrawdown * 100).toFixed(1)}% exceeds ${(
      cfg.maxAllowedDrawdown * 100
    ).toFixed(1)}% within ${cfg.lookbackMinutes}m`,
    until,
    source: "max_drawdown",
  };
}

function checkLowProfitPairs(
  cfg: ProtectionConfig["lowProfitPairs"],
  pair: string,
  side: TradeSide,
  now: number
): ProtectionLock | null {
  if (!cfg.enabled) return null;
  const since = now - cfg.lookbackMinutes * 60_000;
  const trades = getTradesSince(since, { pair });
  if (trades.length < cfg.tradeLimit) return null;

  const netProfit = trades.reduce((sum, t) => sum + t.closeProfit, 0);
  if (netProfit >= cfg.requiredProfit) return null;

  const until = now + cfg.lockMinutes * 60_000;
  return {
    pair,
    side,
    reason: `${pair} net profit ${(netProfit * 100).toFixed(2)}% below required ${(
      cfg.requiredProfit * 100
    ).toFixed(2)}% within ${cfg.lookbackMinutes}m`,
    until,
    source: "low_profit_pairs",
  };
}

// ── Orchestration ─────────────────────────────────────────────────────────────

export interface TradeGateResult {
  allowed: boolean;
  reason?: string;
  until?: number;
}

/** Run every enabled check for a prospective trade on `pair`/`side`, persist
 *  any new locks, and return whether the trade may proceed. Call this
 *  synchronously right before the bot places an order. */
export function canTrade(
  pair: string,
  side: TradeSide,
  config: ProtectionConfig = getProtectionConfig()
): TradeGateResult {
  const now = Date.now();

  // 1. Any existing, still-active lock covering this pair/side wins immediately.
  const active = getActiveLocks().find(
    (l) => (l.pair === "*" || l.pair === pair) && (l.side === "*" || l.side === side)
  );
  if (active) {
    return { allowed: false, reason: active.reason, until: active.until };
  }

  // 2. Run fresh checks in a fixed order; the first hit locks and blocks.
  const newLock =
    checkCooldown(config.cooldown, pair, now) ??
    checkStoplossGuard(config.stoplossGuard, pair, side, now) ??
    checkMaxDrawdown(config.maxDrawdown, now) ??
    checkLowProfitPairs(config.lowProfitPairs, pair, side, now);

  if (newLock) {
    addLock(newLock);
    return { allowed: false, reason: newLock.reason, until: newLock.until };
  }

  return { allowed: true };
}

/** Convenience for UI: human-readable summary of every currently active lock. */
export function describeActiveLocks(): string[] {
  return getActiveLocks().map(
    (l) => `${l.pair === "*" ? "ALL PAIRS" : l.pair} — ${l.reason} (until ${new Date(l.until).toLocaleTimeString()})`
  );
}

export type { BotTradeRecord };
