/* ══ NEXUS — Open Trades Limit ═════════════════════════════════════════════════
 *  Ported concept from freqtrade's plugins/pairlist/FullTradesFilter.py:
 *  "Shrink whitelist when trade slots are full." Freqtrade caps concurrent
 *  positions with `max_open_trades`; once that many are open, it stops
 *  offering new pairs at all rather than letting a doomed order attempt
 *  queue up. This does the same thing for the Nexus Bot's concurrent grids.
 *
 *  Re-implemented from scratch against this app's own TradingBot interface
 *  (lib/nexus/bot.ts) — no freqtrade source copied, only the concept: check
 *  capacity BEFORE the protection engine even runs, since "no free slots"
 *  is a capacity fact, not a risk judgement.
 * ═══════════════════════════════════════════════════════════════════════════ */

import type { TradingBot, GridStatus } from "./bot";

const CONFIG_KEY = "nexus_max_open_trades_v1";
const DEFAULT_MAX_OPEN_TRADES = 5; // freqtrade's own default max_open_trades

export function getMaxOpenTrades(): number {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_OPEN_TRADES;
  } catch {
    return DEFAULT_MAX_OPEN_TRADES;
  }
}

export function setMaxOpenTrades(n: number): void {
  try {
    localStorage.setItem(CONFIG_KEY, String(Math.max(1, Math.floor(n))));
  } catch (e) {
    console.error("[OpenTradesLimit] failed to persist max_open_trades:", e);
  }
}

export interface SlotCheckResult {
  hasFreeSlot: boolean;
  openCount: number;
  maxOpenTrades: number;
  reason?: string;
}

/**
 * Counts the bot's currently active grids and compares against the
 * configured cap. Only counts `status === "active"` — stopped/error grids
 * aren't holding exposure. Mirrors FullTradesFilter's use of
 * `Trade.get_open_trade_count()` against `config.max_open_trades`.
 */
export async function checkOpenTradeSlot(
  bot: TradingBot,
  maxOpenTrades: number = getMaxOpenTrades()
): Promise<SlotCheckResult> {
  let grids: GridStatus[];
  try {
    grids = await bot.listGrids();
  } catch (e) {
    // If we can't verify capacity, don't silently allow past the cap —
    // fail closed, same posture as pairQuality.ts when a market fetch fails.
    return {
      hasFreeSlot: false,
      openCount: -1,
      maxOpenTrades,
      reason: `Could not verify open trade count: ${(e as Error).message}`,
    };
  }

  const openCount = grids.filter((g) => g.status === "active").length;
  if (openCount >= maxOpenTrades) {
    return {
      hasFreeSlot: false,
      openCount,
      maxOpenTrades,
      reason: `${openCount}/${maxOpenTrades} trade slots full — new positions blocked until one closes`,
    };
  }
  return { hasFreeSlot: true, openCount, maxOpenTrades };
}
