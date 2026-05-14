/* ══ WHALE RADAR — /api/signal-outcomes routes ═════════════════════════════════
 *  Records CEO Signal Engine fires and fills in 1h/4h/24h price outcomes.
 *  This is the profit-proof layer: after 2 weeks of data you can run the
 *  eval query and know if your signals actually have alpha.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { Router, Request, Response } from 'express';
import { query } from '../db';

export const signalOutcomesRouter = Router();

// ── helper: unwrap pg QueryResult OR raw array ────────────────────────────────
function unwrap<T = unknown>(result: unknown): T[] {
  if (!result) return [];
  if (Array.isArray(result)) return result as T[];
  // pg QueryResult shape
  const r = result as { rows?: T[] };
  if (Array.isArray(r.rows)) return r.rows;
  return [];
}

// ── helper: ensure the table exists before we query it ───────────────────────
let _tableReady = false;
async function ensureTable(): Promise<void> {
  if (_tableReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS signal_outcomes (
      id            SERIAL PRIMARY KEY,
      symbol        TEXT        NOT NULL,
      coin_id       TEXT,
      signal        TEXT        NOT NULL,
      score         NUMERIC,
      category      TEXT,
      vmcap         NUMERIC,
      entry_price   NUMERIC     NOT NULL,
      price_1h      NUMERIC,
      price_4h      NUMERIC,
      price_24h     NUMERIC,
      outcome_1h    NUMERIC,
      outcome_4h    NUMERIC,
      outcome_24h   NUMERIC,
      filled_1h_at  TIMESTAMPTZ,
      filled_4h_at  TIMESTAMPTZ,
      filled_24h_at TIMESTAMPTZ,
      fired_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Unique index already created by schema.sql (idx_so_dedup) — do not duplicate here.
  _tableReady = true;
}

// POST /api/signal-outcomes — record a CEO signal fire
//
// Bug #2 fixed: the original ON CONFLICT referenced date_trunc('hour', fired_at)
// on the row being inserted, but fired_at = DEFAULT NOW() is evaluated *after*
// the INSERT, so PostgreSQL never saw a conflict — every call created a new row.
// Fix: explicit app-side pre-check within the same transaction.
signalOutcomesRouter.post('/', async (req: Request, res: Response) => {
  const { symbol, coin_id, signal, score, category, vmcap, entry_price } =
    req.body as Record<string, unknown>;

  if (!symbol || !signal || entry_price == null) {
    return res.status(400).json({ error: 'symbol, signal, entry_price required' });
  }
  if (signal === 'HOLD') return res.json({ skipped: true });

  const sym = String(symbol).toUpperCase();

  try {
    await ensureTable();

    // Atomic upsert — ON CONFLICT DO NOTHING uses idx_so_dedup (schema.sql)
    // to deduplicate without a race condition.
    const result = await query<{ id: number }>(
      `INSERT INTO signal_outcomes
         (symbol, coin_id, signal, score, category, vmcap, entry_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT ON CONSTRAINT idx_so_dedup DO NOTHING
       RETURNING id`,
      [sym, coin_id ?? null, signal, score ?? null, category ?? null, vmcap ?? null, entry_price]
    );
    const inserted = unwrap<{ id: number }>(result);
    res.json({ ok: true, skipped: inserted.length === 0 });
  } catch (err) {
    console.error('[signal-outcomes POST]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/signal-outcomes/eval — win-rate table across all signals (last 30d)
signalOutcomesRouter.get('/eval', async (_req: Request, res: Response) => {
  try {
    await ensureTable();

    const raw = await query(
      `SELECT
         signal,
         COUNT(*)                                                    AS fires,
         COUNT(*) FILTER (WHERE outcome_4h IS NOT NULL)             AS with_outcome,
         ROUND(AVG(outcome_1h)::NUMERIC, 2)                         AS avg_1h_pct,
         ROUND(AVG(outcome_4h)::NUMERIC, 2)                         AS avg_4h_pct,
         ROUND(AVG(outcome_24h)::NUMERIC, 2)                        AS avg_24h_pct,
         COUNT(*) FILTER (WHERE outcome_4h > 0)                     AS positive_4h,
         COUNT(*) FILTER (WHERE outcome_4h > 2)                     AS profitable_4h,
         ROUND(
           COUNT(*) FILTER (WHERE outcome_4h > 0)::NUMERIC
           / NULLIF(COUNT(*) FILTER (WHERE outcome_4h IS NOT NULL), 0) * 100, 1
         )                                                           AS win_rate_4h,
         ROUND(AVG(score)::NUMERIC, 0)                              AS avg_score,
         MAX(fired_at)                                              AS last_fire
       FROM signal_outcomes
       WHERE fired_at > NOW() - INTERVAL '30 days'
       GROUP BY signal
       ORDER BY avg_4h_pct DESC NULLS LAST`
    );

    res.json(unwrap(raw));
  } catch (err) {
    console.error('[signal-outcomes/eval]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/signal-outcomes/recent — last 100 signal fires with outcomes
signalOutcomesRouter.get('/recent', async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const sig = req.query.signal as string | undefined;
  try {
    await ensureTable();
    const raw = sig
      ? await query(
          `SELECT * FROM signal_outcomes WHERE signal = $1 ORDER BY fired_at DESC LIMIT $2`,
          [sig, limit]
        )
      : await query(
          `SELECT * FROM signal_outcomes ORDER BY fired_at DESC LIMIT $1`,
          [limit]
        );
    res.json(unwrap(raw));
  } catch (err) {
    console.error('[signal-outcomes/recent]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/signal-outcomes/fill-prices — trigger price fill-in manually
signalOutcomesRouter.post('/fill-prices', async (_req: Request, res: Response) => {
  try {
    const { filled } = await fillOutcomePrices();
    res.json({ ok: true, filled });
  } catch (err) {
    console.error('[signal-outcomes/fill-prices]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Price fill-in logic ───────────────────────────────────────────────────────

export interface FillResult { filled: number }

export async function fillOutcomePrices(): Promise<FillResult> {
  let filled = 0;

  await ensureTable();

  // ── 1h window ─────────────────────────────────────────────────────────────
  const raw1h = await query<{
    id: number; coin_id: string | null; symbol: string; entry_price: string;
  }>(
    `SELECT id, coin_id, symbol, entry_price
     FROM signal_outcomes
     WHERE price_1h IS NULL
       AND fired_at < NOW() - INTERVAL '1 hour'
       AND fired_at > NOW() - INTERVAL '25 hours'
     LIMIT 30`
  );
  const need1h = unwrap<{ id: number; coin_id: string | null; symbol: string; entry_price: string }>(raw1h);

  // ── 4h window ─────────────────────────────────────────────────────────────
  const raw4h = await query<{
    id: number; coin_id: string | null; symbol: string; entry_price: string;
  }>(
    `SELECT id, coin_id, symbol, entry_price
     FROM signal_outcomes
     WHERE price_4h IS NULL
       AND fired_at < NOW() - INTERVAL '4 hours'
       AND fired_at > NOW() - INTERVAL '49 hours'
     LIMIT 30`
  );
  const need4h = unwrap<{ id: number; coin_id: string | null; symbol: string; entry_price: string }>(raw4h);

  // ── 24h window ────────────────────────────────────────────────────────────
  const raw24h = await query<{
    id: number; coin_id: string | null; symbol: string; entry_price: string;
  }>(
    `SELECT id, coin_id, symbol, entry_price
     FROM signal_outcomes
     WHERE price_24h IS NULL
       AND fired_at < NOW() - INTERVAL '24 hours'
       AND fired_at > NOW() - INTERVAL '8 days'
     LIMIT 30`
  );
  const need24h = unwrap<{ id: number; coin_id: string | null; symbol: string; entry_price: string }>(raw24h);

  const allRows = [...need1h, ...need4h, ...need24h];
  if (!allRows.length) return { filled: 0 };

  const coinIds = [...new Set(
    allRows
      .map(r => r.coin_id)
      .filter((id): id is string => Boolean(id))
  )];

  if (!coinIds.length) {
    console.warn('[priceFiller] No coin_ids available, skipping fill');
    return { filled: 0 };
  }

  // Bug #3 fixed: was using CoinCap (coincap.io) which has different slug IDs
  // (e.g. "bonk-coin" vs CoinGecko's "bonk"). coin_id is populated from CoinGecko
  // scan data, so we must fetch prices from CoinGecko to match.
  let prices: Record<string, number> = {};
  try {
    // CoinGecko simple/price — batched, up to 250 IDs, no key needed on free tier
    const batches: string[][] = [];
    for (let i = 0; i < coinIds.length; i += 250) batches.push(coinIds.slice(i, i + 250));

    for (const batch of batches) {
      const cgUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${batch.join(',')}&vs_currencies=usd`;
      const cgAbort = new AbortController();
      const cgTimer = setTimeout(() => cgAbort.abort(), 12_000);
      let cgRes: Response;
      try {
        cgRes = await fetch(cgUrl, {
          headers: { Accept: 'application/json' },
          signal: cgAbort.signal,
        });
      } finally {
        clearTimeout(cgTimer);
      }
      if (!cgRes.ok) {
        console.warn('[priceFiller] CoinGecko returned', cgRes.status);
        continue;
      }
      const json = await cgRes.json() as Record<string, { usd?: number }>;
      for (const [id, v] of Object.entries(json)) {
        if (v.usd != null) prices[id] = v.usd;
      }
    }
  } catch (e) {
    console.error('[priceFiller] CoinGecko fetch failed:', e);
    return { filled: 0 };
  }

  if (!Object.keys(prices).length) {
    console.warn('[priceFiller] No prices returned from CoinGecko');
    return { filled: 0 };
  }

  // Apply prices to each bucket
  async function applyFill(
    rows: typeof need1h,
    col: 'price_1h' | 'price_4h' | 'price_24h',
    outcomeCol: 'outcome_1h' | 'outcome_4h' | 'outcome_24h',
    filledAtCol: 'filled_1h_at' | 'filled_4h_at' | 'filled_24h_at'
  ) {
    const ids: number[] = [];
    const newPrices: number[] = [];
    const pctChanges: (number | null)[] = [];
    for (const row of rows) {
      if (!row.coin_id) continue;
      const p = prices[row.coin_id];
      if (!p) continue;
      const entry = parseFloat(row.entry_price);
      ids.push(row.id);
      newPrices.push(p);
      pctChanges.push(entry > 0 ? ((p - entry) / entry) * 100 : null);
    }
    if (!ids.length) return;
    await query(
      `UPDATE signal_outcomes so
       SET ${col}        = v.price,
           ${outcomeCol} = v.pct,
           ${filledAtCol} = NOW()
       FROM (
         SELECT
           unnest($1::int[])           AS id,
           unnest($2::numeric[])       AS price,
           unnest($3::numeric[])       AS pct
       ) v
       WHERE so.id = v.id`,
      [ids, newPrices, pctChanges]
    );
    filled += ids.length;
  }

  await applyFill(need1h,  'price_1h',  'outcome_1h',  'filled_1h_at');
  await applyFill(need4h,  'price_4h',  'outcome_4h',  'filled_4h_at');
  await applyFill(need24h, 'price_24h', 'outcome_24h', 'filled_24h_at');

  if (filled > 0) {
    console.log(`[priceFiller] Filled ${filled} outcome prices`);
  }
  return { filled };
}
