/* ══ WHALE RADAR v9 — Performance Budget Enforcement ═════════════════════════
 *  Monitors LCP, TTI, and WS message processing budgets.
 *  Logs warnings to console when budgets are exceeded.
 * ═══════════════════════════════════════════════════════════════════════════ */

const BUDGETS = {
  LCP_MOBILE: 3500,       // ms
  TTI_MOBILE: 5000,       // ms
  WS_MSG_PROCESS: 50,     // ms per message
} as const;

let lcpObserver: PerformanceObserver | null = null;

/** Start monitoring LCP and long tasks. Call once on app mount. */
export function startPerfMonitoring(): () => void {
  const cleanups: (() => void)[] = [];

  // LCP monitoring
  if ('PerformanceObserver' in window) {
    try {
      lcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last && last.startTime > BUDGETS.LCP_MOBILE) {
          console.warn(
            `[PerfBudget] LCP ${Math.round(last.startTime)}ms exceeds ${BUDGETS.LCP_MOBILE}ms budget`
          );
        }
      });
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
      cleanups.push(() => lcpObserver?.disconnect());
    } catch { /* unsupported */ }

    // Long task monitoring (proxy for TTI)
    try {
      const longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > 100) {
            console.warn(
              `[PerfBudget] Long task: ${Math.round(entry.duration)}ms at ${Math.round(entry.startTime)}ms`
            );
          }
        }
      });
      longTaskObserver.observe({ type: 'longtask', buffered: true });
      cleanups.push(() => longTaskObserver.disconnect());
    } catch { /* unsupported */ }
  }

  return () => cleanups.forEach(fn => fn());
}

/**
 * Measure WebSocket message processing time.
 * Returns the result and logs if budget exceeded.
 */
export function measureWsProcessing<T>(label: string, fn: () => T): T {
  const start = performance.now();
  const result = fn();
  const elapsed = performance.now() - start;
  if (elapsed > BUDGETS.WS_MSG_PROCESS) {
    console.warn(
      `[PerfBudget] WS ${label}: ${elapsed.toFixed(1)}ms exceeds ${BUDGETS.WS_MSG_PROCESS}ms budget`
    );
  }
  return result;
}

export { BUDGETS };
