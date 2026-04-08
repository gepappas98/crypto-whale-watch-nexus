/* ══ WHALE RADAR — /api/tracked routes ════════════════════════════════════════ */
import { Router, Request, Response } from 'express';
import { query } from '../db';

export const trackedRouter = Router();

// GET /api/tracked
trackedRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await query(`SELECT * FROM tracked_tokens ORDER BY created_at DESC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

// POST /api/tracked
trackedRouter.post('/', async (req: Request, res: Response) => {
  const { symbol, coin_id, base_price } = req.body as Record<string, unknown>;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  try {
    const [row] = await query(
      `INSERT INTO tracked_tokens (symbol, coin_id, base_price, last_price)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (symbol) DO UPDATE
         SET last_price = $3, coin_id = COALESCE($2, tracked_tokens.coin_id)
       RETURNING *`,
      [String(symbol).toUpperCase(), coin_id ?? null, base_price ?? null]
    );
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

// DELETE /api/tracked/:symbol
trackedRouter.delete('/:symbol', async (req: Request, res: Response) => {
  try {
    await query(`DELETE FROM tracked_tokens WHERE symbol = $1`, [req.params.symbol.toUpperCase()]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});
