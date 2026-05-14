/* ══ NEXUS — Cross-exchange Spread Detection ════════════════════════════════
 *  Pure function: takes the latest aggregate market snapshot and returns
 *  arbitrage opportunities. No randomness, no fake history — baseline is
 *  computed from a real rolling buffer maintained by the caller.
 * ═══════════════════════════════════════════════════════════════════════════ */

import type { AggregateMarket, Exchange } from "./exchanges";

export interface ArbitrageOpportunity {
  id: string;
  pair: string;
  exchanges: [Exchange, Exchange];
  spreadPercent: number;
  fundingRateDiff: number;
  historicalBaseline: number;
  confidence: "high" | "medium" | "low";
  direction: "long_short" | "short_long";
  estimatedProfitUsd: number;
  prices: Partial<Record<Exchange, number>>;
  timestamp: number;
}

const PAIRS = [
  { symbol: "BTC", binance: "BTCUSDT", backpack: "BTC_USDC", hyperliquid: "BTC" },
  { symbol: "ETH", binance: "ETHUSDT", backpack: "ETH_USDC", hyperliquid: "ETH" },
  { symbol: "SOL", binance: "SOLUSDT", backpack: "SOL_USDC", hyperliquid: "SOL" },
  { symbol: "AVAX", binance: "AVAXUSDT", backpack: "AVAX_USDC", hyperliquid: "AVAX" },
  { symbol: "LINK", binance: "LINKUSDT", backpack: "LINK_USDC", hyperliquid: "LINK" },
  { symbol: "ARB", binance: "ARBUSDT", backpack: "ARB_USDC", hyperliquid: "ARB" },
  { symbol: "SUI", binance: "SUIUSDT", backpack: "SUI_USDC", hyperliquid: "SUI" },
  { symbol: "OP",  binance: "OPUSDT",  backpack: "OP_USDC",  hyperliquid: "OP"  },
];

const MIN_SPREAD = 0.05; // %

// Rolling baseline buffer (real samples only)
const history = new Map<string, number[]>();
const HISTORY_MAX = 100;

function pushHistory(key: string, value: number): number {
  const arr = history.get(key) ?? [];
  arr.push(value);
  if (arr.length > HISTORY_MAX) arr.shift();
  history.set(key, arr);
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function getSpreadHistory(key: string): number[] {
  return history.get(key) ?? [];
}

export function scanArbitrage(market: AggregateMarket, notionalUsd = 1000): ArbitrageOpportunity[] {
  const out: ArbitrageOpportunity[] = [];
  const hlMap = new Map(market.hyperliquid.map((a) => [a.symbol, a]));
  const bpMap = new Map(market.backpack.map((a) => [a.symbol, a]));
  const bnMap = new Map(market.binance.map((a) => [a.symbol, a]));

  for (const pair of PAIRS) {
    const hl = hlMap.get(pair.hyperliquid);
    const bp = bpMap.get(pair.backpack);
    const bn = bnMap.get(pair.binance);
    if (!hl) continue;
    const hlPrice = hl.markPrice || hl.midPrice;
    if (!hlPrice) continue;

    // HL vs BP
    if (bp && bp.lastPrice) {
      const spread = (Math.abs(hlPrice - bp.lastPrice) / Math.min(hlPrice, bp.lastPrice)) * 100;
      const baseline = pushHistory(`${pair.symbol}-HL-BP`, spread);
      if (spread > MIN_SPREAD) {
        out.push({
          id: `${pair.symbol}-hl-bp`,
          pair: `${pair.symbol}-USD`,
          exchanges: ["hyperliquid", "backpack"],
          spreadPercent: +spread.toFixed(4),
          fundingRateDiff: +(Math.abs(hl.fundingRate) * 100).toFixed(6),
          historicalBaseline: +baseline.toFixed(4),
          confidence: spread > 0.3 ? "high" : spread > 0.15 ? "medium" : "low",
          direction: hlPrice > bp.lastPrice ? "short_long" : "long_short",
          estimatedProfitUsd: +((spread / 100) * notionalUsd).toFixed(2),
          prices: { hyperliquid: hlPrice, backpack: bp.lastPrice },
          timestamp: market.timestamp,
        });
      }
    }
    // HL vs BN
    if (bn && bn.lastPrice) {
      const spread = (Math.abs(hlPrice - bn.lastPrice) / Math.min(hlPrice, bn.lastPrice)) * 100;
      const baseline = pushHistory(`${pair.symbol}-HL-BN`, spread);
      if (spread > MIN_SPREAD) {
        out.push({
          id: `${pair.symbol}-hl-bn`,
          pair: `${pair.symbol}-USD`,
          exchanges: ["hyperliquid", "binance"],
          spreadPercent: +spread.toFixed(4),
          fundingRateDiff: +(Math.abs(hl.fundingRate) * 100).toFixed(6),
          historicalBaseline: +baseline.toFixed(4),
          confidence: spread > 0.3 ? "high" : spread > 0.15 ? "medium" : "low",
          direction: hlPrice > bn.lastPrice ? "short_long" : "long_short",
          estimatedProfitUsd: +((spread / 100) * notionalUsd).toFixed(2),
          prices: { hyperliquid: hlPrice, binance: bn.lastPrice },
          timestamp: market.timestamp,
        });
      }
    }
  }
  return out.sort((a, b) => b.spreadPercent - a.spreadPercent);
}
