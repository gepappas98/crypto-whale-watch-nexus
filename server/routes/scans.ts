/* ══ WHALE RADAR — /api/scans routes ══════════════════════════════════════════ */
import { Router, Request, Response } from 'express';
import { query } from '../db';

export const scansRouter = Router();

// POST /api/scans — persist a full scan session
scansRouter.post('/', async (req: Request, res: Response) => {
  const { coins } = req.body as { coins: Record<string, unknown>[] };
  if (!Array.isArray(coins) || coins.length === 0) {
    return res.status(400).json({ error: 'coins array required' });
  }

  try {
    const critCount = coins.filter(c => c.threat === 'CRITICAL').length;
    const highCount = coins.filter(c => c.threat === 'HIGH').length;

    // Insert session header
    const [session] = await query<{ id: number }>(
      `INSERT INTO scan_sessions (coin_count, crit_count, high_count)
       VALUES ($1, $2, $3) RETURNING id`,
      [coins.length, critCount, highCount]
    );

    // Bulk-insert coins
    const values: unknown[] = [];
    const placeholders = coins.map((c, i) => {
      const base = i * 17; // 17 values pushed per coin — was wrongly 13, causing corrupt $N offsets for i > 0
      values.push(
        session.id, c.symbol, c.name, c.rank,
        c.price, c.change, c.volume, c.mcap,
        c.vmcap, c.volSpike, c.score, c.threat,
        c.category, c.confidence,
        JSON.stringify(c.reasons ?? []),
        c.isSol ?? false,
        c.birdData ? JSON.stringify(c.birdData) : null
      );
      return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11},$${base+12},$${base+13},$${base+14},$${base+15},$${base+16},$${base+17})`;
    });

    await query(
      `INSERT INTO scan_coins
         (session_id,symbol,name,rank,price,change_24h,volume,mcap,vmcap,vol_spike,score,threat,category,confidence,reasons,is_sol,bird_data)
       VALUES ${placeholders.join(',')}`,
      values
    );

    res.json({ session_id: session.id, saved: coins.length });
  } catch (err) {
    console.error('[scans POST]', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// GET /api/scans — list recent sessions
scansRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await query(
      `SELECT id, scanned_at, coin_count, crit_count, high_count
       FROM scan_sessions ORDER BY scanned_at DESC LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    console.error('[scans GET]', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// GET /api/scans/symbol/:sym — history for a specific token
// MUST be before /:id or Express matches "symbol" as an id
scansRouter.get('/symbol/:sym', async (req: Request, res: Response) => {
  try {
    const rows = await query(
      `SELECT sc.score, sc.threat, sc.category, sc.vmcap, sc.price, sc.change_24h, ss.scanned_at
       FROM scan_coins sc
       JOIN scan_sessions ss ON ss.id = sc.session_id
       WHERE sc.symbol = $1
       ORDER BY ss.scanned_at DESC LIMIT 90`,
      [req.params.sym.toUpperCase()]
    );
    res.json(rows);
  } catch (err) {
    console.error('[scans/symbol GET]', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// GET /api/scans/threats/top — top threats across all history
// MUST be before /:id or Express matches "threats" as an id
scansRouter.get('/threats/top', async (_req: Request, res: Response) => {
  try {
    const rows = await query(
      `SELECT symbol, MAX(score) AS peak_score, COUNT(DISTINCT session_id) AS appearances,
              (ARRAY['LOW','MEDIUM','HIGH','CRITICAL'])[MAX(
                CASE threat
                  WHEN 'LOW'      THEN 1
                  WHEN 'MEDIUM'   THEN 2
                  WHEN 'HIGH'     THEN 3
                  WHEN 'CRITICAL' THEN 4
                  ELSE 0
                END
              )] AS worst_threat,
              MAX(scanned_at) AS last_seen
       FROM scan_coins WHERE score >= 45
       GROUP BY symbol ORDER BY peak_score DESC LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    console.error('[scans/threats/top]', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// GET /api/scans/:id — full coin list for a session
// Kept LAST — would shadow /symbol/:sym and /threats/top if placed earlier
scansRouter.get('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id <= 0) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }
  try {
    const rows = await query(
      `SELECT * FROM scan_coins WHERE session_id = $1 ORDER BY score DESC`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[scans/:id GET]', err);
    res.status(500).json({ error: 'DB error' });
  }
});
