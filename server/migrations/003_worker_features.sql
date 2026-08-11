-- ══ NEXUS BOT — worker features ═══════════════════════════════════════════════
-- Adds what the previously-stubbed worker loop needs to be real:
--   1. nexus_bot_grids.filled_count — grid maintenance needs somewhere to
--      accumulate "this level filled and was re-placed" so GET /grids can
--      report a real filledGrids number instead of a hardcoded 0.
--   2. nexus_bot_volume_maker.exchange/symbol — the volume-maker loop needs
--      something concrete to trade; the previous schema had nowhere to put it.

ALTER TABLE nexus_bot_grids
  ADD COLUMN IF NOT EXISTS filled_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE nexus_bot_volume_maker
  ADD COLUMN IF NOT EXISTS exchange TEXT,
  ADD COLUMN IF NOT EXISTS symbol   TEXT;
