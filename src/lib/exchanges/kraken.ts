import type { ExchangeAdapter, NormalizedTrade } from './types';

/** 'BTCUSDT' → 'BTC/USD'. Kraken's spot books are quoted in USD, not USDT. */
function toKrakenSymbol(pair: string): string {
  const base = pair.replace(/USDT$/i, '');
  return `${base}/USD`;
}

/**
 * Kraken WS v2 trade channel — a second new exchange, showing that adding
 * one more is "write ~40 lines matching this exchange's message shape",
 * not "touch the reconnect/circuit-breaker logic". Kraken WS v2 docs:
 * subscribe: {"method":"subscribe","params":{"channel":"trade","symbol":["BTC/USD"]}}
 * trade msg: {"channel":"trade","type":"update",
 *             "data":[{"symbol":"BTC/USD","side":"buy","price":...,"qty":...,"timestamp":"..."}]}
 */
export const krakenAdapter: ExchangeAdapter = {
  id: 'kraken',
  label: 'Kraken',
  wsUrl: 'wss://ws.kraken.com/v2',

  buildSubscribeMessage: (pairs) => JSON.stringify({
    method: 'subscribe',
    params: { channel: 'trade', symbol: pairs.map(toKrakenSymbol) },
  }),

  parseMessage: (raw, minUsd): NormalizedTrade | null => {
    try {
      const msg = JSON.parse(raw);
      if (msg?.channel !== 'trade' || !Array.isArray(msg.data)) return null;
      const t = msg.data[0];
      if (!t) return null;
      const price = Number(t.price);
      const qty = Number(t.qty);
      const usdt = price * qty;
      if (!isFinite(usdt) || usdt < minUsd) return null;
      return {
        ts: t.timestamp ? Date.parse(t.timestamp) : Date.now(),
        sym: String(t.symbol || '').split('/')[0],
        side: t.side === 'buy' ? 'BUY' : 'SELL',
        price, qty, usdt,
        ex: 'kraken',
      };
    } catch {
      return null;
    }
  },
};
