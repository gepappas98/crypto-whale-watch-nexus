import type { ExchangeAdapter, NormalizedTrade } from './types';

/**
 * Reference adapter for Binance's aggTrade stream, in the unified shape.
 * Whale Radar's production Binance connection still lives in
 * useWhaleWebSocket.ts / the whale-stream edge function — this documents
 * the same message contract in the portable adapter format so future code
 * can migrate onto the generic driver without re-deriving the parsing logic.
 */
export const binanceAdapter: ExchangeAdapter = {
  id: 'binance',
  label: 'Binance',
  wsUrl: 'wss://stream.binance.com:9443/stream',

  buildSubscribeMessage: (pairs) => JSON.stringify({
    method: 'SUBSCRIBE',
    params: pairs.map(p => p.toLowerCase() + '@aggTrade'),
    id: 1,
  }),

  parseMessage: (raw, minUsd): NormalizedTrade | null => {
    try {
      const msg = JSON.parse(raw);
      const d = msg?.data;
      if (!d || d.e !== 'aggTrade') return null;
      const price = parseFloat(d.p);
      const qty = parseFloat(d.q);
      const usdt = price * qty;
      if (!isFinite(usdt) || usdt < minUsd) return null;
      return {
        ts: d.T ?? Date.now(),
        sym: String(d.s || '').replace(/USDT$/, ''),
        side: d.m ? 'SELL' : 'BUY', // m=true → buyer is maker → the aggressor sold
        price, qty, usdt,
        ex: 'binance',
      };
    } catch {
      return null;
    }
  },
};
