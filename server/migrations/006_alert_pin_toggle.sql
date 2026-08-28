-- ══ WHALE RADAR — Migration: atomic alert pin toggle ═══════════════════════
-- Supports supabase/functions/alerts/index.ts (the Edge Function port of
-- server/routes/alerts.ts's PATCH /:id/pin). A read-then-write toggle from
-- the Edge Function itself would race two browser tabs toggling the same
-- alert at once; this does the flip in one atomic UPDATE ... RETURNING on
-- the database side instead.
-- Run after 005_alert_outcomes.sql: psql $DATABASE_URL -f server/migrations/006_alert_pin_toggle.sql

CREATE OR REPLACE FUNCTION toggle_alert_pin(p_alert_id INT)
RETURNS SETOF alerts
LANGUAGE sql
AS $$
  UPDATE alerts SET pinned = NOT pinned WHERE id = p_alert_id RETURNING *;
$$;

-- Callable by the service-role key the Edge Function authenticates with;
-- not exposed to anon/authenticated roles directly, since the point of
-- routing this through the Edge Function (rather than a client-side
-- Supabase query) is a single controlled interface — see that file's own
-- docstring for the full reasoning.
REVOKE ALL ON FUNCTION toggle_alert_pin(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION toggle_alert_pin(INT) TO service_role;
