import { useCallback, useEffect, useRef, useState } from 'react';
import { collectSignals, type LocalInputs } from '@/lib/regime/signals';
import { evaluate, getHistory } from '@/lib/regime/engine';
import { loadWeights, saveWeights, resetWeights } from '@/lib/regime/weights';
import type { RegimeReading, RegimeSnapshot, RegimeWeights } from '@/lib/regime/types';

const POLL_MS = 5 * 60_000; // one tick per 5 minutes — the shortest persistence horizon

export function useRegimeEngine(local: LocalInputs, enabled = true) {
  const [reading, setReading] = useState<RegimeReading | null>(null);
  const [history, setHistory] = useState<RegimeSnapshot[]>(() => getHistory());
  const [weights, setWeightsState] = useState<RegimeWeights>(() => loadWeights());
  const [loading, setLoading] = useState(false);

  // Latest local inputs without re-triggering the poll loop on every tick of
  // the whale feed (it updates several times per second).
  const localRef = useRef(local);
  localRef.current = local;
  const weightsRef = useRef(weights);
  weightsRef.current = weights;
  const runningRef = useRef(false);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setLoading(true);
    try {
      const signals = await collectSignals(localRef.current);
      setReading(evaluate(signals, weightsRef.current));
      setHistory(getHistory());
    } finally {
      runningRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const tick = () => {
      if (!cancelled) void run();
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, run]);

  /** Weight changes rescore the current signals immediately — no refetch, so
   *  tuning stays interactive and doesn't hammer upstream APIs. */
  const setWeights = useCallback((next: RegimeWeights) => {
    setWeightsState(next);
    saveWeights(next);
    weightsRef.current = next;
    setReading((prev) => (prev ? evaluate(prev.signals, next) : prev));
  }, []);

  const restoreDefaults = useCallback(() => {
    const defaults = resetWeights();
    setWeights(defaults);
  }, [setWeights]);

  return { reading, history, weights, setWeights, restoreDefaults, loading, refresh: run };
}
