/* ══ NEXUS — Execution Circuit Breaker ═══════════════════════════════════════
 *  Blocks new order attempts when:
 *   - quoted slippage vs reference mid exceeds maxSlippagePct
 *   - upstream API latency (last N samples) exceeds maxLatencyMs
 *   - the breaker has been manually or auto-tripped and is still cooling down
 *
 *  Does not place or cancel exchange orders itself — callers abort before
 *  submit. Complements protections.ts (trade-history risk) with live
 *  execution-quality gates.
 * ═══════════════════════════════════════════════════════════════════════════ */

const CONFIG_KEY = "nexus_circuit_breaker_cfg_v1";
const STATE_KEY = "nexus_circuit_breaker_state_v1";
const LATENCY_SAMPLES = 12;

export interface CircuitBreakerConfig {
  enabled: boolean;
  /** Reject if |fillEstimate - mid| / mid exceeds this (e.g. 0.01 = 1%). */
  maxSlippagePct: number;
  /** Rolling max acceptable API/exchange latency in ms. */
  maxLatencyMs: number;
  /** How long the breaker stays open after a trip (minutes). */
  cooldownMinutes: number;
}

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  enabled: true,
  maxSlippagePct: 0.01,
  maxLatencyMs: 2500,
  cooldownMinutes: 5,
};

export interface CircuitBreakerState {
  openUntil: number;
  reason: string | null;
  trippedAt: number | null;
  latencySamples: number[];
}

export interface SlippageCheckInput {
  midPrice: number;
  estimatedFillPrice: number;
  pair?: string;
}

export interface CircuitCheckResult {
  allowed: boolean;
  reason?: string;
  slippagePct?: number;
  latencyMs?: number;
}

function loadConfig(): CircuitBreakerConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return DEFAULT_CIRCUIT_CONFIG;
    return { ...DEFAULT_CIRCUIT_CONFIG, ...(JSON.parse(raw) as Partial<CircuitBreakerConfig>) };
  } catch {
    return DEFAULT_CIRCUIT_CONFIG;
  }
}

function loadState(): CircuitBreakerState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return { openUntil: 0, reason: null, trippedAt: null, latencySamples: [] };
    return JSON.parse(raw) as CircuitBreakerState;
  } catch {
    return { openUntil: 0, reason: null, trippedAt: null, latencySamples: [] };
  }
}

function saveState(state: CircuitBreakerState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota */
  }
}

export function getCircuitBreakerConfig(): CircuitBreakerConfig {
  return loadConfig();
}

export function setCircuitBreakerConfig(cfg: CircuitBreakerConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  } catch (e) {
    console.error("[CircuitBreaker] persist config failed:", e);
  }
}

export function getCircuitBreakerState(): CircuitBreakerState {
  return loadState();
}

/** Record a measured round-trip latency sample (ms). */
export function recordApiLatency(ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  const state = loadState();
  const samples = [...state.latencySamples, ms].slice(-LATENCY_SAMPLES);
  saveState({ ...state, latencySamples: samples });

  const cfg = loadConfig();
  if (!cfg.enabled) return;
  const p95 = percentile(samples, 0.95);
  if (samples.length >= 5 && p95 > cfg.maxLatencyMs) {
    tripCircuitBreaker(
      `API latency spike: p95 ${Math.round(p95)}ms > ${cfg.maxLatencyMs}ms`,
      cfg.cooldownMinutes,
    );
  }
}

export function tripCircuitBreaker(reason: string, cooldownMinutes?: number): void {
  const cfg = loadConfig();
  const mins = cooldownMinutes ?? cfg.cooldownMinutes;
  const until = Date.now() + mins * 60_000;
  saveState({
    ...loadState(),
    openUntil: until,
    reason,
    trippedAt: Date.now(),
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("nexus:circuit:trip", { detail: { reason, until } }),
    );
  }
}

export function resetCircuitBreaker(): void {
  saveState({ openUntil: 0, reason: null, trippedAt: null, latencySamples: loadState().latencySamples });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("nexus:circuit:reset"));
  }
}

/**
 * Pre-trade gate: open breaker, latency ceiling, optional slippage vs mid.
 * Call before any real submit (after canTrade / capacity gates).
 */
export function checkCircuitBreaker(slippage?: SlippageCheckInput): CircuitCheckResult {
  const cfg = loadConfig();
  if (!cfg.enabled) return { allowed: true };

  const state = loadState();
  if (state.openUntil > Date.now()) {
    const secs = Math.ceil((state.openUntil - Date.now()) / 1000);
    return {
      allowed: false,
      reason: `Circuit open (${secs}s left): ${state.reason ?? "tripped"}`,
    };
  }

  if (state.latencySamples.length >= 5) {
    const p95 = percentile(state.latencySamples, 0.95);
    if (p95 > cfg.maxLatencyMs) {
      tripCircuitBreaker(
        `API latency spike: p95 ${Math.round(p95)}ms > ${cfg.maxLatencyMs}ms`,
        cfg.cooldownMinutes,
      );
      return {
        allowed: false,
        reason: `Blocked — latency p95 ${Math.round(p95)}ms exceeds ${cfg.maxLatencyMs}ms`,
        latencyMs: p95,
      };
    }
  }

  if (slippage) {
    const { midPrice, estimatedFillPrice } = slippage;
    if (midPrice > 0 && estimatedFillPrice > 0) {
      const slip = Math.abs(estimatedFillPrice - midPrice) / midPrice;
      if (slip > cfg.maxSlippagePct) {
        tripCircuitBreaker(
          `Slippage ${(slip * 100).toFixed(2)}% > ${(cfg.maxSlippagePct * 100).toFixed(2)}%` +
            (slippage.pair ? ` on ${slippage.pair}` : ""),
          cfg.cooldownMinutes,
        );
        return {
          allowed: false,
          reason: `Blocked — estimated slippage ${(slip * 100).toFixed(2)}% exceeds ${(cfg.maxSlippagePct * 100).toFixed(2)}%`,
          slippagePct: slip,
        };
      }
      return { allowed: true, slippagePct: slip };
    }
  }

  return { allowed: true };
}

/** Timed fetch helper — records latency into the breaker sample window. */
export async function fetchWithLatency(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const t0 = performance.now();
  try {
    const res = await fetch(input, init);
    recordApiLatency(performance.now() - t0);
    return res;
  } catch (err) {
    recordApiLatency(performance.now() - t0);
    throw err;
  }
}

function percentile(samples: number[], p: number): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}
