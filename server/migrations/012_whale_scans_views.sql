-- ══ WHALE RADAR — Migration: whale-events + scans aggregate views ═══════════
-- Supports supabase/functions/whale-events/index.ts and
-- supabase/functions/scans/index.ts. Two aggregate queries (GROUP BY +
-- CASE/ARRAY ranking) with no PostgREST equivalent, exposed as views the
-- same way v_alert_decision_eval/v_signal_eval already are.
-- Run after 011_signal_outcomes_filler_cron.sql:
--   psql $DATABASE_URL -f server/migrations/012_whale_scans_views.sql

-- Ported from whaleEvents.ts's GET /summary — 24h flow by symbol.
CREATE OR REPLACE VIEW v_whale_events_summary_24h AS
SELECT
  symbol,
  COUNT(*)                                        AS trades,
  SUM(usdt)                                       AS total_usdt,
  SUM(CASE WHEN side = 'BUY'  THEN usdt ELSE 0 END) AS buy_usdt,
  SUM(CASE WHEN side = 'SELL' THEN usdt ELSE 0 END) AS sell_usdt,
  MAX(usdt)                                       AS max_trade,
  MAX(created_at)                                 AS last_seen
FROM whale_events
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY symbol
ORDER BY total_usdt DESC
LIMIT 50;

-- Ported from scans.ts's GET /threats/top — worst threat level ever seen
-- per symbol, ranked by peak score. The CASE/ARRAY trick (rank threat
-- names 1-4, take the MAX rank, map back to the name) is exactly what the
-- original raw SQL did — carried over unchanged, not reworked, since it's
-- already the simplest way to get "worst threat level" out of a text
-- column without a separate enum type.
CREATE OR REPLACE VIEW v_scan_top_threats AS
SELECT
  symbol,
  MAX(score) AS peak_score,
  COUNT(DISTINCT session_id) AS appearances,
  (ARRAY['LOW','MEDIUM','HIGH','CRITICAL'])[MAX(
    CASE threat
      WHEN 'LOW'      THEN 1
      WHEN 'MEDIUM'   THEN 2
      WHEN 'HIGH'     THEN 3
      WHEN 'CRITICAL' THEN 4
      ELSE 0
    END
  )] AS worst_threat,
  MAX(scanned_at) AS last_seen
FROM scan_coins
WHERE score >= 45
GROUP BY symbol
ORDER BY peak_score DESC
LIMIT 50;
