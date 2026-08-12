/* ══ NEXUS BOT — background worker ═══════════════════════════════════════════
 *  routes/nexusBot.ts's POST /grids and /volume-maker/start put the INITIAL
 *  state in place; the actual ongoing behavior — noticing a grid level
 *  filled and re-placing it, ticking the volume maker — can't happen inside
 *  a single request/response, so it lives here as a polling loop instead.
 *
 *  Respects the same server-side dry-run flag as everything else: when
 *  dry-run is on, this tick loop still runs (so status/logging behavior is
 *  observable) but skips every real exchange call — see the dryRun checks
 *  in each branch below.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { query } from '../db';
import { isServerDryRun, recordTrade } from './nexusBotGates';
import { checkAndMaintainGrid, executeVolumeMakerTick } from './ccxtExecutor';
import { matchFillsFifo, type Fill } from './gridPnl';

const POLL_MS = Number(process.env.NEXUS_GRID_POLL_MS || 30_000);
let timer: ReturnType<typeof setInterval> | null = null;

// ── Grid maintenance ──────────────────────────────────────────────────────────

async function maintainOneGrid(grid: {
  id: string; exchange: string; symbol: string; order_ids: string[];
  upper_price: string; lower_price: string; grid_count: number; total_investment: string;
  filled_count: number; open_buys: Fill[];
}): Promise<void> {
  const result = await checkAndMaintainGrid({
    exchange: grid.exchange, symbol: grid.symbol, orderIds: grid.order_ids,
    upperPrice: Number(grid.upper_price), lowerPrice: Number(grid.lower_price),
    gridCount: grid.grid_count, totalInvestment: Number(grid.total_investment),
  });

  if (result.errors.length) {
    console.error(`[nexusBotWorker] grid ${grid.id} maintenance errors:`, result.errors.join('; '));
  }
  if (result.filledOrderIds.length === 0) return; // nothing changed this tick

  const stillOpen = grid.order_ids.filter((id) => !result.filledOrderIds.includes(id));
  const newIds = result.newOrders.map((o) => o.newId);
  const updatedOrderIds = [...stillOpen, ...newIds];
  const newFilledCount = grid.filled_count + result.filledOrderIds.length;

  // FIFO-match this tick's fills against carried-over open buy inventory —
  // see gridPnl.ts. `remainingBuys` becomes the new open_buys for next tick.
  const { realizedPnlUsd, remainingBuys } = matchFillsFifo(grid.open_buys ?? [], result.fills);

  try {
    await query(
      `UPDATE nexus_bot_grids
       SET order_ids = $1, filled_count = $2, realized_pnl_usd = realized_pnl_usd + $3, open_buys = $4
       WHERE id = $5`,
      [JSON.stringify(updatedOrderIds), newFilledCount, realizedPnlUsd, JSON.stringify(remainingBuys), grid.id],
    );
  } catch (err) {
    console.error(`[nexusBotWorker] failed to persist grid ${grid.id} maintenance update`, (err as Error).message);
  }

  for (const filledId of result.filledOrderIds) {
    const replacement = result.newOrders.find((o) => o.oldId === filledId);
    await recordTrade({
      kind: 'grid_open', pair: grid.symbol, exchange: grid.exchange, dryRun: false, status: 'closed',
      meta: { gridId: grid.id, event: 'level_filled', filledOrderId: filledId, replacement },
    });
  }
  if (realizedPnlUsd !== 0) {
    // One aggregate record for this tick's realized PNL — attaching it to
    // each individual fill above would double-count across multiple fills
    // in the same tick, since realizedPnlUsd is the FIFO matcher's tick total.
    await recordTrade({
      kind: 'grid_close', pair: grid.symbol, exchange: grid.exchange, dryRun: false, status: 'closed',
      pnlUsd: realizedPnlUsd, meta: { gridId: grid.id, event: 'pnl_realized', fillsThisTick: result.fills.length },
    });
  }
}

async function gridTick(): Promise<void> {
  if (isServerDryRun()) return; // nothing real to poll — dry-run grids never got real order ids

  try {
    const grids = await query<{
      id: string; exchange: string; symbol: string; order_ids: string[];
      upper_price: string; lower_price: string; grid_count: number; total_investment: string;
      filled_count: number; open_buys: Fill[];
    }>(`SELECT id, exchange, symbol, order_ids, upper_price, lower_price, grid_count, total_investment, filled_count, open_buys
        FROM nexus_bot_grids WHERE status = 'active'`);

    for (const grid of grids) {
      await maintainOneGrid(grid);
    }
  } catch (err) {
    console.error('[nexusBotWorker] grid tick failed', (err as Error).message);
  }
}

// ── Volume maker ──────────────────────────────────────────────────────────────

async function volumeMakerTick(): Promise<void> {
  try {
    const [row] = await query<{ active: boolean; exchange: string | null; symbol: string | null }>(
      `SELECT active, exchange, symbol FROM nexus_bot_volume_maker WHERE id = 1`,
    );
    if (!row?.active) return;
    if (!row.exchange || !row.symbol) {
      console.error('[nexusBotWorker] volume maker is active but has no exchange/symbol configured — skipping tick');
      return;
    }

    if (isServerDryRun()) {
      // Still advance the counters so the UI shows *something* moving in
      // dry-run, clearly framed as simulated — never silent, never fake-real.
      await query(
        `UPDATE nexus_bot_volume_maker SET trades = trades + 1, updated_at = now() WHERE id = 1`,
      );
      return;
    }

    const result = await executeVolumeMakerTick(row.exchange, row.symbol);
    if (!result.ok) {
      console.error(`[nexusBotWorker] volume maker tick failed on ${row.exchange}/${row.symbol}: ${result.error}`);
      return;
    }

    await query(
      `UPDATE nexus_bot_volume_maker
       SET total_volume_usd = total_volume_usd + $1, fees_usd = fees_usd + $2, trades = trades + 1, updated_at = now()
       WHERE id = 1`,
      [result.volumeUsd, result.feeUsd],
    );
    await recordTrade({
      kind: 'volume_maker', pair: row.symbol, exchange: row.exchange, dryRun: false, status: 'closed',
      amountUsd: result.volumeUsd, meta: { event: 'tick', feeUsd: result.feeUsd },
    });
  } catch (err) {
    console.error('[nexusBotWorker] volume maker tick failed', (err as Error).message);
  }
}

// ── Driver ──────────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  await gridTick();
  await volumeMakerTick();
}

export function startNexusBotWorker(): void {
  if (timer) return; // idempotent — a hot-reload shouldn't stack intervals
  console.log(`[nexusBotWorker] starting, poll every ${POLL_MS}ms, dry-run=${isServerDryRun()}`);
  timer = setInterval(() => { void tick(); }, POLL_MS);
}

export function stopNexusBotWorker(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
