-- ══ WHALE RADAR — Migration: signal-fire recording RPC ══════════════════════
-- Supports supabase/functions/signal-outcomes/index.ts (the Edge Function
-- port of server/routes/signalOutcomes.ts). The dedup constraint
-- (idx_so_dedup, migration 001) is on an EXPRESSION —
-- (symbol, signal, date_trunc('hour', fired_at)) — not plain columns.
-- PostgREST's .upsert({ onConflict: '...' }) can only target a unique
-- constraint by naming actual columns, so it has no way to target an
-- expression index at all. This RPC does the exact same
-- `INSERT ... ON CONFLICT ON CONSTRAINT idx_so_dedup DO NOTHING RETURNING id`
-- the original raw-SQL route used.
-- Run after 009_tracked_token_upsert.sql:
--   psql $DATABASE_URL -f server/migrations/010_record_signal_fire.sql

CREATE OR REPLACE FUNCTION record_signal_fire(
  p_symbol TEXT,
  p_coin_id TEXT,
  p_signal TEXT,
  p_score NUMERIC,
  p_category TEXT,
  p_vmcap NUMERIC,
  p_entry_price NUMERIC
)
RETURNS TABLE(id INT)
LANGUAGE sql
AS $$
  INSERT INTO signal_outcomes (symbol, coin_id, signal, score, category, vmcap, entry_price)
  VALUES (p_symbol, p_coin_id, p_signal, p_score, p_category, p_vmcap, p_entry_price)
  ON CONFLICT ON CONSTRAINT idx_so_dedup DO NOTHING
  RETURNING signal_outcomes.id;
$$;

REVOKE ALL ON FUNCTION record_signal_fire(TEXT, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_signal_fire(TEXT, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, NUMERIC) TO service_role;
