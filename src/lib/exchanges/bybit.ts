import type { ExchangeAdapter, NormalizedTrade } from './types';

/**
 * Reference adapter for Bybit's publicTrade (linear perps) stream, in the
 * unified shape. See binance.ts for the migration note — production Bybit
 * connection still lives in useWhaleWebSocket.ts.
 */
export const bybitAdapter: ExchangeAdapter = {
  id: 'bybit',
  label: 'Bybit',
  wsUrl: 'wss://stream.bybit.com/v5/public/linear',

  buildSubscribeMessage: (pairs) => JSON.stringify({
    op: 'subscribe',
    args: pairs.map(p => 'publicTrade.' + p.toUpperCase()),
  }),

  parseMessage: (raw, minUsd): NormalizedTrade | null => {
    try {
      const msg = JSON.parse(raw);
      if (typeof msg?.topic !== 'string' || !msg.topic.startsWith('publicTrade.') || !Array.isArray(msg.data)) {
        return null;
      }
      const sym = msg.topic.replace('publicTrade.', '').replace(/USDT$/, '');
      const t = msg.data[0];
      if (!t) return null;
      const price = parseFloat(t.p);
      const qty = parseFloat(t.v);
      const usdt = price * qty;
      if (!isFinite(usdt) || usdt < minUsd) return null;
      return {
        ts: t.T ?? Date.now(),
        sym,
        side: t.S === 'Buy' ? 'BUY' : 'SELL',
        price, qty, usdt,
        ex: 'bybit',
      };
    } catch {
      return null;
    }
  },
};
