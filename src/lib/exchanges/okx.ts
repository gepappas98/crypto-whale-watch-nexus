import type { ExchangeAdapter, NormalizedTrade } from './types';

/** 'BTCUSDT' (this app's canonical format) → 'BTC-USDT' (OKX's instId format). */
function toOkxInstId(pair: string): string {
  const base = pair.replace(/USDT$/i, '');
  return `${base}-USDT`;
}

/**
 * OKX public trades channel — a genuinely new exchange for Whale Radar
 * (previously only Binance + Bybit). OKX v5 WS docs:
 * subscribe:  {"op":"subscribe","args":[{"channel":"trades","instId":"BTC-USDT"}]}
 * trade msg:  {"arg":{"channel":"trades","instId":"BTC-USDT"},
 *              "data":[{"instId":"BTC-USDT","px":"...","sz":"...","side":"buy","ts":"..."}]}
 */
export const okxAdapter: ExchangeAdapter = {
  id: 'okx',
  label: 'OKX',
  wsUrl: 'wss://ws.okx.com:8443/ws/v5/public',

  buildSubscribeMessage: (pairs) => JSON.stringify({
    op: 'subscribe',
    args: pairs.map(p => ({ channel: 'trades', instId: toOkxInstId(p) })),
  }),

  parseMessage: (raw, minUsd): NormalizedTrade | null => {
    try {
      const msg = JSON.parse(raw);
      if (msg?.event) return null; // subscribe ack / error frame, not a trade
      const arg = msg?.arg;
      if (!arg || arg.channel !== 'trades' || !Array.isArray(msg.data)) return null;
      const t = msg.data[0];
      if (!t) return null;
      const price = parseFloat(t.px);
      const qty = parseFloat(t.sz);
      const usdt = price * qty;
      if (!isFinite(usdt) || usdt < minUsd) return null;
      return {
        ts: t.ts ? parseInt(t.ts, 10) : Date.now(),
        sym: String(t.instId || '').split('-')[0],
        side: t.side === 'buy' ? 'BUY' : 'SELL',
        price, qty, usdt,
        ex: 'okx',
      };
    } catch {
      return null;
    }
  },
};
