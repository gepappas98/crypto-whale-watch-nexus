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
