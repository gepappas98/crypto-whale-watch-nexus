/* ══ NEXUS — Trading Bot Plug-in Interface ══════════════════════════════════
 *  This is the seam where the user's external trading bot will plug in.
 *  Until a bot is registered, every feature reports "not connected" and the
 *  UI renders empty states — never fake numbers.
 * ═══════════════════════════════════════════════════════════════════════════ */

import type { ArbitrageOpportunity } from "./arbitrage";
import { canTrade, type TradeGateResult } from "./protections";
import { recordBotTrade, type BotStrategy } from "./botTradeStore";

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
  startVolumeMaker(opts: { mode: string; signalSource: string }): Promise<VolumeStats>;
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
): Promise<{ ok: boolean; txHash?: string; error?: string }> {
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
  const gate = canTrade(opp.pair, "*");
  if (!gate.allowed) throw new ProtectionBlockedError(gate);
  return bot.executeArbitrage(opp);
}

export async function createGridGuarded(cfg: GridConfig): Promise<GridStatus> {
  if (!bot) throw new Error("No trading bot connected");
  const gate = canTrade(cfg.symbol, "*");
  if (!gate.allowed) throw new ProtectionBlockedError(gate);
  return bot.createGrid(cfg);
}

export async function startVolumeMakerGuarded(opts: {
  mode: string;
  signalSource: string;
}): Promise<VolumeStats> {
  if (!bot) throw new Error("No trading bot connected");
  const gate = canTrade("*", "*");
  if (!gate.allowed) throw new ProtectionBlockedError(gate);
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
