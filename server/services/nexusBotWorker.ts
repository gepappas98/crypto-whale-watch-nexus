/* ══ NEXUS BOT — background worker ═══════════════════════════════════════════
 *  routes/nexusBot.ts's POST /grids places the INITIAL set of limit orders;
 *  a real grid bot also needs to notice when a level fills and re-place the
 *  opposite order there (buy fills → place a sell one step up, and vice
 *  versa) — that can't happen inside a single request/response, so it lives
 *  here as a polling loop instead.
 *
 *  SCOPE HONESTY: this covers grid maintenance only. The volume-maker's
 *  actual trading loop is NOT implemented — VolumeMakerOpts (bot.ts) has no
 *  symbol/pair field, so there's nothing concrete to trade yet. Wiring that
 *  up for real needs that interface extended first; faking a loop that
 *  "trades" without a symbol would just be theater. Track via the
 *  `active`/`mode` fields already recorded — a future worker tick can pick
 *  it up once the interface says what to trade.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { query } from '../db';
import { isServerDryRun } from './nexusBotGates';

const POLL_MS = Number(process.env.NEXUS_GRID_POLL_MS || 30_000);
let timer: ReturnType<typeof setInterval> | null = null;

async function maintainOneGrid(grid: {
  id: string; exchange: string; symbol: string; order_ids: string[];
  upper_price: string; lower_price: string; grid_count: number; total_investment: string;
}): Promise<void> {
  // Real per-order fill checking needs ccxt's fetchOrder/fetchOpenOrders per
  // exchange, which have inconsistent status field shapes across exchanges.
  // This is deliberately left as the next concrete step rather than
  // papering over it — see the TODO below for exactly what to fill in.
  //
  // TODO: for each id in grid.order_ids not already known-filled:
  //   const order = await ex.fetchOrder(id, pair);
  //   if (order.status === 'closed') {
  //     // filled — place the opposite order one grid-step away, record the
  //     // fill via recordTrade({kind:'grid_open', ...}), update order_ids.
  //   }
  void grid; // present so this function's real signature is already correct when the TODO above is filled in
}

async function tick(): Promise<void> {
  try {
    const grids = await query<{
      id: string; exchange: string; symbol: string; order_ids: string[];
      upper_price: string; lower_price: string; grid_count: number; total_investment: string;
    }>(`SELECT id, exchange, symbol, order_ids, upper_price, lower_price, grid_count, total_investment
        FROM nexus_bot_grids WHERE status = 'active'`);

    for (const grid of grids) {
      await maintainOneGrid(grid);
    }
  } catch (err) {
    console.error('[nexusBotWorker] tick failed', (err as Error).message);
  }
}

export function startNexusBotWorker(): void {
  if (timer) return; // idempotent — a hot-reload shouldn't stack intervals
  console.log(`[nexusBotWorker] starting, poll every ${POLL_MS}ms, dry-run=${isServerDryRun()}`);
  timer = setInterval(() => { void tick(); }, POLL_MS);
}

export function stopNexusBotWorker(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
