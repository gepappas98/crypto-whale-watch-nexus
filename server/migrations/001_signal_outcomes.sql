-- ══ WHALE RADAR — Migration: signal_outcomes ══════════════════════════════════
-- Run after schema.sql: psql $DATABASE_URL -f server/migrations/001_signal_outcomes.sql

CREATE TABLE IF NOT EXISTS signal_outcomes (
  id            SERIAL PRIMARY KEY,
  symbol        TEXT        NOT NULL,
  coin_id       TEXT,                    -- CoinGecko id for price fill-in
  signal        TEXT        NOT NULL,    -- CEO Signal label
  score         INT,
  category      TEXT,
  vmcap         NUMERIC,
  entry_price   NUMERIC     NOT NULL,
  -- Prices filled in by background job
  price_1h      NUMERIC,
  price_4h      NUMERIC,
  price_24h     NUMERIC,
  -- % change from entry_price (filled when price is filled)
  outcome_1h    NUMERIC,
  outcome_4h    NUMERIC,
  outcome_24h   NUMERIC,
  fired_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  filled_1h_at  TIMESTAMPTZ,
  filled_4h_at  TIMESTAMPTZ,
  filled_24h_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_so_symbol   ON signal_outcomes(symbol);
CREATE INDEX IF NOT EXISTS idx_so_signal   ON signal_outcomes(signal);
CREATE INDEX IF NOT EXISTS idx_so_fired_at ON signal_outcomes(fired_at DESC);
CREATE INDEX IF NOT EXISTS idx_so_unfilled ON signal_outcomes(fired_at)
  WHERE price_1h IS NULL OR price_4h IS NULL OR price_24h IS NULL;

-- Prevent duplicate signals: same symbol+signal within the same hour
-- ON CONFLICT DO NOTHING on the client side uses this
CREATE UNIQUE INDEX IF NOT EXISTS idx_so_dedup
  ON signal_outcomes(symbol, signal, date_trunc('hour', fired_at));

-- ── Eval view ────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_signal_eval AS
SELECT
  signal,
  COUNT(*)                                                  AS fires,
  COUNT(*) FILTER (WHERE outcome_4h IS NOT NULL)           AS with_outcome,
  ROUND(AVG(outcome_1h)::NUMERIC, 2)                        AS avg_1h_pct,
  ROUND(AVG(outcome_4h)::NUMERIC, 2)                        AS avg_4h_pct,
  ROUND(AVG(outcome_24h)::NUMERIC, 2)                       AS avg_24h_pct,
  COUNT(*) FILTER (WHERE outcome_4h > 0)                   AS positive_4h,
  COUNT(*) FILTER (WHERE outcome_4h > 2)                   AS profitable_4h,      -- >2% move
  ROUND(
    COUNT(*) FILTER (WHERE outcome_4h > 0)::NUMERIC
    / NULLIF(COUNT(*) FILTER (WHERE outcome_4h IS NOT NULL), 0) * 100, 1
  )                                                         AS win_rate_4h,
  ROUND(AVG(score)::NUMERIC, 0)                             AS avg_score,
  MAX(fired_at)                                             AS last_fire
FROM signal_outcomes
WHERE fired_at > NOW() - INTERVAL '30 days'
GROUP BY signal
ORDER BY avg_4h_pct DESC NULLS LAST;
