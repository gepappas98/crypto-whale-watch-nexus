-- ══ WHALE RADAR — Migration: schedule the signal-outcomes price filler ═════
-- Same pattern as 007_alert_price_filler_cron.sql — replaces the Express
-- server's setInterval-driven fillOutcomePrices() (server/index.ts) with a
-- Postgres-scheduled call to the new Edge Function. See that migration's
-- comment for the full reasoning and the pg_cron/pg_net extension
-- requirement (shared across both — only needs enabling once).
--
-- ACTION NEEDED BEFORE RUNNING: same two placeholders as 007's —
--   <PROJECT_REF>      — Settings → General
--   <SERVICE_ROLE_KEY> — Settings → API → service_role key
--
-- Run after 010_record_signal_fire.sql, once the Edge Function below is
-- actually deployed: psql $DATABASE_URL -f server/migrations/011_signal_outcomes_filler_cron.sql

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Every 30 minutes — same cadence as the Express version.
SELECT cron.schedule(
  'signal-outcomes-price-filler',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://<PROJECT_REF>.functions.supabase.co/signal-outcomes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body := jsonb_build_object('op', 'fill_prices')
  );
  $$
);

-- To remove/replace this schedule later:
--   SELECT cron.unschedule('signal-outcomes-price-filler');
