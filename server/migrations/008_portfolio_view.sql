-- ══ WHALE RADAR — Migration: portfolio-with-PnL view ════════════════════════
-- Supports supabase/functions/portfolio/index.ts (the Edge Function port of
-- server/routes/portfolio.ts). GET /api/portfolio's LATERAL JOIN against the
-- latest scan_coins row per symbol has no PostgREST equivalent (it doesn't
-- support LATERAL joins or per-row correlated subqueries) — a view is the
-- standard way to expose this to PostgREST as a plain selectable relation.
-- Run after 007_alert_price_filler_cron.sql:
--   psql $DATABASE_URL -f server/migrations/008_portfolio_view.sql

CREATE OR REPLACE VIEW v_portfolio_with_pnl AS
SELECT
  p.*,
  sc.price AS current_price,
  ROUND(((sc.price - p.entry_price) / NULLIF(p.entry_price, 0) * 100)::NUMERIC, 2) AS pnl_pct,
  ROUND((p.amount * (sc.price - p.entry_price))::NUMERIC, 2) AS pnl_usd
FROM portfolio p
LEFT JOIN LATERAL (
  SELECT price FROM scan_coins WHERE symbol = p.symbol
  ORDER BY scanned_at DESC LIMIT 1
) sc ON TRUE
ORDER BY p.symbol;
