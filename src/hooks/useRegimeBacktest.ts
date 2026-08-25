import { useCallback, useState } from 'react';
import { backtestHistory, type BacktestResult } from '@/lib/regime/backtest';
import type { RegimeSnapshot } from '@/lib/regime/types';

/** Deliberately on-demand, not automatic: a full backtest makes one Binance
 *  klines request per horizon per confirmed call, and re-running it on
 *  every 5-minute poll tick (like useRegimeEngine's own signals) would
 *  multiply that for no benefit — historical calls that already resolved
 *  don't change. The caller decides when a re-run is worth it (e.g. a
 *  button), typically after new calls have accumulated. */
export function useRegimeBacktest() {
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (history: RegimeSnapshot[]) => {
    setLoading(true);
    setError(null);
    try {
      setResult(await backtestHistory(history));
    } catch {
      setError('Backtest failed — try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  return { result, loading, error, run };
}
