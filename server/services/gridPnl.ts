/* ══ NEXUS BOT — grid PNL (FIFO cost-basis matching) ══════════════════════════
 *  A completed grid round-trip is: buy fills at some level → price bounces →
 *  the re-placed sell one step up fills → that pair is a realized profit of
 *  roughly (sellPrice - buyPrice) * amount, minus both legs' fees. This
 *  module does the matching: sells consume the OLDEST unmatched buys first
 *  (FIFO), same convention most simple cost-basis accounting uses.
 *
 *  Deliberately a pure function — no DB, no ccxt, easy to reason about and
 *  (if this project adds tests later) easy to test in isolation. The
 *  caller (nexusBotWorker.ts) is responsible for persisting `remainingBuys`
 *  as the grid's `open_buys` between ticks and adding `realizedPnlUsd` to
 *  the grid's running total.
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface Fill {
  side: 'buy' | 'sell';
  price: number;
  amountBase: number;
  feeUsd: number;
}

export interface FifoMatchResult {
  realizedPnlUsd: number;
  remainingBuys: Fill[];
}

const DUST = 1e-12; // below this base-asset amount, treat a partially-matched buy as fully consumed

/**
 * Matches `newFills` (in the order they occurred) against `openBuys` (carried
 * over from the previous call) using FIFO. A sell with no buy left to match
 * against contributes 0 realized PNL for the unmatched portion — this
 * happens for a grid's initial sell-side seed orders (placed above market
 * price with no prior buy), which is correct: there's no cost basis for
 * inventory the bot never bought.
 */
export function matchFillsFifo(openBuys: Fill[], newFills: Fill[]): FifoMatchResult {
  // Work on copies — never mutate the caller's arrays.
  const buys: Fill[] = openBuys.map((b) => ({ ...b }));
  let realizedPnlUsd = 0;

  for (const fill of newFills) {
    if (fill.side === 'buy') {
      if (fill.amountBase > DUST) buys.push({ ...fill });
      continue;
    }

    // sell — consume oldest buys first
    let remaining = fill.amountBase;
    const sellFeePerUnit = fill.amountBase > DUST ? fill.feeUsd / fill.amountBase : 0;

    while (remaining > DUST && buys.length > 0) {
      const buy = buys[0];
      const matched = Math.min(remaining, buy.amountBase);
      const buyFeePerUnit = buy.amountBase > DUST ? buy.feeUsd / buy.amountBase : 0;

      realizedPnlUsd += (fill.price - buy.price) * matched - (buyFeePerUnit + sellFeePerUnit) * matched;

      buy.amountBase -= matched;
      buy.feeUsd -= buyFeePerUnit * matched;
      remaining -= matched;
      if (buy.amountBase <= DUST) buys.shift();
    }
    // Any `remaining` left here filled with no cost basis available (see
    // docstring above) — intentionally not tracked as negative inventory.
  }

  return { realizedPnlUsd: +realizedPnlUsd.toFixed(6), remainingBuys: buys };
}
