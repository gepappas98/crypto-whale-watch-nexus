/* ══ WHALE RADAR — /api/portfolio routes ══════════════════════════════════════ */
import { Router, Request, Response } from 'express';
import { query } from '../db';

export const portfolioRouter = Router();

// GET /api/portfolio
portfolioRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await query(
      `SELECT p.*, sc.price AS current_price,
         ROUND(((sc.price - p.entry_price) / NULLIF(p.entry_price, 0) * 100)::NUMERIC, 2) AS pnl_pct,
         ROUND((p.amount * (sc.price - p.entry_price))::NUMERIC, 2) AS pnl_usd
       FROM portfolio p
       LEFT JOIN LATERAL (
         SELECT price FROM scan_coins WHERE symbol = p.symbol
         ORDER BY scanned_at DESC LIMIT 1
       ) sc ON TRUE
       ORDER BY p.symbol`
    );
    res.json(rows);
  } catch (err) {
    console.error('[portfolio GET]', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// POST /api/portfolio — upsert a position
portfolioRouter.post('/', async (req: Request, res: Response) => {
  const { symbol, amount, entry_price } = req.body as Record<string, unknown>;
  if (!symbol || amount == null || entry_price == null) {
    return res.status(400).json({ error: 'symbol, amount, entry_price required' });
  }
  if (Number(entry_price) <= 0) {
    return res.status(400).json({ error: 'entry_price must be greater than 0' });
  }
  try {
    const [row] = await query(
      `INSERT INTO portfolio (symbol, amount, entry_price, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (symbol) DO UPDATE
         SET amount = $2, entry_price = $3, updated_at = NOW()
       RETURNING *`,
      [String(symbol).toUpperCase(), amount, entry_price]
    );
    res.json(row);
  } catch (err) {
    console.error('[portfolio POST]', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// DELETE /api/portfolio/:symbol
portfolioRouter.delete('/:symbol', async (req: Request, res: Response) => {
  try {
    await query(`DELETE FROM portfolio WHERE symbol = $1`, [req.params.symbol.toUpperCase()]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[portfolio DELETE]', err);
    res.status(500).json({ error: 'DB error' });
  }
});
