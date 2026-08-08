/* ══ NEXUS — Bot Trade Ledger ═════════════════════════════════════════════════
 *  localStorage-based record of every trade the connected bot actually
 *  closed (arbitrage fill, grid cell fill, volume-maker round-trip). This
 *  is the data source the protection engine (protections.ts) evaluates —
 *  without a real trade history there is nothing to protect against.
 *
 *  Mirrors the shape/retention approach of lib/signalStore.ts: newest-first
 *  storage, capped record count, no fake/synthetic entries. A trade is only
 *  ever recorded here after the bot reports it as closed with a known PnL —
 *  open/pending positions are not tracked in this ledger.
 * ═══════════════════════════════════════════════════════════════════════════ */

const STORE_KEY = "nexus_bot_trades_v1";
const MAX_RECORDS = 1000;

export type BotStrategy = "arbitrage" | "grid" | "volume_maker";
export type TradeSide = "long" | "short" | "*";

export interface BotTradeRecord {
  id: string;
  strategy: BotStrategy;
  pair: string;
  side: TradeSide;
  /** Realized profit for this trade, as a fraction (0.01 = +1%), matching
   *  freqtrade's close_profit convention so the same thresholds/config
   *  values are meaningful across strategies. */
  closeProfit: number;
  /** True if this trade closed via a stop-loss / liquidation-style exit
   *  rather than a normal take-profit or manual close. Needed for
   *  StoplossGuard-style checks — a low-profit close and a stopped-out
   *  close are different signals. */
  isStopExit: boolean;
  openedAt: number;
  closedAt: number;
}

function loadRecords(): BotTradeRecord[] {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "[]") as BotTradeRecord[];
  } catch {
    return [];
  }
}

function persistRecords(records: BotTradeRecord[]): void {
  const trimmed = records.slice(0, MAX_RECORDS);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota hit — evict oldest half and retry once (same policy as signalStore).
    try {
      const half = trimmed.slice(0, Math.floor(trimmed.length / 2));
      localStorage.setItem(STORE_KEY, JSON.stringify(half));
      console.warn("[BotTradeStore] localStorage quota hit — evicted oldest 50% of records");
    } catch (e) {
      console.error("[BotTradeStore] localStorage write failed even after eviction:", e);
    }
  }
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Record a closed trade reported by the bot. Call this from wherever the
 *  bot's execution result comes back (executeArbitrage result, grid cell
 *  fill event, volume-maker round-trip) — never speculatively. */
export function recordBotTrade(
  input: Omit<BotTradeRecord, "id">
): BotTradeRecord {
  const record: BotTradeRecord = { id: uid(), ...input };
  const records = [record, ...loadRecords()];
  persistRecords(records);
  return record;
}

/** All recorded trades, newest first. */
export function getAllBotTrades(): BotTradeRecord[] {
  return loadRecords();
}

/** Trades closed at or after `sinceMs`, optionally filtered by pair and/or
 *  strategy. Mirrors freqtrade's Trade.get_trades_proxy(pair=..., close_date=...)
 *  lookup pattern that the protection checks are built around. */
export function getTradesSince(
  sinceMs: number,
  opts: { pair?: string; strategy?: BotStrategy } = {}
): BotTradeRecord[] {
  return loadRecords().filter((t) => {
    if (t.closedAt < sinceMs) return false;
    if (opts.pair && t.pair !== opts.pair) return false;
    if (opts.strategy && t.strategy !== opts.strategy) return false;
    return true;
  });
}

export function clearBotTradeStore(): void {
  localStorage.removeItem(STORE_KEY);
}
