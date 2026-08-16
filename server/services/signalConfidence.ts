/* ══ SIGNAL CONFIDENCE — server-side, DB-backed ═══════════════════════════════
 *  The actual fix for the gap flagged in strategyTrader.ts's header comment
 *  and the README's Roadmap: the client's mlConfidence (src/lib/mlScoring.ts)
 *  trains on localStorage data the server can never see, so it can only ever
 *  be an informational number, not a real gate — the server has no way to
 *  verify a client-reported figure is real.
 *
 *  What the server DOES have that it can trust: signal_outcomes, its own
 *  Postgres table of past CEO Signal Engine fires with filled-in 4h price
 *  outcomes (server/routes/signalOutcomes.ts already exposes this
 *  aggregated by signal type via GET /api/signal-outcomes/eval — this is
 *  the same idea, aggregated by symbol instead, and used as a gate rather
 *  than just a report).
 *
 *  This is a coarser signal than the client's per-feature logistic
 *  regression (win rate only, no feature vector), but it's server-computed
 *  from server-stored history — nobody can lie about it via a request body.
 *  Below MIN_SAMPLES, there just isn't enough history yet to trust a
 *  percentage, so this returns null rather than a misleadingly precise
 *  number from 3 data points.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { query } from '../db';

const MIN_SAMPLES = 8;

export interface ServerConfidence {
  winRatePct: number;
  sampleSize: number;
}

/** `pair` is freqtrade format ("BTC/USDT") — the base asset is what
 *  signal_outcomes.symbol stores (whale-radar's CEO Signal Engine writes
 *  the coin ticker, uppercase, on every fire). Returns null when there
 *  isn't enough filled-outcome history for that symbol yet — callers
 *  should treat null as "no server opinion available", not as a failure. */
export async function getServerSideConfidence(pair: string): Promise<ServerConfidence | null> {
  const base = pair.split('/')[0]?.toUpperCase();
  if (!base) return null;

  try {
    const rows = await query<{ sample_size: string; win_rate: string | null }>(
      `SELECT
         COUNT(*) FILTER (WHERE outcome_4h IS NOT NULL) AS sample_size,
         ROUND(
           COUNT(*) FILTER (WHERE outcome_4h > 0)::NUMERIC
           / NULLIF(COUNT(*) FILTER (WHERE outcome_4h IS NOT NULL), 0) * 100, 1
         ) AS win_rate
       FROM signal_outcomes
       WHERE symbol = $1 AND fired_at > NOW() - INTERVAL '90 days'`,
      [base]
    );
    const row = rows[0];
    const sampleSize = Number(row?.sample_size ?? 0);
    if (!row || sampleSize < MIN_SAMPLES || row.win_rate == null) return null;
    return { winRatePct: Number(row.win_rate), sampleSize };
  } catch (err) {
    console.error('[signalConfidence] lookup failed (non-fatal, treated as no data):', (err as Error).message);
    return null;
  }
}
