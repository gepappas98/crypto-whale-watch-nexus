/* ══ WHALE RADAR v9 — Cached Fetch with Rate-Limit + Stale-While-Revalidate ══
 *  sessionStorage-backed cache for API responses.
 *  Handles 429s, auto-retry with exponential backoff + jitter, and SWR pattern.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { toast } from 'sonner';
import { handleRateLimit, isRateLimited } from './rateLimit';

interface CacheEntry {
  data: unknown;
  ts: number;
}

const DEFAULT_CACHE_TTL = 10_000;   // 10s
const SWR_TTL = 30_000;            // 30s stale-while-revalidate
const MAX_RETRIES = 3;
const BASE_DELAY = 1000;

function jitter(ms: number): number {
  return ms * (0.8 + Math.random() * 0.4); // ±20%
}

function cacheKey(url: string): string {
  return 'wr_cache_' + url.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 120);
}

function readCache(url: string): CacheEntry | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(url));
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry;
  } catch { return null; }
}

function writeCache(url: string, data: unknown): void {
  try {
    sessionStorage.setItem(cacheKey(url), JSON.stringify({ data, ts: Date.now() }));
  } catch { /* quota exceeded — ignore */ }
}

export interface CachedFetchOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  cacheTtl?: number;       // ms, default 10s
  swrTtl?: number;         // ms, default 30s (stale-while-revalidate window)
  rateLimitKey?: string;    // key for rate-limit tracking
  rateLimitName?: string;   // display name for toast
  silent?: boolean;
}

/**
 * Fetch with sessionStorage caching, 429 handling, and auto-retry.
 * Implements stale-while-revalidate: returns cached data immediately if within
 * swrTtl, and revalidates in background.
 */
export async function cachedFetch<T = unknown>(
  url: string,
  opts: CachedFetchOptions = {}
): Promise<{ data: T | null; fromCache: boolean; error?: string }> {
  const {
    headers = {},
    signal,
    cacheTtl = DEFAULT_CACHE_TTL,
    swrTtl = SWR_TTL,
    rateLimitKey,
    rateLimitName,
    silent = false,
  } = opts;

  // Check rate-limit before making request
  if (rateLimitKey && isRateLimited(rateLimitKey)) {
    const cached = readCache(url);
    if (cached) {
      if (!silent) {
        toast.info('Rate limited — using cached data', {
          duration: 2000,
          id: `rl-cache-${rateLimitKey}`,
        });
      }
      return { data: cached.data as T, fromCache: true };
    }
    return { data: null, fromCache: false, error: 'Rate limited, no cache available' };
  }

  // Check fresh cache
  const cached = readCache(url);
  if (cached) {
    const age = Date.now() - cached.ts;
    if (age < cacheTtl) {
      return { data: cached.data as T, fromCache: true };
    }
    // Stale-while-revalidate: return stale data, revalidate in background
    if (age < swrTtl) {
      // Fire-and-forget background revalidation
      doFetch(url, headers, signal, rateLimitKey, rateLimitName).then(result => {
        if (result.data) writeCache(url, result.data);
      }).catch(() => {});
      return { data: cached.data as T, fromCache: true };
    }
  }

  // No cache or expired — fetch with retry
  const result = await doFetch<T>(url, headers, signal, rateLimitKey, rateLimitName);

  if (result.data) {
    writeCache(url, result.data);
  } else if (cached && !silent) {
    // Fetch failed but we have stale cache — use it
    toast.info('API error — using cached data', { duration: 3000, id: 'fetch-fallback' });
    return { data: cached.data as T, fromCache: true };
  }

  return result;
}

async function doFetch<T>(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
  rateLimitKey?: string,
  rateLimitName?: string,
): Promise<{ data: T | null; fromCache: false; error?: string }> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers, signal });

      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After');
        if (rateLimitKey && rateLimitName) {
          handleRateLimit(rateLimitName, rateLimitKey, retryAfter);
        }
        toast.warning('Rate limit hit – using cached data for 10s', {
          duration: 5000,
          id: `rl-toast-${rateLimitKey || 'api'}`,
        });
        return { data: null, fromCache: false, error: 'Rate limited (429)' };
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as T;
      return { data, fromCache: false };
    } catch (err) {
      if (attempt < MAX_RETRIES - 1) {
        const delay = jitter(BASE_DELAY * Math.pow(2, attempt));
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return {
        data: null,
        fromCache: false,
        error: (err as Error).message,
      };
    }
  }
  return { data: null, fromCache: false, error: 'Max retries exceeded' };
}

/**
 * Edge cache helper for leaderboard-style endpoints.
 * Wraps cachedFetch with 30s cache + SWR pattern.
 */
export async function cachedLeaderboardFetch<T = unknown>(
  url: string,
  opts: Omit<CachedFetchOptions, 'cacheTtl' | 'swrTtl'> = {}
): Promise<{ data: T | null; fromCache: boolean }> {
  return cachedFetch<T>(url, {
    ...opts,
    cacheTtl: 30_000,   // 30s fresh
    swrTtl: 60_000,     // 60s stale-while-revalidate
  });
}
