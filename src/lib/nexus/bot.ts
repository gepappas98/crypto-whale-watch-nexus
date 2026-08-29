/* ══ NEXUS — Trading Bot Plug-in Interface ══════════════════════════════════
 *  This is the seam where the user's external trading bot will plug in.
 *  Until a bot is registered, every feature reports "not connected" and the
 *  UI renders empty states — never fake numbers.
 * ═══════════════════════════════════════════════════════════════════════════ */

import type { ArbitrageOpportunity } from "./arbitrage";
import { canTrade, type TradeGateResult } from "./protections";
import { checkCircuitBreaker } from "./circuitBreaker";
import { checkDailyRiskGate } from "./dailyRiskGate";
import { recordBotTrade, type BotStrategy } from "./botTradeStore";
import { checkPairQuality } from "./pairQuality";
import { checkOpenTradeSlot, type SlotCheckResult } from "./openTradesLimit";
import type { Exchange } from "./exchanges";

const NEXUS_TRACKED_EXCHANGES = new Set(["hyperliquid", "backpack", "binance", "okx"]);
function asNexusExchange(id: string): Exchange | null {
  return NEXUS_TRACKED_EXCHANGES.has(id) ? (id as Exchange) : null;
}

export interface GridConfig {
  id: string;
  exchange: string;
  symbol: string;
  marketType: "spot" | "perpetual";
  mode: "normal" | "martingale" | "moving" | "scalping" | "capital_protection";
  upperPrice: number;
  lowerPrice: number;
  gridCount: number;
  totalInvestment: number;
  feeRate: number;
}

export interface GridStatus extends GridConfig {
  status: "active" | "stopped" | "error";
  pnl: number;
  filledGrids: number;
  activeOrders: number;
  createdAt: number;
}

export interface PortfolioSummary {
  totalAumUsd: number;
  dailyPnlUsd: number;
  winRate: number;
  activeStrategies: number;
  exchanges: Array<{ name: string; balanceUsd: number; connected: boolean }>;
}

export interface VolumeStats {
  active: boolean;
  mode: string;
  totalVolumeUsd: number;
  feesUsd: number;
  rebatesUsd: number;
  trades: number;
  /** What the worker is actually trading — undefined only for bot
   *  implementations that predate this (kept optional for compatibility). */
  exchange?: string;
  symbol?: string;
}

export interface TradingBot {
  name: string;
  version: string;
  // Arbitrage
  executeArbitrage(opp: ArbitrageOpportunity): Promise<{ ok: boolean; txHash?: string; error?: string }>;
  // Grid
  listGrids(): Promise<GridStatus[]>;
  createGrid(cfg: GridConfig): Promise<GridStatus>;
  stopGrid(id: string): Promise<void>;
  // Volume maker
  startVolumeMaker(opts: { mode: string; signalSource: string; exchange: string; symbol: string }): Promise<VolumeStats>;
  stopVolumeMaker(): Promise<VolumeStats>;
  getVolumeStats(): Promise<VolumeStats>;
  // Portfolio
  getPortfolio(): Promise<PortfolioSummary>;
}

let bot: TradingBot | null = null;

export function registerBot(b: TradingBot): void {
  bot = b;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("nexus:bot:registered", { detail: { name: b.name } }));
  }
}

export function unregisterBot(): void {
  bot = null;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("nexus:bot:unregistered"));
  }
}

export function getBot(): TradingBot | null {
  return bot;
}

export function isBotConnected(): boolean {
  return bot !== null;
}

/* ── Dry-run mode ─────────────────────────────────────────────────────────
 * Freqtrade-style `dry_run` config flag: when enabled, every guarded
 * execution below still runs the full protection/quality/capacity gate
 * chain and reports what WOULD have happened, but never calls the real
 * bot's execute/create methods — no order is placed, no exposure opens.
 * Useful for testing new protection thresholds live against real market
 * conditions before trusting them with real capital. Off by default. */

const DRY_RUN_KEY = "nexus_dry_run_v1";

export function isDryRun(): boolean {
  try {
    return localStorage.getItem(DRY_RUN_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDryRun(enabled: boolean): void {
  try {
    localStorage.setItem(DRY_RUN_KEY, enabled ? "1" : "0");
  } catch (e) {
    console.error("[Bot] failed to persist dry-run flag:", e);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("nexus:bot:dryrun", { detail: { enabled } }));
  }
}

/* ── Protection-gated execution ────────────────────────────────────────────
 * These wrap the raw TradingBot calls with canTrade() from protections.ts.
 * Use these from UI/hooks instead of calling the raw execute/create methods
 * whenever the action opens new exposure. Outcome recording (win/loss,
 * stop-exit or not) stays the caller's job via recordBotTrade — this layer
 * only decides whether the attempt is allowed to happen at all. */

export class ProtectionBlockedError extends Error {
  constructor(public readonly gate: TradeGateResult) {
    super(gate.reason ?? "Blocked by protection engine");
    this.name = "ProtectionBlockedError";
  }
}

export async function executeArbitrageGuarded(
  opp: ArbitrageOpportunity
): Promise<{ ok: boolean; txHash?: string; error?: string; dryRun?: boolean }> {
  if (!bot) throw new Error("No trading bot connected");
  // Reject opportunities that look like stale/bad ticks before even checking
  // trade-history protections — see assessPlausibility() in arbitrage.ts.
  // canTrade() only knows about past trades; it has no way to know THIS
  // reading is noise, so that check has to happen here, separately.
  if (!opp.plausible) {
    throw new ProtectionBlockedError({
      allowed: false,
      reason: opp.plausibilityNote ?? "Opportunity flagged as implausible (likely stale/bad tick)",
    });
  }
  // Liquidity check on both legs — plausibility above only catches a spread
  // that's an outlier vs its own history; a pair can have a small, perfectly
  // "normal" spread while still being thin enough that slippage eats the
  // captured edge. Same checkPairQuality() gate createGridGuarded uses.
  // Legs on exchanges outside pairQuality's coverage (e.g. hyperliquid,
  // a perp mark price with no comparable quote-volume field) pass through
  // unchecked, same as createGridGuarded.
  const symbol = opp.pair.replace(/-USD$/, "");
  for (const ex of opp.exchanges) {
    const nexusEx = asNexusExchange(ex);
    if (!nexusEx) continue;
    const quality = await checkPairQuality(symbol, nexusEx);
    if (!quality.ok) throw new ProtectionBlockedError({ allowed: false, reason: quality.reason });
  }
  const gate = canTrade(opp.pair, "*");
  if (!gate.allowed) throw new ProtectionBlockedError(gate);

  const dayRisk = checkDailyRiskGate();
  if (!dayRisk.allowed) {
    throw new ProtectionBlockedError({ allowed: false, reason: dayRisk.reason });
  }

  // Slippage vs mid from the two-leg price map when both quotes exist
  const priceVals = Object.values(opp.prices).filter(
    (p): p is number => typeof p === "number" && p > 0,
  );
  const mid = priceVals.length >= 2 ? (Math.min(...priceVals) + Math.max(...priceVals)) / 2 : 0;
  const fill = priceVals.length >= 2 ? Math.max(...priceVals) : 0;
  const circuit = checkCircuitBreaker(
    mid > 0 && fill > 0
      ? { midPrice: mid, estimatedFillPrice: fill, pair: opp.pair }
      : undefined,
  );
  if (!circuit.allowed) {
    throw new ProtectionBlockedError({ allowed: false, reason: circuit.reason });
  }

  if (isDryRun()) {
    console.info(`[DryRun] Would execute arbitrage on ${opp.pair} — all gates passed, no order placed.`);
    return { ok: true, dryRun: true };
  }
  return bot.executeArbitrage(opp);
}

export async function createGridGuarded(cfg: GridConfig): Promise<GridStatus> {
  if (!bot) throw new Error("No trading bot connected");
  // Liquidity/data-sanity check first — cfg.symbol can come from arbitrary user
  // input, unlike executeArbitrageGuarded's opp.plausible which is already
  // derived from a live scan. Exchanges we don't have ticker coverage for
  // (see pairQuality.ts's TICKERED_EXCHANGES) pass through unchecked.
  const nexusEx = asNexusExchange(cfg.exchange);
  if (nexusEx) {
    const quality = await checkPairQuality(cfg.symbol, nexusEx);
    if (!quality.ok) throw new ProtectionBlockedError({ allowed: false, reason: quality.reason });
  }
  // FullTradesFilter-style capacity gate — checked before the risk-based
  // protection checks, since "no free slots" is a capacity fact, not a
  // risk judgement, and there's no point evaluating cooldown/drawdown
  // locks for a trade that can't open anyway.
  const slot: SlotCheckResult = await checkOpenTradeSlot(bot);
  if (!slot.hasFreeSlot) {
    throw new ProtectionBlockedError({ allowed: false, reason: slot.reason });
  }
  const gate = canTrade(cfg.symbol, "*");
  if (!gate.allowed) throw new ProtectionBlockedError(gate);

  const dayRisk = checkDailyRiskGate();
  if (!dayRisk.allowed) {
    throw new ProtectionBlockedError({ allowed: false, reason: dayRisk.reason });
  }
  const circuit = checkCircuitBreaker();
  if (!circuit.allowed) {
    throw new ProtectionBlockedError({ allowed: false, reason: circuit.reason });
  }

  if (isDryRun()) {
    console.info(`[DryRun] Would create grid on ${cfg.symbol} (${cfg.exchange}) — all gates passed, no order placed.`);
    return {
      ...cfg,
      status: "active",
      pnl: 0,
      filledGrids: 0,
      activeOrders: 0,
      createdAt: Date.now(),
    };
  }
  return bot.createGrid(cfg);
}

export async function startVolumeMakerGuarded(opts: {
  mode: string;
  signalSource: string;
  exchange: string;
  symbol: string;
}): Promise<VolumeStats> {
  if (!bot) throw new Error("No trading bot connected");
  // Same liquidity/data-sanity gate as createGridGuarded — now that
  // VolumeMakerOpts carries a concrete exchange/symbol, there's something
  // to check it against. Exchanges outside pairQuality's coverage pass
  // through unchecked, same as grids.
  const nexusEx = asNexusExchange(opts.exchange);
  if (nexusEx) {
    const quality = await checkPairQuality(opts.symbol, nexusEx);
    if (!quality.ok) throw new ProtectionBlockedError({ allowed: false, reason: quality.reason });
  }
  const gate = canTrade("*", "*");
  if (!gate.allowed) throw new ProtectionBlockedError(gate);

  const dayRisk = checkDailyRiskGate();
  if (!dayRisk.allowed) {
    throw new ProtectionBlockedError({ allowed: false, reason: dayRisk.reason });
  }
  const circuit = checkCircuitBreaker();
  if (!circuit.allowed) {
    throw new ProtectionBlockedError({ allowed: false, reason: circuit.reason });
  }

  if (isDryRun()) {
    console.info(`[DryRun] Would start volume maker (${opts.mode} on ${opts.exchange}/${opts.symbol}) — all gates passed, no order placed.`);
    return { active: true, mode: opts.mode, totalVolumeUsd: 0, feesUsd: 0, rebatesUsd: 0, trades: 0, exchange: opts.exchange, symbol: opts.symbol };
  }
  return bot.startVolumeMaker(opts);
}

/** Log a closed trade's real outcome so future canTrade() checks see it.
 *  Call this once the bot confirms a fill/close with a known PnL — never
 *  speculatively, and never before the trade has actually closed. */
export function reportBotTradeClosed(input: {
  strategy: BotStrategy;
  pair: string;
  side: "long" | "short" | "*";
  closeProfit: number;
  isStopExit: boolean;
  openedAt: number;
  closedAt: number;
}): void {
  recordBotTrade(input);
}
