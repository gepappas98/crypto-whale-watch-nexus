-- ══ WHALE RADAR — Migration: alert decision-outcome loop ═══════════════════
-- Closes the "decision-outcome loop" P1 item from the README's Strategic
-- Direction section — the last item on that list. Distinct from
-- 001_signal_outcomes.sql: that table auto-tracks forward price for every
-- CEO Signal fire regardless of what the user did about it. This tracks
-- what the USER actually did about a specific alert (reviewed it vs. acted
-- on it) so the eventual ML layer can learn which alert types were
-- actually useful to THIS user, not just which signals move price.
-- Run after schema.sql: psql $DATABASE_URL -f server/migrations/005_alert_outcomes.sql

-- alerts didn't carry a coin reference before this — added so alerts that
-- originate from a specific coin (the scanner's CRITICAL/HIGH fires) can
-- have their forward price tracked; alerts with no natural coin (e.g. a
-- REGIME-tagged market-wide alert, or an API-error alert) just leave these
-- NULL, same as signal_outcomes leaves coin_id NULL when unknown.
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS coin_id     TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS entry_price NUMERIC;

CREATE TABLE IF NOT EXISTS alert_outcomes (
  id              SERIAL PRIMARY KEY,
  alert_id        INT         NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  -- 'reviewed'  — user looked at it, took no position.
  -- 'bought'    — user acted on it. Only 'bought' rows get a price outcome
  --               tracked below; there's nothing to price-check for a
  --               review-only decision.
  action          TEXT        NOT NULL CHECK (action IN ('reviewed', 'bought')),
  -- Snapshot of alerts.coin_id/entry_price at the moment the user recorded
  -- their decision, not a live join — so this stays correct even if a
  -- coin's data later changes shape, and mirrors signal_outcomes' own
  -- entry_price-captured-at-fire-time approach.
  coin_id         TEXT,
  entry_price     NUMERIC,
  price_24h       NUMERIC,
  outcome_24h_pct NUMERIC,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  filled_24h_at   TIMESTAMPTZ
);

-- One decision per alert — logging a new action for the same alert
-- replaces the old one (see the route's ON CONFLICT DO UPDATE) rather than
-- accumulating a history of a user changing their mind.
CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_outcomes_alert ON alert_outcomes(alert_id);
CREATE INDEX IF NOT EXISTS idx_alert_outcomes_unfilled ON alert_outcomes(created_at)
  WHERE action = 'bought' AND price_24h IS NULL;

-- ── Eval view — per alert-tag, how the user's own "bought" decisions did ────
-- Deliberately scoped to action='bought': a 'reviewed' row has no position
-- and including it would silently zero-weight the average instead of
-- excluding it, understating real performance.
CREATE OR REPLACE VIEW v_alert_decision_eval AS
SELECT
  a.tag,
  COUNT(*) FILTER (WHERE ao.action = 'reviewed')                        AS reviewed_count,
  COUNT(*) FILTER (WHERE ao.action = 'bought')                          AS bought_count,
  COUNT(*) FILTER (WHERE ao.action = 'bought' AND ao.outcome_24h_pct IS NOT NULL)
                                                                          AS bought_with_outcome,
  ROUND(AVG(ao.outcome_24h_pct) FILTER (WHERE ao.action = 'bought')::NUMERIC, 2)
                                                                          AS avg_bought_24h_pct,
  ROUND(
    COUNT(*) FILTER (WHERE ao.action = 'bought' AND ao.outcome_24h_pct > 0)::NUMERIC
    / NULLIF(COUNT(*) FILTER (WHERE ao.action = 'bought' AND ao.outcome_24h_pct IS NOT NULL), 0) * 100, 1
  )                                                                       AS bought_win_rate_24h
FROM alert_outcomes ao
JOIN alerts a ON a.id = ao.alert_id
GROUP BY a.tag
ORDER BY avg_bought_24h_pct DESC NULLS LAST;
