/* ══ WHALE RADAR v9 — Rate-Limit Manager ═════════════════════════════════════
 *  Centralized rate-limit state for all external APIs.
 *  Tracks cooldown per-endpoint, exposes reactive getters, fires user toasts.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { toast } from 'sonner';

interface CooldownEntry {
  until: number;       // epoch ms when the cooldown expires
  source: string;      // human-readable API name
}

const cooldowns: Record<string, CooldownEntry> = {};
const listeners: Set<() => void> = new Set();

function notify() { listeners.forEach(fn => fn()); }

/** Subscribe to cooldown state changes. Returns unsubscribe fn. */
export function onRateLimitChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Register a rate-limit hit. Parses Retry-After header, shows toast,
 * sets cooldown timer.
 */
export function handleRateLimit(
  apiName: string,
  key: string,
  retryAfterHeader?: string | null
): void {
  // Parse Retry-After: seconds or HTTP-date
  let waitSec = 60; // sensible default
  if (retryAfterHeader) {
    const parsed = Number(retryAfterHeader);
    if (!isNaN(parsed) && parsed > 0) {
      waitSec = Math.ceil(parsed);
    } else {
      const date = Date.parse(retryAfterHeader);
      if (!isNaN(date)) {
        waitSec = Math.max(1, Math.ceil((date - Date.now()) / 1000));
      }
    }
  }

  const until = Date.now() + waitSec * 1000;
  cooldowns[key] = { until, source: apiName };

  toast.warning(`${apiName} rate limited`, {
    description: `Cooling down for ${waitSec}s. Requests will auto-resume.`,
    duration: Math.min(waitSec * 1000, 15000),
    id: `rl-${key}`, // deduplicate toasts for same API
  });

  console.warn(`[RateLimit] ${apiName} (${key}) — cooldown ${waitSec}s`);
  notify();
}

/** Check if a specific API key is currently in cooldown. */
export function isRateLimited(key: string): boolean {
  const entry = cooldowns[key];
  if (!entry) return false;
  if (Date.now() >= entry.until) {
    delete cooldowns[key];
    notify();
    return false;
  }
  return true;
}

/** Get remaining cooldown seconds for an API key, or 0. */
export function getCooldownRemaining(key: string): number {
  const entry = cooldowns[key];
  if (!entry) return 0;
  const rem = Math.ceil((entry.until - Date.now()) / 1000);
  if (rem <= 0) {
    delete cooldowns[key];
    notify();
    return 0;
  }
  return rem;
}

/** Get all active cooldowns with remaining seconds. */
export function getActiveCooldowns(): Array<{ key: string; source: string; remaining: number }> {
  const now = Date.now();
  const result: Array<{ key: string; source: string; remaining: number }> = [];
  for (const [key, entry] of Object.entries(cooldowns)) {
    const rem = Math.ceil((entry.until - now) / 1000);
    if (rem > 0) {
      result.push({ key, source: entry.source, remaining: rem });
    } else {
      delete cooldowns[key];
    }
  }
  return result;
}

// Well-known API keys
export const RL_KEYS = {
  COINGECKO:   'coingecko',
  CLAUDE:      'claude',
  BIRDEYE:     'birdeye',
  BACKEND:     'backend',
  DEXSCREENER: 'dexscreener',
  RUGCHECK:    'rugcheck',
} as const;
