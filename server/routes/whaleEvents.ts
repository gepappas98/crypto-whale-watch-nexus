/* ══ WHALE RADAR — /api/whale-events routes ════════════════════════════════════
 *  Persists live whale trades from Binance/Bybit WebSocket.
 *  Client throttles to 1 write per symbol per 30s — so volume here is low.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { Router, Request, Response } from 'express';
import { query } from '../db';

export const whaleEventsRouter = Router();

// POST /api/whale-events — persist a single whale trade
whaleEventsRouter.post('/', async (req: Request, res: Response) => {
  const { symbol, side, price, qty, usdt, exchange } = req.body as Record<string, unknown>;
  if (!symbol || !side || !usdt) {
    return res.status(400).json({ error: 'symbol, side, usdt required' });
  }
  try {
    const [row] = await query(
      `INSERT INTO whale_events (symbol, side, price, qty, usdt, exchange)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        String(symbol).toUpperCase(),
        String(side).toUpperCase(),
        price ?? null,
        qty ?? null,
        usdt,
        exchange ?? null,
      ]
    );
    res.json({ ok: true, id: (row as { id: number }).id });
  } catch (err) {
    console.error('[whale-events POST]', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// GET /api/whale-events — recent whale trades
whaleEventsRouter.get('/', async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const sym = req.query.symbol as string | undefined;
  try {
    const rows = sym
      ? await query(
          `SELECT * FROM whale_events WHERE symbol = $1 ORDER BY created_at DESC LIMIT $2`,
          [sym.toUpperCase(), limit]
        )
      : await query(
          `SELECT * FROM whale_events ORDER BY created_at DESC LIMIT $1`,
          [limit]
        );
    res.json(rows);
  } catch (err) {
    console.error('[whale-events GET]', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// GET /api/whale-events/summary — aggregated flow by symbol (last 24h)
whaleEventsRouter.get('/summary', async (_req: Request, res: Response) => {
  try {
    const rows = await query(
      `SELECT symbol,
              COUNT(*)                                        AS trades,
              SUM(usdt)                                       AS total_usdt,
              SUM(CASE WHEN side='BUY'  THEN usdt ELSE 0 END) AS buy_usdt,
              SUM(CASE WHEN side='SELL' THEN usdt ELSE 0 END) AS sell_usdt,
              MAX(usdt)                                       AS max_trade,
              MAX(created_at)                                 AS last_seen
       FROM whale_events
       WHERE created_at > NOW() - INTERVAL '24 hours'
       GROUP BY symbol
       ORDER BY total_usdt DESC
       LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    console.error('[whale-events/summary]', err);
    res.status(500).json({ error: 'DB error' });
  }
});
