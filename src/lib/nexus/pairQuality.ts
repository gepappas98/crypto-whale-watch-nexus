/* ══ NEXUS — Pair Quality Gate ═════════════════════════════════════════════════
 *
 *  Ported concept from freqtrade's plugins/pairlist/* (VolumePairList,
 *  RangeStabilityFilter) — re-implemented from scratch against this app's
 *  own Nexus exchange tickers (lib/nexus/exchanges.ts), the same way
 *  protections.ts re-implements freqtrade's protections against this app's
 *  own bot trade ledger. See lib/pairFilters.ts for the sibling version of
 *  this idea already wired into the whale-radar alert pipeline — this is
 *  the same philosophy, adapted to Nexus's own ticker shape because the
 *  data available here (BNTicker/BPTicker/OKXTicker) doesn't carry the
 *  market-cap/DEX-liquidity fields pairFilters.ts expects from CoinGecko.
 *
 *  Call `checkPairQuality(symbol, exchange)` before letting the bot open
 *  new exposure on a pair it hasn't been explicitly told is safe (e.g. a
 *  grid on a symbol picked from user input or an external signal) — it's
 *  wired into createGridGuarded() in bot.ts, right alongside the existing
 *  canTrade() trade-history gate.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { fetchAllMarkets, type Exchange } from "./exchanges";

export interface PairQualityResult {
  ok: boolean;
  reason?: string;
}

/** Below this 24h quote volume, a pair is thin enough that grid orders can
 *  move the price themselves — not a liquidity profile worth automating. */
const MIN_QUOTE_VOLUME_USD = 50_000;

/** A 24h change past this is far more likely a bad tick / delisting event
 *  than a real move on a pair liquid enough to pass the volume floor above. */
const MAX_PLAUSIBLE_CHANGE_PCT = 500;

const TICKERED_EXCHANGES = new Set<Exchange>(["binance", "backpack", "okx"]);

/**
 * Looks up the most recent ticker for `symbol` on `exchange` and checks it
 * against the same two failure modes lib/pairFilters.ts guards against for
 * whale-radar alerts: dead/no-liquidity pairs, and implausible price moves
 * that suggest bad data rather than a real market event.
 *
 * Exchanges without ticker coverage here (hyperliquid — perp mark price,
 * no comparable spot quote-volume field in this shape) are allowed through
 * unchecked; this gate only covers what it can actually verify.
 */
export async function checkPairQuality(symbol: string, exchange: Exchange): Promise<PairQualityResult> {
  if (!TICKERED_EXCHANGES.has(exchange)) {
    return { ok: true }; // nothing to check this data shape against — don't block on ignorance
  }

  let market;
  try {
    market = await fetchAllMarkets();
  } catch (err) {
    return { ok: false, reason: `Could not fetch ${exchange} market data to verify liquidity: ${(err as Error).message}` };
  }

  const list = exchange === "binance" ? market.binance : exchange === "backpack" ? market.backpack : market.okx;
  const needle = symbol.toUpperCase();
  const ticker = list.find((t) => t.symbol.toUpperCase().startsWith(needle));

  if (!ticker) {
    return { ok: false, reason: `No live ${exchange} ticker found for ${symbol} — can't verify liquidity, refusing by default` };
  }
  if (ticker.quoteVolume < MIN_QUOTE_VOLUME_USD) {
    return { ok: false, reason: `${symbol} 24h quote volume $${ticker.quoteVolume.toFixed(0)} is below the $${MIN_QUOTE_VOLUME_USD.toLocaleString()} floor — too illiquid to grid-trade safely` };
  }
  if (Math.abs(ticker.priceChangePercent) > MAX_PLAUSIBLE_CHANGE_PCT) {
    return { ok: false, reason: `${symbol} 24h change ${ticker.priceChangePercent.toFixed(0)}% exceeds the plausible bound (${MAX_PLAUSIBLE_CHANGE_PCT}%) — likely bad data, not a real move` };
  }
  return { ok: true };
}
