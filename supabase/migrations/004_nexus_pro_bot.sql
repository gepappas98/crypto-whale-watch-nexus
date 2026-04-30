-- ══ NEXUS PRO — Bot & Trading Tables ═════════════════════════════════════════
-- Run via: supabase db push  OR  psql $DATABASE_URL < 004_nexus_pro_bot.sql

-- Active grid strategies
CREATE TABLE IF NOT EXISTS grid_strategies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange      TEXT NOT NULL,
  symbol        TEXT NOT NULL,
  market_type   TEXT NOT NULL DEFAULT 'perpetual',
  mode          TEXT NOT NULL DEFAULT 'normal',
  upper_price   NUMERIC NOT NULL,
  lower_price   NUMERIC NOT NULL,
  grid_count    INTEGER NOT NULL,
  total_investment NUMERIC NOT NULL,
  fee_rate      NUMERIC NOT NULL DEFAULT 0.02,
  take_profit   NUMERIC,
  stop_loss     NUMERIC,
  status        TEXT NOT NULL DEFAULT 'active', -- active | stopped | completed
  pnl           NUMERIC NOT NULL DEFAULT 0,
  filled_grids  INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  stopped_at    TIMESTAMPTZ
);

-- Arbitrage execution log
CREATE TABLE IF NOT EXISTS arb_executions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair          TEXT NOT NULL,
  exchange1     TEXT NOT NULL,
  exchange2     TEXT NOT NULL,
  direction     TEXT NOT NULL,
  spread_pct    NUMERIC NOT NULL,
  entry_price1  NUMERIC,
  entry_price2  NUMERIC,
  exit_price1   NUMERIC,
  exit_price2   NUMERIC,
  size_usd      NUMERIC,
  realized_pnl  NUMERIC,
  status        TEXT NOT NULL DEFAULT 'queued', -- queued | executing | filled | failed
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  filled_at     TIMESTAMPTZ
);

-- Volume making sessions
CREATE TABLE IF NOT EXISTS volume_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange      TEXT NOT NULL,
  symbol        TEXT NOT NULL,
  signal_source TEXT NOT NULL,
  target_volume NUMERIC NOT NULL,
  actual_volume NUMERIC NOT NULL DEFAULT 0,
  fees_paid     NUMERIC NOT NULL DEFAULT 0,
  rebates_earned NUMERIC NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'running', -- running | stopped | paused
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  stopped_at    TIMESTAMPTZ
);

-- Bot alerts (whale-arb correlations, risk breaches)
CREATE TABLE IF NOT EXISTS bot_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type    TEXT NOT NULL, -- whale_large_tx | arbitrage_opportunity | whale_bot_correlation | risk_threshold_breach
  message       TEXT NOT NULL,
  symbol        TEXT,
  metadata      JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_grid_strategies_status   ON grid_strategies(status);
CREATE INDEX IF NOT EXISTS idx_grid_strategies_exchange ON grid_strategies(exchange, symbol);
CREATE INDEX IF NOT EXISTS idx_arb_executions_status    ON arb_executions(status);
CREATE INDEX IF NOT EXISTS idx_arb_executions_pair      ON arb_executions(pair);
CREATE INDEX IF NOT EXISTS idx_volume_sessions_status   ON volume_sessions(status);
CREATE INDEX IF NOT EXISTS idx_bot_alerts_type          ON bot_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_bot_alerts_created       ON bot_alerts(created_at DESC);

COMMENT ON TABLE grid_strategies  IS 'Active and historical grid trading strategy deployments';
COMMENT ON TABLE arb_executions   IS 'Arbitrage execution log with entry/exit prices and P&L';
COMMENT ON TABLE volume_sessions  IS 'Volume making bot sessions with fee/rebate tracking';
COMMENT ON TABLE bot_alerts       IS 'Unified alert log for whale events, arb signals, correlations';
