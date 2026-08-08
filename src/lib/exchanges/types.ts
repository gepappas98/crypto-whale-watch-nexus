/* ══ WHALE RADAR — EXCHANGE ADAPTER INTERFACE ═════════════════════════════════
 *
 *  Ported concept from freqtrade's exchange/exchange.py + per-exchange
 *  subclasses (binance.py, bybit.py, okx.py, kraken.py, ...). freqtrade
 *  puts one unified interface in front of many exchanges (via ccxt) so the
 *  strategy/bot code never has to know which exchange it's talking to —
 *  only each exchange's own adapter file knows its URL, message shapes,
 *  and quirks.
 *
 *  Whale Radar's existing useWhaleWebSocket.ts hand-rolls Binance + Bybit
 *  connection/parsing inline, with hardened reconnect/circuit-breaker logic
 *  built up over several sessions — that hook is left untouched here. This
 *  file defines the same unified-adapter shape freqtrade uses, so any new
 *  exchange becomes "write one small adapter object", not "duplicate 200
 *  lines of WebSocket plumbing". See exchanges/{binance,bybit,okx,kraken}.ts
 *  for adapters, exchanges/registry.ts for the lookup, and
 *  hooks/useExchangeFeed.ts for the generic connection driver that any
 *  adapter here can plug into.
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface NormalizedTrade {
  ts: number;
  /** Base symbol without quote currency, e.g. 'BTC' (not 'BTCUSDT'). */
  sym: string;
  side: 'BUY' | 'SELL';
  price: number;
  qty: number;
  usdt: number;
  ex: string;
}

export interface ExchangeAdapter {
  id: string;
  label: string;
  wsUrl: string;
  /**
   * Build the subscribe frame this exchange expects. Receives canonical
   * 'BTCUSDT'-style pairs (this app's format everywhere else) — the
   * adapter itself is responsible for converting to whatever format its
   * exchange wants (e.g. OKX wants 'BTC-USDT', Kraken wants 'BTC/USD').
   */
  buildSubscribeMessage(pairs: string[]): string;
  /**
   * Parse one raw WS text frame. Returns null for anything that isn't a
   * trade event (subscribe acks, pings, trades below minUsd, unparseable
   * frames) — the driver hook just skips nulls.
   */
  parseMessage(raw: string, minUsd: number): NormalizedTrade | null;
}
