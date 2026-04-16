/* ══ useKronos — React hook for Crystal Ball PRO ════════════════════════════ */

import { useState, useCallback, useRef } from 'react';
import { fetchForecast, ForecastRequest, ForecastResponse } from '@/api/kronosClient';

interface KronosState {
  data:      ForecastResponse | null;
  loading:   boolean;
  error:     string | null;
  lastFetch: Date | null;
}

export function useKronos() {
  const [state, setState] = useState<KronosState>({
    data: null, loading: false, error: null, lastFetch: null,
  });

  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (req: ForecastRequest) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setState(s => ({ ...s, loading: true, error: null }));

    try {
      const data = await fetchForecast(req);
      setState({ data, loading: false, error: null, lastFetch: new Date() });
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        setState(s => ({ ...s, loading: false, error: (e as Error).message }));
      }
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState({ data: null, loading: false, error: null, lastFetch: null });
  }, []);

  return { ...state, run, reset };
}
