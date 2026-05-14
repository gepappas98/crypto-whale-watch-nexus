-- ══ WHALE RADAR v9 — PostgreSQL Schema ════════════════════════════════════════
-- Run once on Railway: psql $DATABASE_URL -f server/schema.sql

-- ── Scan Sessions ─────────────────────────────────────────────────────────────
-- One row per full scan run. Lightweight header for history queries.
CREATE TABLE IF NOT EXISTS scan_sessions (
  id          SERIAL PRIMARY KEY,
  scanned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  coin_count  INT         NOT NULL DEFAULT 0,
  crit_count  INT         NOT NULL DEFAULT 0,
  high_count  INT         NOT NULL DEFAULT 0
);

-- ── Scan Coins ────────────────────────────────────────────────────────────────
-- Individual coin results per session. JSONB for flexible fields (reasons, birdData).
CREATE TABLE IF NOT EXISTS scan_coins (
  id          SERIAL PRIMARY KEY,
  session_id  INT         NOT NULL REFERENCES scan_sessions(id) ON DELETE CASCADE,
  symbol      TEXT        NOT NULL,
  name        TEXT,
  rank        INT,
  price       NUMERIC,
  change_24h  NUMERIC,
  volume      NUMERIC,
  mcap        NUMERIC,
  vmcap       NUMERIC,
  vol_spike   NUMERIC,
  score       INT,
  threat      TEXT,
  category    TEXT,
  confidence  INT,
  reasons     JSONB,
  is_sol      BOOLEAN     DEFAULT FALSE,
  bird_data   JSONB,
  scanned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scan_coins_session  ON scan_coins(session_id);
CREATE INDEX IF NOT EXISTS idx_scan_coins_symbol   ON scan_coins(symbol);
CREATE INDEX IF NOT EXISTS idx_scan_coins_score    ON scan_coins(score DESC);
CREATE INDEX IF NOT EXISTS idx_scan_coins_threat   ON scan_coins(threat);

-- ── Portfolio ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portfolio (
  id          SERIAL PRIMARY KEY,
  symbol      TEXT        NOT NULL UNIQUE,
  amount      NUMERIC     NOT NULL,
  entry_price NUMERIC     NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Tracked Tokens (Watchlist) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tracked_tokens (
  id          SERIAL PRIMARY KEY,
  symbol      TEXT        NOT NULL UNIQUE,
  coin_id     TEXT,
  base_price  NUMERIC,
  last_price  NUMERIC,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Alerts ────────────────────────────────────────────────────────────────────
-- Persists CRITICAL/HIGH alerts. Info alerts are ephemeral (not stored).
CREATE TABLE IF NOT EXISTS alerts (
  id          SERIAL PRIMARY KEY,
  level       TEXT        NOT NULL CHECK (level IN ('critical','high','medium','info')),
  tag         TEXT,
  text        TEXT,
  sizing      TEXT,
  pinned      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_level     ON alerts(level);
CREATE INDEX IF NOT EXISTS idx_alerts_created   ON alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_pinned    ON alerts(pinned) WHERE pinned = TRUE;

-- ── Whale Events ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whale_events (
  id          SERIAL PRIMARY KEY,
  symbol      TEXT        NOT NULL,
  side        TEXT        NOT NULL CHECK (side IN ('BUY','SELL')),
  price       NUMERIC,
  qty         NUMERIC,
  usdt        NUMERIC,
  exchange    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whale_symbol   ON whale_events(symbol);
CREATE INDEX IF NOT EXISTS idx_whale_created  ON whale_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whale_usdt     ON whale_events(usdt DESC);

-- ── Useful Views ──────────────────────────────────────────────────────────────

-- Latest scan with aggregated threat counts
CREATE OR REPLACE VIEW v_latest_scan AS
SELECT
  ss.id           AS session_id,
  ss.scanned_at,
  ss.coin_count,
  ss.crit_count,
  ss.high_count,
  COUNT(sc.id)                                    AS total_coins,
  COUNT(*) FILTER (WHERE sc.score >= 70)          AS critical_coins,
  ROUND(AVG(sc.score)::NUMERIC, 1)                AS avg_score,
  MAX(sc.score)                                   AS max_score
FROM scan_sessions ss
JOIN scan_coins sc ON sc.session_id = ss.id
WHERE ss.id = (SELECT MAX(id) FROM scan_sessions)
GROUP BY ss.id;

-- Top manipulation candidates across all history
CREATE OR REPLACE VIEW v_top_threats AS
SELECT
  symbol,
  MAX(score)                    AS peak_score,
  COUNT(DISTINCT session_id)    AS scan_appearances,
  (ARRAY['LOW','MEDIUM','HIGH','CRITICAL'])[
    MAX(
      CASE threat
        WHEN 'LOW'      THEN 1
        WHEN 'MEDIUM'   THEN 2
        WHEN 'HIGH'     THEN 3
        WHEN 'CRITICAL' THEN 4
        ELSE 0
      END
    )
  ]                             AS worst_threat,
  MODE() WITHIN GROUP (ORDER BY category) AS dominant_category,
  MAX(scanned_at)               AS last_seen
FROM scan_coins
WHERE score >= 45
GROUP BY symbol
ORDER BY peak_score DESC, scan_appearances DESC;

-- Portfolio with live price from latest scan
CREATE OR REPLACE VIEW v_portfolio_live AS
SELECT
  p.symbol,
  p.amount,
  p.entry_price,
  sc.price      AS current_price,
  ROUND(((sc.price - p.entry_price) / NULLIF(p.entry_price, 0) * 100)::NUMERIC, 2) AS pnl_pct,
  ROUND((p.amount * (sc.price - p.entry_price))::NUMERIC, 2)            AS pnl_usd
FROM portfolio p
LEFT JOIN LATERAL (
  SELECT price FROM scan_coins
  WHERE symbol = p.symbol
  ORDER BY scanned_at DESC
  LIMIT 1
) sc ON TRUE;

-- ── Signal Outcomes ───────────────────────────────────────────────────────────
-- Records CEO Signal Engine fires with 1h/4h/24h price outcomes.
-- Background price filler (server/index.ts) fills prices via CoinGecko every 30min.
CREATE TABLE IF NOT EXISTS signal_outcomes (
  id            SERIAL PRIMARY KEY,
  symbol        TEXT        NOT NULL,
  coin_id       TEXT,
  signal        TEXT        NOT NULL,
  score         INT,
  category      TEXT,
  vmcap         NUMERIC,
  entry_price   NUMERIC     NOT NULL,
  price_1h      NUMERIC,
  price_4h      NUMERIC,
  price_24h     NUMERIC,
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_so_dedup
  ON signal_outcomes(symbol, signal, date_trunc('hour', fired_at));

CREATE OR REPLACE VIEW v_signal_eval AS
SELECT
  signal,
  COUNT(*)                                                  AS fires,
  COUNT(*) FILTER (WHERE outcome_4h IS NOT NULL)           AS with_outcome,
  ROUND(AVG(outcome_1h)::NUMERIC, 2)                        AS avg_1h_pct,
  ROUND(AVG(outcome_4h)::NUMERIC, 2)                        AS avg_4h_pct,
  ROUND(AVG(outcome_24h)::NUMERIC, 2)                       AS avg_24h_pct,
  COUNT(*) FILTER (WHERE outcome_4h > 0)                   AS positive_4h,
  COUNT(*) FILTER (WHERE outcome_4h > 2)                   AS profitable_4h,
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
