/* ══ useWhaleNetFlow — REAL net-flow aggregation ═══════════════════════════════
 *  Computes per-asset net buy/sell notional over 1h / 4h / 24h / 7d from Binance
 *  klines (taker-buy quote volume vs total quote volume), routed through the
 *  server-side proxy. No mock data, no fabricated fields.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useRef, useState } from 'react';
import { proxied } from '@/lib/binanceProxy';

export type TimeFrame = '1h' | '4h' | '24h' | '7d';

export interface AssetFlowData {
  symbol: string;
  name: string;
  netFlow: number;   // + = net taker buying, − = net taker selling (USDT)
  volume: number;    // total quote volume in the window
  change24h: number; // % change across the window
  whaleCount: number;// number of trades in the window
}

const TF_KLINES: Record<TimeFrame, { interval: string; limit: number }> = {
  '1h':  { interval: '1m',  limit: 60 },
  '4h':  { interval: '5m',  limit: 48 },
  '24h': { interval: '15m', limit: 96 },
  '7d':  { interval: '1h',  limit: 168 },
};

const POLL_MS = 15_000;
const MAX_SYMBOLS = 12;

type Kline = [number, string, string, string, string, string, number, string, number, string, string, string];

async function fetchOne(
  symbol: string,
  name: string,
  tf: TimeFrame,
  signal: AbortSignal,
): Promise<AssetFlowData | null> {
  const { interval, limit } = TF_KLINES[tf];
  const pair = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
  const res = await fetch(
    proxied(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`),
    { signal },
  );
  if (!res.ok) return null; // unsupported pair / upstream hiccup — drop it, never fake it
  const rows = (await res.json()) as Kline[];
  if (!Array.isArray(rows) || rows.length === 0) return null;

  let quoteVol = 0, takerBuy = 0, trades = 0;
  for (const k of rows) {
    quoteVol += parseFloat(k[7]) || 0;
    takerBuy += parseFloat(k[10]) || 0;
    trades   += Number(k[8]) || 0;
  }
  const open  = parseFloat(rows[0][1]) || 0;
  const close = parseFloat(rows[rows.length - 1][4]) || 0;

  return {
    symbol: symbol.replace(/USDT$/, ''),
    name,
    netFlow: takerBuy - (quoteVol - takerBuy),
    volume: quoteVol,
    change24h: open > 0 ? ((close - open) / open) * 100 : 0,
    whaleCount: trades,
  };
}

/** `assets` — symbols (BTC or BTCUSDT) with optional display names. */
export function useWhaleNetFlow(
  timeframe: TimeFrame,
  assets: { symbol: string; name?: string }[],
) {
  const [data, setData] = useState<AssetFlowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const key = assets.slice(0, MAX_SYMBOLS).map(a => a.symbol.toUpperCase()).join(',');
  const assetsRef = useRef(assets);
  assetsRef.current = assets;

  const load = useCallback(async (signal: AbortSignal) => {
    const list = assetsRef.current.slice(0, MAX_SYMBOLS);
    if (!list.length) { setData([]); setLoading(false); return; }
    try {
      const settled = await Promise.allSettled(
        list.map(a => fetchOne(a.symbol.toUpperCase(), a.name ?? a.symbol.toUpperCase(), timeframe, signal)),
      );
      if (signal.aborted) return;
      const rows = settled
        .filter((r): r is PromiseFulfilledResult<AssetFlowData | null> => r.status === 'fulfilled')
        .map(r => r.value)
        .filter((r): r is AssetFlowData => !!r)
        .sort((a, b) => Math.abs(b.netFlow) - Math.abs(a.netFlow));
      setData(rows);
      setError(rows.length ? null : 'No net-flow data available for the tracked assets');
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      setError((err as Error).message);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [timeframe]);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    load(ctrl.signal);
    const id = setInterval(() => load(ctrl.signal), POLL_MS);
    return () => { ctrl.abort(); clearInterval(id); };
  }, [load, key]);

  return { data, loading, error };
}
