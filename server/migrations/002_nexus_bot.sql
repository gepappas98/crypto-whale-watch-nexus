-- ══ NEXUS BOT — server-side execution state ═══════════════════════════════════
-- The browser's protections.ts/botTradeStore.ts are localStorage-backed —
-- fine for the UI's own gating, but the server can't see browser localStorage
-- and must never trust a client's word that a check already passed. This
-- gives the server-side bot its own Postgres-backed ledger + lock table,
-- mirroring the same StoplossGuard/CooldownPeriod concepts already used
-- client-side, so REST calls to /api/nexus-bot/* are gated independently.

CREATE TABLE IF NOT EXISTS nexus_bot_trades (
  id            BIGSERIAL PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('arbitrage', 'grid_open', 'grid_close', 'volume_maker')),
  pair          TEXT NOT NULL,
  exchange      TEXT,
  side          TEXT,
  amount_usd    NUMERIC,
  pnl_usd       NUMERIC,          -- null until realized (grid closes, arb settles)
  dry_run       BOOLEAN NOT NULL DEFAULT true,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'error')),
  error_message TEXT,
  meta          JSONB,            -- raw exchange order response(s), for debugging
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_nexus_bot_trades_pair_created ON nexus_bot_trades (pair, created_at DESC);

CREATE TABLE IF NOT EXISTS nexus_bot_locks (
  pair       TEXT NOT NULL,
  source     TEXT NOT NULL,   -- 'cooldown' | 'stoploss_guard' | 'max_drawdown' | 'low_profit_pairs'
  reason     TEXT,
  locked_until TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (pair, source)
);

CREATE TABLE IF NOT EXISTS nexus_bot_grids (
  id              TEXT PRIMARY KEY,          -- client-supplied grid id (GridConfig.id)
  exchange        TEXT NOT NULL,
  symbol          TEXT NOT NULL,
  market_type     TEXT NOT NULL,
  mode            TEXT NOT NULL,
  upper_price     NUMERIC NOT NULL,
  lower_price     NUMERIC NOT NULL,
  grid_count      INTEGER NOT NULL,
  total_investment NUMERIC NOT NULL,
  fee_rate        NUMERIC NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stopped', 'error')),
  order_ids       JSONB NOT NULL DEFAULT '[]',   -- exchange order ids placed for this grid, so stopGrid can cancel them
  dry_run         BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS nexus_bot_volume_maker (
  id            SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton: one volume-maker state at a time
  active        BOOLEAN NOT NULL DEFAULT false,
  mode          TEXT,
  signal_source TEXT,
  total_volume_usd NUMERIC NOT NULL DEFAULT 0,
  fees_usd      NUMERIC NOT NULL DEFAULT 0,
  rebates_usd   NUMERIC NOT NULL DEFAULT 0,
  trades        INTEGER NOT NULL DEFAULT 0,
  started_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO nexus_bot_volume_maker (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
