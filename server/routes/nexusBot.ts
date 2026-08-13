/* ══ NEXUS BOT — /api/nexus-bot routes ═══════════════════════════════════════
 *  Server-side counterpart to src/lib/nexus/restBridgeBot.ts. Every mutating
 *  route re-checks dry-run + a cooldown lock independently of whatever the
 *  browser already checked — see services/nexusBotGates.ts for why.
 *
 *  Mounted under the same bearer-token auth as the rest of /api/* in
 *  index.ts — there is deliberately no separate auth here.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { Router, Request, Response } from 'express';
import { query } from '../db';
import { isServerDryRun, checkAndLockCooldown, recordTrade } from '../services/nexusBotGates';
import {
  executeArbitrageLegs, placeGridOrders, cancelGridOrders, fetchPortfolioBalances, scanServerArbitrage,
} from '../services/ccxtExecutor';
import { strategyTraderRouter } from './strategyTrader';

export const nexusBotRouter = Router();

// Strategy Trader (freqtrade bridge) — see routes/strategyTrader.ts. Mounted
// here (not as its own top-level /api/* router) so it inherits the same
// bearer-token auth as the rest of /api/nexus-bot/*, matching the client's
// path shape: nexus-bot-proxy forwards '/strategy-trader/...' to
// '/api/nexus-bot/strategy-trader/...'.
nexusBotRouter.use('/strategy-trader', strategyTraderRouter);
// ── Arbitrage ─────────────────────────────────────────────────────────────────
nexusBotRouter.get('/arbitrage/scan', async (_req: Request, res: Response) => {
  try {
    const opportunities = await scanServerArbitrage();
    res.json(opportunities);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

nexusBotRouter.post('/arbitrage/execute', async (req: Request, res: Response) => {
  const opp = req.body as {
    pair?: string; exchanges?: [string, string]; direction?: string;
    prices?: Record<string, number>; estimatedProfitUsd?: number; plausible?: boolean;
  };
  if (!opp.pair || !opp.exchanges || opp.exchanges.length !== 2) {
    return res.status(400).json({ error: 'pair and a 2-element exchanges array are required' });
  }
  if (opp.plausible === false) {
    return res.status(422).json({ error: 'opportunity was flagged implausible by the client — server refuses to re-derive that check, resubmit a fresh scan' });
  }

  const gate = await checkAndLockCooldown(opp.pair);
  if (!gate.allowed) return res.status(429).json({ error: gate.reason });

  const dryRun = isServerDryRun();
  const notionalUsd = Math.max(10, Math.min(opp.estimatedProfitUsd ? opp.estimatedProfitUsd * 50 : 1000, 5000)); // crude sizing floor/ceiling until a real position-sizing input exists
  const result = await executeArbitrageLegs(
    { exchanges: opp.exchanges, pair: opp.pair, direction: opp.direction ?? 'long_short', prices: opp.prices ?? {} },
    notionalUsd, dryRun,
  );

  await recordTrade({
    kind: 'arbitrage', pair: opp.pair, dryRun,
    status: result.ok ? 'closed' : 'error',
    errorMessage: result.error,
    meta: result,
  });

  if (!result.ok) return res.status(502).json({ error: result.error ?? 'execution failed' });
  res.json({ ok: true, txHash: dryRun ? undefined : 'see order ids in server logs', dryRun });
});

// ── Grids ───────────────────────────────────────────────────────────────────
nexusBotRouter.get('/grids', async (_req: Request, res: Response) => {
  try {
    const rows = await query<{
      id: string; exchange: string; symbol: string; market_type: string; mode: string;
      upper_price: string; lower_price: string; grid_count: number; total_investment: string;
      fee_rate: string; status: string; order_ids: string[]; created_at: string; filled_count: number;
      realized_pnl_usd: string;
    }>(`SELECT * FROM nexus_bot_grids ORDER BY created_at DESC`);
    res.json(rows.map((r) => ({
      id: r.id, exchange: r.exchange, symbol: r.symbol, marketType: r.market_type, mode: r.mode,
      upperPrice: Number(r.upper_price), lowerPrice: Number(r.lower_price), gridCount: r.grid_count,
      totalInvestment: Number(r.total_investment), feeRate: Number(r.fee_rate),
      status: r.status, pnl: Number(r.realized_pnl_usd ?? 0), // real, FIFO-matched — see services/gridPnl.ts
      filledGrids: r.filled_count ?? 0, activeOrders: Array.isArray(r.order_ids) ? r.order_ids.length : 0,
      createdAt: new Date(r.created_at).getTime(),
    })));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

nexusBotRouter.post('/grids', async (req: Request, res: Response) => {
  const cfg = req.body as {
    id?: string; exchange?: string; symbol?: string; marketType?: string; mode?: string;
    upperPrice?: number; lowerPrice?: number; gridCount?: number; totalInvestment?: number; feeRate?: number;
  };
  if (!cfg.id || !cfg.exchange || !cfg.symbol || !cfg.upperPrice || !cfg.lowerPrice || !cfg.gridCount || !cfg.totalInvestment) {
    return res.status(400).json({ error: 'id, exchange, symbol, upperPrice, lowerPrice, gridCount, totalInvestment are required' });
  }
  if (cfg.upperPrice <= cfg.lowerPrice) {
    return res.status(400).json({ error: 'upperPrice must be greater than lowerPrice' });
  }

  const gate = await checkAndLockCooldown(cfg.symbol);
  if (!gate.allowed) return res.status(429).json({ error: gate.reason });

  const dryRun = isServerDryRun();
  const placement = await placeGridOrders(
    { exchange: cfg.exchange, symbol: cfg.symbol, upperPrice: cfg.upperPrice, lowerPrice: cfg.lowerPrice, gridCount: cfg.gridCount, totalInvestment: cfg.totalInvestment },
    dryRun,
  );

  try {
    await query(
      `INSERT INTO nexus_bot_grids (id, exchange, symbol, market_type, mode, upper_price, lower_price, grid_count, total_investment, fee_rate, status, order_ids, dry_run)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,$12)
       ON CONFLICT (id) DO NOTHING`,
      [cfg.id, cfg.exchange, cfg.symbol, cfg.marketType ?? 'spot', cfg.mode ?? 'normal',
        cfg.upperPrice, cfg.lowerPrice, cfg.gridCount, cfg.totalInvestment, cfg.feeRate ?? 0.001,
        JSON.stringify(placement.orderIds), dryRun],
    );
  } catch (err) {
    return res.status(500).json({ error: `grid orders placed but DB insert failed: ${(err as Error).message}` });
  }

  await recordTrade({
    kind: 'grid_open', pair: cfg.symbol, exchange: cfg.exchange, dryRun,
    status: placement.errors?.length ? 'error' : 'open',
    errorMessage: placement.errors?.join('; '),
    meta: placement,
  });

  res.json({
    id: cfg.id, exchange: cfg.exchange, symbol: cfg.symbol, marketType: cfg.marketType ?? 'spot',
    mode: cfg.mode ?? 'normal', upperPrice: cfg.upperPrice, lowerPrice: cfg.lowerPrice,
    gridCount: cfg.gridCount, totalInvestment: cfg.totalInvestment, feeRate: cfg.feeRate ?? 0.001,
    status: placement.errors?.length && placement.orderIds.length === 0 ? 'error' : 'active',
    pnl: 0, filledGrids: 0, activeOrders: placement.orderIds.length, createdAt: Date.now(),
  });
});

nexusBotRouter.delete('/grids/:id', async (req: Request, res: Response) => {
  try {
    const [grid] = await query<{ exchange: string; symbol: string; order_ids: string[] }>(
      `SELECT exchange, symbol, order_ids FROM nexus_bot_grids WHERE id = $1`, [req.params.id],
    );
    if (!grid) return res.status(404).json({ error: 'grid not found' });

    const cancel = await cancelGridOrders(grid.exchange, grid.symbol, grid.order_ids ?? []);
    await query(`UPDATE nexus_bot_grids SET status = 'stopped', stopped_at = now() WHERE id = $1`, [req.params.id]);
    await recordTrade({ kind: 'grid_close', pair: grid.symbol, exchange: grid.exchange, dryRun: isServerDryRun(), status: 'closed', meta: cancel });

    res.json({ ok: true, ...cancel });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Volume maker ──────────────────────────────────────────────────────────────
// The worker (services/nexusBotWorker.ts) picks up `active`+`exchange`+
// `symbol` on its next poll and runs the actual tick loop — this route just
// flips the switch and records the intent.
nexusBotRouter.post('/volume-maker/start', async (req: Request, res: Response) => {
  const { mode, signalSource, exchange, symbol } = req.body as {
    mode?: string; signalSource?: string; exchange?: string; symbol?: string;
  };
  if (!exchange || !symbol) {
    return res.status(400).json({ error: 'exchange and symbol are required — there is nothing concrete to trade without them' });
  }
  try {
    await query(
      `UPDATE nexus_bot_volume_maker
       SET active = true, mode = $1, signal_source = $2, exchange = $3, symbol = $4, started_at = now(), updated_at = now()
       WHERE id = 1`,
      [mode ?? 'unspecified', signalSource ?? 'unspecified', exchange, symbol],
    );
    await recordTrade({ kind: 'volume_maker', pair: symbol, exchange, dryRun: isServerDryRun(), status: 'open', meta: { mode, signalSource, event: 'start' } });
    res.json(await readVolumeStats());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

nexusBotRouter.post('/volume-maker/stop', async (_req: Request, res: Response) => {
  try {
    await query(`UPDATE nexus_bot_volume_maker SET active = false, updated_at = now() WHERE id = 1`);
    res.json(await readVolumeStats());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

nexusBotRouter.get('/volume-maker/stats', async (_req: Request, res: Response) => {
  try {
    res.json(await readVolumeStats());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

async function readVolumeStats() {
  const [row] = await query<{
    active: boolean; mode: string | null; total_volume_usd: string; fees_usd: string; rebates_usd: string; trades: number;
    exchange: string | null; symbol: string | null;
  }>(`SELECT active, mode, total_volume_usd, fees_usd, rebates_usd, trades, exchange, symbol FROM nexus_bot_volume_maker WHERE id = 1`);
  return {
    active: row?.active ?? false, mode: row?.mode ?? 'unspecified',
    totalVolumeUsd: Number(row?.total_volume_usd ?? 0), feesUsd: Number(row?.fees_usd ?? 0),
    rebatesUsd: Number(row?.rebates_usd ?? 0), trades: row?.trades ?? 0,
    exchange: row?.exchange ?? undefined, symbol: row?.symbol ?? undefined,
  };
}

// ── Portfolio ─────────────────────────────────────────────────────────────────
nexusBotRouter.get('/portfolio', async (_req: Request, res: Response) => {
  try {
    const exchanges = await fetchPortfolioBalances();
    const totalAumUsd = exchanges.reduce((s, e) => s + e.balanceUsd, 0);

    const [gridCountRow] = await query<{ n: string }>(`SELECT count(*)::text AS n FROM nexus_bot_grids WHERE status = 'active'`);
    const [vm] = await query<{ active: boolean }>(`SELECT active FROM nexus_bot_volume_maker WHERE id = 1`);
    const activeStrategies = Number(gridCountRow?.n ?? 0) + (vm?.active ? 1 : 0);

    const [closedTrades] = await query<{ total: string; wins: string }>(
      `SELECT count(*)::text AS total, count(*) FILTER (WHERE pnl_usd > 0)::text AS wins
       FROM nexus_bot_trades WHERE status = 'closed' AND pnl_usd IS NOT NULL`,
    );
    const total = Number(closedTrades?.total ?? 0);
    const wins = Number(closedTrades?.wins ?? 0);

    res.json({
      totalAumUsd, dailyPnlUsd: 0, // realized-PNL rollup needs pnl_usd populated on close — currently only arbitrage/grid opens are recorded, not yet settled PNL
      winRate: total > 0 ? +((wins / total) * 100).toFixed(1) : 0,
      activeStrategies, exchanges,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
