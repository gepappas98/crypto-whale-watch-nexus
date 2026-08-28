-- ══ WHALE RADAR — Migration: schedule the alert price filler ═══════════════
-- Replaces the Express server's setInterval-driven fillAlertOutcomePrices()
-- (server/index.ts) with a genuine Postgres-scheduled job calling the new
-- Edge Function directly — the actual point of the alerts migration: this
-- periodic DB-touching job no longer needs a permanently-running server
-- process to exist at all. Requires the pg_cron and pg_net extensions,
-- both enableable from the Supabase dashboard (Database → Extensions) or
-- via `create extension` if you have the privilege.
--
-- ACTION NEEDED BEFORE RUNNING: replace the two placeholders below —
--   <PROJECT_REF>     — your Supabase project ref (Settings → General)
--   <SERVICE_ROLE_KEY> — Settings → API → service_role key (NOT anon key;
--                        this bypasses RLS, matching what the Edge
--                        Function itself already does — see its docstring)
-- Storing the service-role key in a cron job body is standard practice for
-- Supabase's own pg_cron + pg_net pattern (it lives in pg_cron's internal
-- job table, not anywhere client-reachable), but treat this migration file
-- itself as sensitive once you've filled in the real key — do not commit
-- the filled-in version to a public repo.
--
-- Run after 006_alert_pin_toggle.sql, once the Edge Function above is
-- actually deployed: psql $DATABASE_URL -f server/migrations/007_alert_price_filler_cron.sql

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Every 30 minutes — same cadence as the Express version's FILL_INTERVAL_MS.
SELECT cron.schedule(
  'alert-price-filler',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://<PROJECT_REF>.functions.supabase.co/alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body := jsonb_build_object('op', 'fill_prices')
  );
  $$
);

-- To remove/replace this schedule later:
--   SELECT cron.unschedule('alert-price-filler');
