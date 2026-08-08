/* ══ NEXUS — Cross-exchange Spread Detection ════════════════════════════════
 *  Pure function: takes the latest aggregate market snapshot and returns
 *  arbitrage opportunities. No randomness, no fake history — baseline is
 *  computed from a real rolling buffer maintained by the caller.
 * ═══════════════════════════════════════════════════════════════════════════ */

import type { AggregateMarket, Exchange } from "./exchanges";

/* ── Spread plausibility filter ────────────────────────────────────────────
 * freqtrade concept (VolatilityFilter / SpreadFilter, plugins/pairlist/*)
 * re-implemented for this data shape: a raw cross-exchange spread with no
 * sanity check is just as likely to be a stale/bad tick on one feed as a
 * real dislocation — especially right after a WS reconnect. Two checks:
 *   1. MIN_SAMPLES — don't call anything "high confidence" until the
 *      rolling baseline has enough history to mean something (freqtrade
 *      won't trust a volatility reading with too short a lookback either).
 *   2. Outlier check — a spread many multiples of its own baseline average
 *      is far more likely to be a data glitch than a genuine opportunity;
 *      cap confidence instead of silently trusting it.
 * Nothing here is copied from freqtrade's source — only the "don't trust a
 * single implausible reading" pattern is re-implemented. */
const MIN_BASELINE_SAMPLES = 5;
const OUTLIER_MULTIPLE = 6; // spread > 6x its own rolling baseline → likely noise, not signal

export interface SpreadPlausibility {
  plausible: boolean;
  samples: number;
  reason?: string;
}

function assessPlausibility(spread: number, baselineArr: number[]): SpreadPlausibility {
  const samples = baselineArr.length;
  if (samples < MIN_BASELINE_SAMPLES) {
    return { plausible: true, samples, reason: `only ${samples}/${MIN_BASELINE_SAMPLES} baseline samples — confidence capped` };
  }
  const avg = baselineArr.reduce((a, b) => a + b, 0) / samples;
  if (avg > 0 && spread > avg * OUTLIER_MULTIPLE) {
    return { plausible: false, samples, reason: `${spread.toFixed(3)}% is ${(spread / avg).toFixed(1)}x its own baseline avg (${avg.toFixed(3)}%) — likely a stale/bad tick` };
  }
  return { plausible: true, samples };
}

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
  /** false = this reading looks like a stale/bad tick rather than a real dislocation — see assessPlausibility(). */
  plausible: boolean;
  plausibilityNote?: string;
  baselineSamples: number;
}

const PAIRS = [
  { symbol: "BTC", binance: "BTCUSDT", backpack: "BTC_USDC", hyperliquid: "BTC", okx: "BTC-USDT" },
  { symbol: "ETH", binance: "ETHUSDT", backpack: "ETH_USDC", hyperliquid: "ETH", okx: "ETH-USDT" },
  { symbol: "SOL", binance: "SOLUSDT", backpack: "SOL_USDC", hyperliquid: "SOL", okx: "SOL-USDT" },
  { symbol: "AVAX", binance: "AVAXUSDT", backpack: "AVAX_USDC", hyperliquid: "AVAX", okx: "AVAX-USDT" },
  { symbol: "LINK", binance: "LINKUSDT", backpack: "LINK_USDC", hyperliquid: "LINK", okx: "LINK-USDT" },
  { symbol: "ARB", binance: "ARBUSDT", backpack: "ARB_USDC", hyperliquid: "ARB", okx: "ARB-USDT" },
  { symbol: "SUI", binance: "SUIUSDT", backpack: "SUI_USDC", hyperliquid: "SUI", okx: "SUI-USDT" },
  { symbol: "OP",  binance: "OPUSDT",  backpack: "OP_USDC",  hyperliquid: "OP",  okx: "OP-USDT"  },
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

export const MIN_SPREAD_PCT = MIN_SPREAD;

export function getSpreadHistory(key: string): number[] {
  return history.get(key) ?? [];
}

/** Real rolling spread history for a given opportunity — same buffer
 *  checkLeg() reads/writes internally, exposed so the UI can chart actual
 *  samples instead of synthesizing fake ones. */
export function getOpportunityHistory(opp: ArbitrageOpportunity): number[] {
  const symbol = opp.pair.replace(/-USD$/, "");
  return getSpreadHistory(`${symbol}-${opp.exchanges[0]}-${opp.exchanges[1]}`);
}

/** One spread comparison between two exchange legs — the shared body every
 *  leg combo used to duplicate by hand. Pushes an opportunity onto `out` if
 *  the spread clears MIN_SPREAD, with plausibility-capped confidence. */
function checkLeg(
  out: ArbitrageOpportunity[],
  symbol: string,
  exA: Exchange, priceA: number,
  exB: Exchange, priceB: number,
  fundingRateDiff: number,
  notionalUsd: number,
  timestamp: number,
): void {
  const spread = (Math.abs(priceA - priceB) / Math.min(priceA, priceB)) * 100;
  if (spread <= MIN_SPREAD) return;

  const key = `${symbol}-${exA}-${exB}`;
  const plaus = assessPlausibility(spread, getSpreadHistory(key));
  const baseline = pushHistory(key, spread);
  const rawConfidence = spread > 0.3 ? "high" : spread > 0.15 ? "medium" : "low";

  out.push({
    id: `${symbol}-${exA}-${exB}`,
    pair: `${symbol}-USD`,
    exchanges: [exA, exB],
    spreadPercent: +spread.toFixed(4),
    fundingRateDiff: +fundingRateDiff.toFixed(6),
    historicalBaseline: +baseline.toFixed(4),
    confidence: plaus.plausible ? rawConfidence : "low",
    direction: priceA > priceB ? "short_long" : "long_short",
    estimatedProfitUsd: +((spread / 100) * notionalUsd).toFixed(2),
    prices: { [exA]: priceA, [exB]: priceB },
    timestamp,
    plausible: plaus.plausible,
    plausibilityNote: plaus.reason,
    baselineSamples: plaus.samples,
  });
}

export function scanArbitrage(market: AggregateMarket, notionalUsd = 1000): ArbitrageOpportunity[] {
  const out: ArbitrageOpportunity[] = [];
  const hlMap = new Map(market.hyperliquid.map((a) => [a.symbol, a]));
  const bpMap = new Map(market.backpack.map((a) => [a.symbol, a]));
  const bnMap = new Map(market.binance.map((a) => [a.symbol, a]));
  const okxMap = new Map(market.okx.map((a) => [a.symbol, a]));

  for (const pair of PAIRS) {
    const hl = hlMap.get(pair.hyperliquid);
    const bp = bpMap.get(pair.backpack);
    const bn = bnMap.get(pair.binance);
    const okx = okxMap.get(pair.okx);

    const hlPrice = hl ? (hl.markPrice || hl.midPrice) : 0;
    const fundingDiff = hl ? Math.abs(hl.fundingRate) * 100 : 0;

    if (hlPrice) {
      if (bp?.lastPrice)  checkLeg(out, pair.symbol, "hyperliquid", hlPrice, "backpack", bp.lastPrice, fundingDiff, notionalUsd, market.timestamp);
      if (bn?.lastPrice)  checkLeg(out, pair.symbol, "hyperliquid", hlPrice, "binance",  bn.lastPrice, fundingDiff, notionalUsd, market.timestamp);
      if (okx?.lastPrice) checkLeg(out, pair.symbol, "hyperliquid", hlPrice, "okx",      okx.lastPrice, fundingDiff, notionalUsd, market.timestamp);
    }
    // Spot-vs-spot legs (no funding rate involved — CEX/CEX arb, not perp basis)
    if (bn?.lastPrice && okx?.lastPrice) {
      checkLeg(out, pair.symbol, "binance", bn.lastPrice, "okx", okx.lastPrice, 0, notionalUsd, market.timestamp);
    }
  }
  return out.sort((a, b) => b.spreadPercent - a.spreadPercent);
}
