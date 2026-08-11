/* ══ WHALE RADAR — /api/whales (public, GPT-Actions friendly) ══════════════════
 *  Stable, agent-facing shape for OpenAI Custom GPT Actions / LLM agents.
 *  Read-only, no auth, CORS open. Mirrors /api/whale-events with renamed fields.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { Router, Request, Response } from 'express';
import { query } from '../db';

export const whalesRouter = Router();

// Always allow any origin — ChatGPT's backend issues cross-origin GETs.
whalesRouter.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  next();
});

// GET /api/whales?limit=10&min_usd=100000&asset=BTC
whalesRouter.get('/', async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 500);
  const minUsd = Math.max(Number(req.query.min_usd) || 100000, 0);
  const assetRaw = (req.query.asset as string | undefined)?.trim().toUpperCase();

  try {
    const params: unknown[] = [minUsd];
    let where = 'WHERE usdt >= $1';
    if (assetRaw) {
      params.push(`${assetRaw}%`);
      where += ` AND symbol LIKE $${params.length}`;
    }
    params.push(limit);

    const rows = (await query(
      `SELECT id, symbol, side, price, qty, usdt, exchange, created_at
       FROM whale_events ${where}
       ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    )) as Array<Record<string, unknown>>;

    res.json({
      data: rows.map((r) => ({
        tx_hash: `${r.exchange ?? 'cex'}-${r.id}`,
        asset: String(r.symbol ?? ''),
        amount_usd: Number(r.usdt ?? 0),
        transaction_type: String(r.side ?? '').toUpperCase() === 'BUY' ? 'buy' : 'sell',
        timestamp: r.created_at instanceof Date
          ? r.created_at.toISOString()
          : String(r.created_at ?? ''),
      })),
    });
  } catch (err) {
    console.error('[whales GET]', err);
    res.status(500).json({ error: 'Data temporarily unavailable', data: [] });
  }
});

// GET /api/whales/summary — 24h aggregated flow per asset
whalesRouter.get('/summary', async (_req: Request, res: Response) => {
  try {
    const rows = (await query(
      `SELECT symbol,
              COUNT(*)                                        AS trades,
              SUM(usdt)                                       AS total_usd,
              SUM(CASE WHEN side='BUY'  THEN usdt ELSE 0 END) AS buy_usd,
              SUM(CASE WHEN side='SELL' THEN usdt ELSE 0 END) AS sell_usd,
              MAX(usdt)                                       AS max_trade_usd,
              MAX(created_at)                                 AS last_seen
       FROM whale_events
       WHERE created_at > NOW() - INTERVAL '24 hours'
       GROUP BY symbol
       ORDER BY total_usd DESC
       LIMIT 50`
    )) as Array<Record<string, unknown>>;

    res.json({
      data: rows.map((r) => ({
        asset: String(r.symbol ?? ''),
        trades: Number(r.trades ?? 0),
        total_usd: Number(r.total_usd ?? 0),
        buy_usd: Number(r.buy_usd ?? 0),
        sell_usd: Number(r.sell_usd ?? 0),
        max_trade_usd: Number(r.max_trade_usd ?? 0),
        last_seen: r.last_seen instanceof Date
          ? r.last_seen.toISOString()
          : String(r.last_seen ?? ''),
      })),
    });
  } catch (err) {
    console.error('[whales/summary]', err);
    res.status(500).json({ error: 'Data temporarily unavailable', data: [] });
  }
});
