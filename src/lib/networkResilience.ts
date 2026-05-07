/* ══ WHALE RADAR v10 — NETWORK RESILIENCE ORCHESTRATOR ════════════════════════
 *  CEO-FIX: Top-level error recovery + retry coordination for 350+ coins
 * ═══════════════════════════════════════════════════════════════════════════ */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { toast } from 'sonner';

export type NetworkStatus = 'online' | 'degraded' | 'offline' | 'recovering';

interface ResilienceConfig {
  maxConcurrency?: number;
  batchSize?: number;
  retryAttempts?: number;
  degradedThreshold?: number;
}

const DEFAULT_CONFIG: Required<ResilienceConfig> = {
  maxConcurrency: 6,
  batchSize: 10,
  retryAttempts: 3,
  degradedThreshold: 0.3,
};

export function useNetworkResilience(config: ResilienceConfig = {}) {
  const cfg = useMemo(
    () => ({ ...DEFAULT_CONFIG, ...config }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.maxConcurrency, config.batchSize, config.retryAttempts, config.degradedThreshold],
  );
  const [status, setStatus] = useState<NetworkStatus>('online');
  const [failureRate, setFailureRate] = useState(0);
  const requestLog = useRef<{ success: boolean; ts: number }[]>([]);
  const activeRequests = useRef(0);
  const degradedMode = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 60_000;
      requestLog.current = requestLog.current.filter(r => r.ts > cutoff);
      const total = requestLog.current.length;
      const failed = requestLog.current.filter(r => !r.success).length;
      const rate = total > 0 ? failed / total : 0;
      setFailureRate(rate);
      if (rate > cfg.degradedThreshold && !degradedMode.current) {
        degradedMode.current = true;
        setStatus('degraded');
        toast.warning('Network degraded — switching to cached-only mode', { duration: 5000 });
      } else if (rate < 0.1 && degradedMode.current) {
        degradedMode.current = false;
        setStatus('recovering');
        toast.success('Network recovered — resuming live data', { duration: 3000 });
        setTimeout(() => setStatus('online'), 2000);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [cfg.degradedThreshold]);

  const fetchWithResilience = useCallback(async <T,>(
    requests: (() => Promise<T>)[]
  ): Promise<{ results: (T | null)[]; errors: (Error | null)[]; fromCache: boolean[] }> => {
    const results: (T | null)[] = [];
    const errors: (Error | null)[] = [];
    const fromCache: boolean[] = [];

    for (let i = 0; i < requests.length; i += cfg.batchSize) {
      const batch = requests.slice(i, i + cfg.batchSize);
      while (activeRequests.current >= cfg.maxConcurrency) {
        await new Promise(r => setTimeout(r, 100));
      }

      const batchPromises = batch.map(async (req, idx) => {
        activeRequests.current++;
        let attempts = 0;
        while (attempts < cfg.retryAttempts) {
          try {
            const result = await req();
            requestLog.current.push({ success: true, ts: Date.now() });
            activeRequests.current--;
            return { result, error: null, fromCache: false, idx: i + idx };
          } catch (err) {
            attempts++;
            if (attempts >= cfg.retryAttempts) {
              requestLog.current.push({ success: false, ts: Date.now() });
              activeRequests.current--;
              return { result: null, error: err as Error, fromCache: false, idx: i + idx };
            }
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempts)));
          }
        }
        return { result: null, error: new Error('Max retries'), fromCache: false, idx: i + idx };
      });

      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(br => {
        results[br.idx] = br.result as T;
        errors[br.idx] = br.error;
        fromCache[br.idx] = br.fromCache;
      });

      if (i + cfg.batchSize < requests.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
    return { results, errors, fromCache };
  }, [cfg]);

  const isDegraded = useCallback(() => degradedMode.current, []);
  return { status, failureRate, fetchWithResilience, isDegraded };
}
