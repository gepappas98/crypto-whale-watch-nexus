/* ══ NEXUS BOT — CCXT execution ═══════════════════════════════════════════════
 *  CCXT gives one interface across ~100 exchanges, which is exactly what
 *  Nexus's multi-exchange arbitrage/grid concept needs — no separate bot
 *  process to run and babysit, just server-side code using a mature,
 *  widely-used library.
 *
 *  CREDENTIALS: read from environment variables only, per exchange:
 *    <EXCHANGE>_API_KEY, <EXCHANGE>_API_SECRET, <EXCHANGE>_API_PASSPHRASE (if needed)
 *  e.g. BINANCE_API_KEY, OKX_API_KEY + OKX_API_PASSPHRASE. Never commit these,
 *  never send them to the browser — see server/.env (gitignored).
 *
 *  HONESTY NOTE: this places real orders when dry-run is off. Grid
 *  "maintenance" (re-placing a level once it fills) and the volume-maker's
 *  trading loop both need a long-running process, not just a single HTTP
 *  request/response — see server/services/nexusBotWorker.ts for the
 *  polling loop that covers that. Test everything against exchange
 *  testnets before pointing NEXUS_LIVE_TRADING_CONFIRM at a funded account.
 * ═══════════════════════════════════════════════════════════════════════════ */
import ccxt from 'ccxt';

const ENV_PREFIX: Record<string, string> = {
  binance: 'BINANCE',
  okx: 'OKX',
  hyperliquid: 'HYPERLIQUID',
  backpack: 'BACKPACK',
};

const instances = new Map<string, ccxt.Exchange>();

/** Lazily builds + caches one authenticated ccxt instance per exchange id. */
function getExchange(exchangeId: string): ccxt.Exchange {
  const cached = instances.get(exchangeId);
  if (cached) return cached;

  const prefix = ENV_PREFIX[exchangeId] ?? exchangeId.toUpperCase();
  const apiKey = process.env[`${prefix}_API_KEY`];
  const secret = process.env[`${prefix}_API_SECRET`];
  const password = process.env[`${prefix}_API_PASSPHRASE`];

  if (!apiKey || !secret) {
    throw new Error(`No API credentials for "${exchangeId}" — set ${prefix}_API_KEY and ${prefix}_API_SECRET in server/.env`);
  }

  const ExchangeClass = (ccxt as unknown as Record<string, new (cfg: Record<string, unknown>) => ccxt.Exchange>)[exchangeId];
  if (!ExchangeClass) {
    throw new Error(`ccxt has no exchange named "${exchangeId}" (checked at runtime — see the ccxt.exchanges list for supported ids)`);
  }

  const ex = new ExchangeClass({ apiKey, secret, password, enableRateLimit: true });
  instances.set(exchangeId, ex);
  return ex;
}

function pairFor(symbol: string, quote = 'USDT'): string {
  return `${symbol}/${quote}`;
}

// ── Arbitrage: two simultaneous legs ─────────────────────────────────────────

export interface ArbitrageLegResult {
  ok: boolean;
  dryRun?: boolean;
  orders?: Record<string, unknown>;
  simulated?: Record<string, unknown>;
  error?: string;
}

export async function executeArbitrageLegs(
  opp: { exchanges: [string, string]; pair: string; direction: string; prices: Record<string, number> },
  notionalUsd: number,
  dryRun: boolean,
): Promise<ArbitrageLegResult> {
  const [exA, exB] = opp.exchanges;
  const symbol = opp.pair.replace(/-USD$/, '');
  const pair = pairFor(symbol);
  const [wordA, wordB] = opp.direction.split('_');
  const sideA = wordA === 'long' ? 'buy' : 'sell';
  const sideB = wordB === 'long' ? 'buy' : 'sell';

  if (dryRun) {
    return {
      ok: true, dryRun: true,
      simulated: { [exA]: { pair, side: sideA, notionalUsd }, [exB]: { pair, side: sideB, notionalUsd } },
    };
  }

  try {
    const priceA = opp.prices[exA] ?? 0;
    const priceB = opp.prices[exB] ?? 0;
    if (priceA <= 0 || priceB <= 0) return { ok: false, error: 'missing leg price(s) — refusing to size an order off a zero/unknown price' };

    const [instA, instB] = [getExchange(exA), getExchange(exB)];
    const [orderA, orderB] = await Promise.all([
      instA.createOrder(pair, 'market', sideA, notionalUsd / priceA),
      instB.createOrder(pair, 'market', sideB, notionalUsd / priceB),
    ]);
    return { ok: true, orders: { [exA]: orderA, [exB]: orderB } };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ── Grid: initial level placement + teardown ────────────────────────────────

export interface GridPlacementResult {
  orderIds: string[];
  simulated?: boolean;
  errors?: string[];
}

export async function placeGridOrders(cfg: {
  exchange: string; symbol: string; upperPrice: number; lowerPrice: number;
  gridCount: number; totalInvestment: number;
}, dryRun: boolean): Promise<GridPlacementResult> {
  const pair = pairFor(cfg.symbol);
  const step = (cfg.upperPrice - cfg.lowerPrice) / Math.max(1, cfg.gridCount);
  const investmentPerLevel = cfg.totalInvestment / Math.max(1, cfg.gridCount);
  const levelPrices = Array.from({ length: cfg.gridCount }, (_, i) => cfg.lowerPrice + step * i);

  if (dryRun) {
    return { orderIds: levelPrices.map((p, i) => `dryrun-${i}-${p.toFixed(2)}`), simulated: true };
  }

  const ex = getExchange(cfg.exchange);
  let currentPrice: number;
  try {
    const ticker = await ex.fetchTicker(pair);
    currentPrice = ticker.last ?? (cfg.upperPrice + cfg.lowerPrice) / 2;
  } catch {
    currentPrice = (cfg.upperPrice + cfg.lowerPrice) / 2; // fall back to grid midpoint if the ticker fetch itself fails
  }

  const orderIds: string[] = [];
  const errors: string[] = [];
  for (const levelPrice of levelPrices) {
    const side = levelPrice < currentPrice ? 'buy' : 'sell';
    const amountBase = investmentPerLevel / levelPrice;
    try {
      const order = await ex.createOrder(pair, 'limit', side, amountBase, levelPrice);
      orderIds.push(String(order.id));
    } catch (err) {
      errors.push(`level @${levelPrice.toFixed(4)}: ${(err as Error).message}`);
    }
  }
  return { orderIds, errors: errors.length ? errors : undefined };
}

export async function cancelGridOrders(exchange: string, symbol: string, orderIds: string[]): Promise<{ cancelled: number; errors: string[] }> {
  const realIds = orderIds.filter((id) => !id.startsWith('dryrun-'));
  if (realIds.length === 0) return { cancelled: 0, errors: [] };

  const pair = pairFor(symbol);
  const ex = getExchange(exchange);
  let cancelled = 0;
  const errors: string[] = [];
  for (const id of realIds) {
    try {
      await ex.cancelOrder(id, pair);
      cancelled++;
    } catch (err) {
      errors.push(`${id}: ${(err as Error).message}`);
    }
  }
  return { cancelled, errors };
}

// ── Portfolio: balances across every exchange with configured credentials ────

export async function fetchPortfolioBalances(): Promise<Array<{ name: string; balanceUsd: number; connected: boolean }>> {
  const results: Array<{ name: string; balanceUsd: number; connected: boolean }> = [];
  for (const exchangeId of Object.keys(ENV_PREFIX)) {
    const prefix = ENV_PREFIX[exchangeId];
    if (!process.env[`${prefix}_API_KEY`]) {
      results.push({ name: exchangeId, balanceUsd: 0, connected: false });
      continue;
    }
    try {
      const ex = getExchange(exchangeId);
      const balance = await ex.fetchBalance();
      const totalUsd = typeof balance.total?.USDT === 'number' ? balance.total.USDT : 0;
      results.push({ name: exchangeId, balanceUsd: totalUsd, connected: true });
    } catch (err) {
      console.error(`[ccxtExecutor] balance fetch failed for ${exchangeId}`, (err as Error).message);
      results.push({ name: exchangeId, balanceUsd: 0, connected: false });
    }
  }
  return results;
}

// ── Server-side arbitrage scan (for MCP / non-browser callers) ───────────────
// The browser's own scan (lib/nexus/arbitrage.ts's scanArbitrage) reads live
// WS/REST aggregate data assembled client-side and isn't reachable from here
// — this is a separate, simpler REST-only scan across whichever exchanges
// have credentials configured, using ccxt's fetchTicker directly. Same
// MIN_SPREAD/plausibility spirit, deliberately not a byte-for-byte port.
const SCAN_SYMBOLS = ['BTC', 'ETH', 'SOL', 'AVAX', 'LINK'];
const SCAN_MIN_SPREAD_PCT = 0.05;

export interface ServerArbitrageOpportunity {
  pair: string;
  exchanges: [string, string];
  spreadPercent: number;
  direction: 'long_short' | 'short_long';
  prices: Record<string, number>;
  plausible: true; // no rolling-baseline history server-side yet — see note below
}

export async function scanServerArbitrage(): Promise<ServerArbitrageOpportunity[]> {
  const configured = Object.keys(ENV_PREFIX).filter((id) => process.env[`${ENV_PREFIX[id]}_API_KEY`]);
  if (configured.length < 2) return []; // need at least two exchanges to compare

  const out: ServerArbitrageOpportunity[] = [];
  for (const symbol of SCAN_SYMBOLS) {
    const pair = pairFor(symbol);
    const prices: Record<string, number> = {};
    for (const exchangeId of configured) {
      try {
        const ticker = await getExchange(exchangeId).fetchTicker(pair);
        if (ticker.last) prices[exchangeId] = ticker.last;
      } catch {
        // exchange doesn't list this pair, or a transient fetch error — skip, not fatal to the whole scan
      }
    }
    const entries = Object.entries(prices);
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [exA, priceA] = entries[i];
        const [exB, priceB] = entries[j];
        const spread = (Math.abs(priceA - priceB) / Math.min(priceA, priceB)) * 100;
        if (spread <= SCAN_MIN_SPREAD_PCT) continue;
        out.push({
          pair: `${symbol}-USD`,
          exchanges: [exA, exB],
          spreadPercent: +spread.toFixed(4),
          direction: priceA > priceB ? 'short_long' : 'long_short',
          prices: { [exA]: priceA, [exB]: priceB },
          // NOTE: no rolling baseline exists server-side yet (that's the
          // browser scan's job) — every result here is unconditionally
          // "plausible" in the object shape only so it satisfies
          // executeArbitrageLegs' expected input; it has NOT actually been
          // checked against history the way lib/nexus/arbitrage.ts's
          // assessPlausibility() does. Treat these as leads to verify, not
          // pre-vetted opportunities.
          plausible: true,
        });
      }
    }
  }
  return out.sort((a, b) => b.spreadPercent - a.spreadPercent);
}

// ── Grid maintenance: detect fills, re-place the opposite order ─────────────
// Classic grid-bot behavior: a filled BUY means price dropped to that level,
// so place a SELL one grid-step up to capture the bounce back; a filled SELL
// means place a BUY one step down. This is what turns "placed N orders once"
// into an actual running grid instead of a one-shot order dump.

export interface GridMaintenanceResult {
  filledOrderIds: string[];
  /** Every filled order this tick, in fetch order — feeds gridPnl.ts's FIFO matcher. */
  fills: Array<{ side: 'buy' | 'sell'; price: number; amountBase: number; feeUsd: number }>;
  newOrders: Array<{ oldId: string; newId: string; side: 'buy' | 'sell'; price: number }>;
  errors: string[];
}

export async function checkAndMaintainGrid(grid: {
  exchange: string; symbol: string; orderIds: string[];
  upperPrice: number; lowerPrice: number; gridCount: number; totalInvestment: number;
}): Promise<GridMaintenanceResult> {
  const result: GridMaintenanceResult = { filledOrderIds: [], fills: [], newOrders: [], errors: [] };
  const realOrderIds = grid.orderIds.filter((id) => !id.startsWith('dryrun-'));
  if (realOrderIds.length === 0) return result; // dry-run grid — nothing real to poll

  const pair = pairFor(grid.symbol);
  const step = (grid.upperPrice - grid.lowerPrice) / Math.max(1, grid.gridCount);
  const investmentPerLevel = grid.totalInvestment / Math.max(1, grid.gridCount);
  const ex = getExchange(grid.exchange);

  for (const orderId of realOrderIds) {
    let order;
    try {
      order = await ex.fetchOrder(orderId, pair);
    } catch (err) {
      result.errors.push(`fetchOrder ${orderId}: ${(err as Error).message}`);
      continue;
    }
    if (order.status !== 'closed' || !order.filled) continue; // not filled yet — nothing to do this tick

    result.filledOrderIds.push(orderId);
    const filledPrice = order.price ?? 0;
    const filledSide = order.side as 'buy' | 'sell' | undefined;
    if (!filledSide || filledPrice <= 0) {
      result.errors.push(`${orderId} filled but has no usable side/price — cannot re-place`);
      continue;
    }

    const filledFee = (order as { fee?: { cost?: number } }).fee?.cost ?? 0;
    result.fills.push({ side: filledSide, price: filledPrice, amountBase: order.filled, feeUsd: filledFee });

    const newSide: 'buy' | 'sell' = filledSide === 'buy' ? 'sell' : 'buy';
    const newPrice = newSide === 'sell' ? filledPrice + step : filledPrice - step;
    if (newPrice <= 0) continue; // fell below the bottom of the grid — nothing sensible to re-place

    try {
      const amountBase = investmentPerLevel / newPrice;
      const newOrder = await ex.createOrder(pair, 'limit', newSide, amountBase, newPrice);
      result.newOrders.push({ oldId: orderId, newId: String(newOrder.id), side: newSide, price: newPrice });
    } catch (err) {
      result.errors.push(`re-place after fill of ${orderId}: ${(err as Error).message}`);
    }
  }

  return result;
}

// ── Volume Maker: a conservative "ping-pong" tick ────────────────────────────
// Deliberately NOT a sophisticated market-maker (no order-book-aware
// quoting, no inventory management beyond immediately flattening). It's a
// small, honest reference loop: alternate tiny market buy/sell pairs on one
// symbol to generate real, on-exchange volume — real enough to accrue real
// fees/rebates, small enough that a config mistake doesn't do much damage.
// Position stays roughly flat since each tick round-trips buy-then-sell.

const TICK_USD = Number(process.env.NEXUS_VOLUME_MAKER_TICK_USD || 10);

export interface VolumeMakerTickResult {
  ok: boolean;
  volumeUsd: number;
  feeUsd: number;
  error?: string;
}

export async function executeVolumeMakerTick(exchange: string, symbol: string): Promise<VolumeMakerTickResult> {
  const pair = pairFor(symbol);
  try {
    const ex = getExchange(exchange);
    const ticker = await ex.fetchTicker(pair);
    const price = ticker.last;
    if (!price) return { ok: false, volumeUsd: 0, feeUsd: 0, error: `no last price for ${pair}` };

    const amountBase = TICK_USD / price;
    const buy = await ex.createOrder(pair, 'market', 'buy', amountBase);
    const sell = await ex.createOrder(pair, 'market', 'sell', amountBase);

    const feeUsd = [buy, sell].reduce((sum, o) => {
      const fee = (o as { fee?: { cost?: number } }).fee;
      return sum + (fee?.cost ?? 0);
    }, 0);

    return { ok: true, volumeUsd: TICK_USD * 2, feeUsd };
  } catch (err) {
    return { ok: false, volumeUsd: 0, feeUsd: 0, error: (err as Error).message };
  }
}
