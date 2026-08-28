-- ══ WHALE RADAR — Migration: atomic tracked-token upsert ════════════════════
-- Supports supabase/functions/tracked/index.ts (the Edge Function port of
-- server/routes/tracked.ts). The original upsert does
-- `coin_id = COALESCE($2, tracked_tokens.coin_id)` — preserve the existing
-- coin_id if the caller doesn't supply one, rather than overwriting it with
-- NULL. Supabase's plain .upsert() always overwrites every column present
-- in the payload; there's no client-side way to say "keep whatever's
-- already there" without fetching first (a race) or, as here, doing the
-- COALESCE atomically inside the database.
-- Run after 008_portfolio_view.sql:
--   psql $DATABASE_URL -f server/migrations/009_tracked_token_upsert.sql

CREATE OR REPLACE FUNCTION upsert_tracked_token(
  p_symbol TEXT,
  p_coin_id TEXT,
  p_base_price NUMERIC
)
RETURNS SETOF tracked_tokens
LANGUAGE sql
AS $$
  INSERT INTO tracked_tokens (symbol, coin_id, base_price, last_price)
  VALUES (p_symbol, p_coin_id, p_base_price, p_base_price)
  ON CONFLICT (symbol) DO UPDATE
    SET last_price = p_base_price,
        coin_id = COALESCE(p_coin_id, tracked_tokens.coin_id)
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION upsert_tracked_token(TEXT, TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_tracked_token(TEXT, TEXT, NUMERIC) TO service_role;
