-- ══ HYPERLIQUID CACHE TABLE ══════════════════════════════════════════════════
-- Stores short-lived cached responses from Hypurrscan APIs.
-- TTL is enforced in application logic (500ms for blocks/txs, 2000ms for addr).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hyperliquid_cache (
  cache_key   TEXT PRIMARY KEY,          -- e.g. "blocks", "address:0xABC", "txs:0xABC"
  payload     JSONB        NOT NULL,     -- raw API response
  fetched_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ttl_ms      INTEGER      NOT NULL DEFAULT 500   -- expected TTL in ms (for info only)
);

-- Purge rows older than 10 seconds automatically (avoid unbounded growth).
-- pg_cron or a simple cleanup inside the function both work; we use a partial index
-- so the edge function can efficiently delete stale rows on each request.
CREATE INDEX IF NOT EXISTS idx_hyperliquid_cache_fetched
  ON hyperliquid_cache (fetched_at);

-- RLS: only authenticated service-role (edge function) may read/write.
ALTER TABLE hyperliquid_cache ENABLE ROW LEVEL SECURITY;

-- Allow the service role (used by edge functions) full access.
CREATE POLICY "service_role_all" ON hyperliquid_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ══ RATE LIMIT COUNTER TABLE ══════════════════════════════════════════════════
-- Tracks outgoing request counts per minute to stay under 200 req/min.

CREATE TABLE IF NOT EXISTS hl_rate_counter (
  window_key  TEXT PRIMARY KEY,   -- YYYY-MM-DDTHH:MM (minute bucket)
  count       INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE hl_rate_counter ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON hl_rate_counter
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
