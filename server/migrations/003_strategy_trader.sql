-- ══ STRATEGY TRADER — widen nexus_bot_trades.kind ═══════════════════════════
-- Strategy Trader (freqtrade bridge) forceenter/forceexit calls now get
-- recorded in the same ledger as the ccxt-based Nexus Bot, so its 'kind'
-- CHECK constraint needs a value for them. Run after 002_nexus_bot.sql.

ALTER TABLE nexus_bot_trades DROP CONSTRAINT IF EXISTS nexus_bot_trades_kind_check;
ALTER TABLE nexus_bot_trades ADD CONSTRAINT nexus_bot_trades_kind_check
  CHECK (kind IN ('arbitrage', 'grid_open', 'grid_close', 'volume_maker', 'strategy_trade'));
