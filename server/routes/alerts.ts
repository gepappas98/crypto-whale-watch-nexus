/* ══ WHALE RADAR — /api/alerts routes ════════════════════════════════════════ */
import { Router, Request, Response } from 'express';
import { query } from '../db';

export const alertsRouter = Router();

// GET /api/alerts — recent persistent alerts
alertsRouter.get('/', async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  try {
    const rows = await query(
      `SELECT * FROM alerts ORDER BY pinned DESC, created_at DESC LIMIT $1`,
      [limit]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

// POST /api/alerts — save a critical/high alert
alertsRouter.post('/', async (req: Request, res: Response) => {
  const { level, tag, text, sizing, pinned } = req.body as Record<string, unknown>;
  if (!level || !text) return res.status(400).json({ error: 'level and text required' });
  // Only persist critical/high/medium — info is ephemeral
  if (level === 'info') return res.json({ skipped: true });
  try {
    const [row] = await query(
      `INSERT INTO alerts (level, tag, text, sizing, pinned)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [level, tag ?? null, text, sizing ?? null, pinned ?? false]
    );
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

// PATCH /api/alerts/:id/pin
alertsRouter.patch('/:id/pin', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'id must be a positive integer' });
  try {
    const [row] = await query(
      `UPDATE alerts SET pinned = NOT pinned WHERE id = $1 RETURNING *`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'Alert not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

// DELETE /api/alerts/:id
alertsRouter.delete('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'id must be a positive integer' });
  try {
    await query(`DELETE FROM alerts WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});
