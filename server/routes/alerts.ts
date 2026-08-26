/* ══ WHALE RADAR — /api/alerts routes ════════════════════════════════════════
 *  Also home to the decision-outcome loop (v9.37) — closes the last
 *  Strategic Direction P1 item. Distinct from signal_outcomes
 *  (signalOutcomes.ts): that table auto-tracks forward price for every CEO
 *  Signal fire regardless of what the user did about it. This tracks what
 *  the USER actually did about a specific alert (reviewed it vs. acted on
 *  it), so the eventual ML layer can learn which alert types were actually
 *  useful to THIS user — not just which signals move price in general.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { Router, Request, Response } from 'express';
import { query } from '../db';

export const alertsRouter = Router();

// ── helper: unwrap pg QueryResult OR raw array (mirrors signalOutcomes.ts) ──
function unwrap<T = unknown>(result: unknown): T[] {
  if (!result) return [];
  if (Array.isArray(result)) return result as T[];
  const r = result as { rows?: T[] };
  if (Array.isArray(r.rows)) return r.rows;
  return [];
}

// GET /api/alerts — recent persistent alerts, with any logged decision joined in
alertsRouter.get('/', async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  try {
    const rows = await query(
      `SELECT a.*, ao.action, ao.outcome_24h_pct
       FROM alerts a
       LEFT JOIN alert_outcomes ao ON ao.alert_id = a.id
       ORDER BY a.pinned DESC, a.created_at DESC LIMIT $1`,
      [limit]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

// POST /api/alerts — save a critical/high alert
// coin_id/entry_price are optional — only alerts that originate from a
// specific coin (the scanner's CRITICAL/HIGH fires) have them; a
// REGIME-tagged or API-error alert just omits them, same as
// signal_outcomes leaves coin_id NULL when there's no natural coin.
alertsRouter.post('/', async (req: Request, res: Response) => {
  const { level, tag, text, sizing, pinned, coin_id, entry_price } = req.body as Record<string, unknown>;
  if (!level || !text) return res.status(400).json({ error: 'level and text required' });
  // Only persist critical/high/medium — info is ephemeral
  if (level === 'info') return res.json({ skipped: true });
  try {
    const [row] = await query(
      `INSERT INTO alerts (level, tag, text, sizing, pinned, coin_id, entry_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [level, tag ?? null, text, sizing ?? null, pinned ?? false, coin_id ?? null, entry_price ?? null]
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

// POST /api/alerts/:id/outcome — log the user's decision on an alert.
// One decision per alert: calling this again for the same alert replaces
// the previous decision (ON CONFLICT DO UPDATE) rather than accumulating a
// history of the user changing their mind. Only 'bought' carries a price
// snapshot forward to the price filler below — a 'reviewed' decision has
// no position to track.
alertsRouter.post('/:id/outcome', async (req: Request, res: Response) => {
  const alertId = parseInt(req.params.id, 10);
  if (isNaN(alertId) || alertId <= 0) return res.status(400).json({ error: 'id must be a positive integer' });
  const { action, coin_id, entry_price } = req.body as Record<string, unknown>;
  if (action !== 'reviewed' && action !== 'bought') {
    return res.status(400).json({ error: "action must be 'reviewed' or 'bought'" });
  }
  try {
    const [row] = await query(
      `INSERT INTO alert_outcomes (alert_id, action, coin_id, entry_price)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (alert_id) DO UPDATE
         SET action = EXCLUDED.action,
             coin_id = EXCLUDED.coin_id,
             entry_price = EXCLUDED.entry_price,
             created_at = NOW(),
             price_24h = NULL, outcome_24h_pct = NULL, filled_24h_at = NULL
       RETURNING *`,
      [
        alertId,
        action,
        action === 'bought' ? (coin_id ?? null) : null,
        action === 'bought' ? (entry_price ?? null) : null,
      ]
    );
    res.json(row);
  } catch (err) {
    console.error('[alerts/:id/outcome]', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// GET /api/alerts/outcomes/eval — per-tag win rate on the user's own
// "bought" decisions (last 30 days). Scoped to action='bought' only —
// including 'reviewed' rows would silently understate performance since
// they have no outcome to average in.
alertsRouter.get('/outcomes/eval', async (_req: Request, res: Response) => {
  try {
    const raw = await query(
      `SELECT
         a.tag,
         COUNT(*) FILTER (WHERE ao.action = 'reviewed')                              AS reviewed_count,
         COUNT(*) FILTER (WHERE ao.action = 'bought')                                AS bought_count,
         COUNT(*) FILTER (WHERE ao.action = 'bought' AND ao.outcome_24h_pct IS NOT NULL)
                                                                                       AS bought_with_outcome,
         ROUND(AVG(ao.outcome_24h_pct) FILTER (WHERE ao.action = 'bought')::NUMERIC, 2)
                                                                                       AS avg_bought_24h_pct,
         ROUND(
           COUNT(*) FILTER (WHERE ao.action = 'bought' AND ao.outcome_24h_pct > 0)::NUMERIC
           / NULLIF(COUNT(*) FILTER (WHERE ao.action = 'bought' AND ao.outcome_24h_pct IS NOT NULL), 0) * 100, 1
         )                                                                             AS bought_win_rate_24h
       FROM alert_outcomes ao
       JOIN alerts a ON a.id = ao.alert_id
       WHERE ao.created_at > NOW() - INTERVAL '30 days'
       GROUP BY a.tag
       ORDER BY avg_bought_24h_pct DESC NULLS LAST`
    );
    res.json(unwrap(raw));
  } catch (err) {
    console.error('[alerts/outcomes/eval]', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// ── Price fill-in for 'bought' decisions ────────────────────────────────────
// Mirrors signalOutcomes.ts's fillOutcomePrices() exactly (same CoinGecko
// simple/price batching approach) but only ever touches rows with
// action='bought' and a coin_id — 'reviewed' rows and coin-less alerts
// (e.g. REGIME-tagged) are structurally excluded by the WHERE clause, not
// silently skipped one row at a time.

export interface AlertFillResult { filled: number }

export async function fillAlertOutcomePrices(): Promise<AlertFillResult> {
  const rows = await query<{ id: number; coin_id: string; entry_price: string }>(
    `SELECT id, coin_id, entry_price
     FROM alert_outcomes
     WHERE action = 'bought'
       AND coin_id IS NOT NULL
       AND price_24h IS NULL
       AND created_at < NOW() - INTERVAL '24 hours'
       AND created_at > NOW() - INTERVAL '8 days'
     LIMIT 30`
  );
  const need = unwrap<{ id: number; coin_id: string; entry_price: string }>(rows);
  if (!need.length) return { filled: 0 };

  const coinIds = [...new Set(need.map((r) => r.coin_id))];
  let prices: Record<string, number> = {};
  try {
    const batches: string[][] = [];
    for (let i = 0; i < coinIds.length; i += 250) batches.push(coinIds.slice(i, i + 250));
    for (const batch of batches) {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${batch.join(',')}&vs_currencies=usd`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12_000);
      let res: Response;
      try {
        res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) continue;
      const json = (await res.json()) as Record<string, { usd?: number }>;
      for (const [id, v] of Object.entries(json)) {
        if (v.usd != null) prices[id] = v.usd;
      }
    }
  } catch (e) {
    console.error('[alertPriceFiller] CoinGecko fetch failed:', e);
    return { filled: 0 };
  }
  if (!Object.keys(prices).length) return { filled: 0 };

  const ids: number[] = [];
  const newPrices: number[] = [];
  const pctChanges: (number | null)[] = [];
  for (const row of need) {
    const p = prices[row.coin_id];
    if (!p) continue;
    const entry = parseFloat(row.entry_price);
    ids.push(row.id);
    newPrices.push(p);
    pctChanges.push(entry > 0 ? ((p - entry) / entry) * 100 : null);
  }
  if (!ids.length) return { filled: 0 };

  await query(
    `UPDATE alert_outcomes ao
     SET price_24h = v.price, outcome_24h_pct = v.pct, filled_24h_at = NOW()
     FROM (
       SELECT unnest($1::int[]) AS id, unnest($2::numeric[]) AS price, unnest($3::numeric[]) AS pct
     ) v
     WHERE ao.id = v.id`,
    [ids, newPrices, pctChanges]
  );

  console.log(`[alertPriceFiller] Filled ${ids.length} alert-decision outcome prices`);
  return { filled: ids.length };
}
