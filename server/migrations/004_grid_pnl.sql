-- ══ NEXUS BOT — grid PNL tracking ══════════════════════════════════════════════
-- GET /grids has reported pnl: 0 (hardcoded, honestly, not faked) since the
-- worker had no cost-basis tracking. This adds what FIFO matching needs:
--   realized_pnl_usd — running total, updated each time a sell fill is
--     matched against earlier buy fill(s) — see server/services/gridPnl.ts.
--   open_buys — unmatched buy-fill inventory carried between worker ticks
--     (price/amount/fee per unmatched buy), so a sell that fills several
--     ticks after its matching buy still gets matched correctly.

ALTER TABLE nexus_bot_grids
  ADD COLUMN IF NOT EXISTS realized_pnl_usd NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS open_buys JSONB NOT NULL DEFAULT '[]';
