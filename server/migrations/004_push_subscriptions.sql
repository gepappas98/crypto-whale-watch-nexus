-- ══ WEB PUSH — subscriptions table ═══════════════════════════════════════════
-- One row per browser push subscription (endpoint is unique per browser+origin
-- per the Push API spec, so it doubles as the natural key). No user_id column:
-- this app has no login system (see README's Roadmap for that gap), so a
-- subscription isn't tied to an account — it's tied to a browser. Fine for a
-- broadcast-style "send to everyone subscribed" model, not for per-user
-- targeting; that would need real auth first.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint    TEXT PRIMARY KEY,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
