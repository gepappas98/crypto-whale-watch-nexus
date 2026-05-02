/* ══ NEXUS — Trading Bot Plug-in Interface ══════════════════════════════════
 *  This is the seam where the user's external trading bot will plug in.
 *  Until a bot is registered, every feature reports "not connected" and the
 *  UI renders empty states — never fake numbers.
 * ═══════════════════════════════════════════════════════════════════════════ */

import type { ArbitrageOpportunity } from "./arbitrage";

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
