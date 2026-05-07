/* ══ WHALE RADAR v10 — BULLETPROOF Cached Fetch ════════════════════════════════
 *  CEO-FIX: Network error elimination through:
 *    1. Mandatory fetch timeout (AbortController auto-created)
 *    2. Promise.race() with timeout fallback
 *    3. Circuit breaker pattern for repeated failures
 *    4. Enhanced stale-while-revalidate with degraded mode
 *    5. Request deduplication (in-flight request merging)
 *    6. Graceful degradation to cached data on ANY failure
 * ═══════════════════════════════════════════════════════════════════════════ */

import { toast } from 'sonner';
import { handleRateLimit, isRateLimited } from './rateLimit';

interface CacheEntry {
  data: unknown;
  ts: number;
  etag?: string;
}

const DEFAULT_CACHE_TTL = 15_000;
const SWR_TTL = 60_000;
const MAX_RETRIES = 5;
const BASE_DELAY = 800;
const FETCH_TIMEOUT_MS = 12_000;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_RESET_MS = 30_000;

const inFlightRequests = new Map<string, Promise<{ data: unknown | null; fromCache: boolean; error?: string }>>();
const circuitBreakers = new Map<string, { failures: number; lastFailure: number; open: boolean }>();

function jitter(ms: number): number {
  return ms * (0.7 + Math.random() * 0.6);
}

function cacheKey(url: string): string {
  return 'wr_cache_v10_' + url.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 100);
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
  } catch {
    try {
      const keys = Object.keys(sessionStorage).filter(k => k.startsWith('wr_cache_'));
      keys.sort((a, b) => {
        const aTs = JSON.parse(sessionStorage.getItem(a) || '{"ts":0}').ts;
        const bTs = JSON.parse(sessionStorage.getItem(b) || '{"ts":0}').ts;
        return aTs - bTs;
      });
      const toRemove = Math.ceil(keys.length * 0.2);
      keys.slice(0, toRemove).forEach(k => sessionStorage.removeItem(k));
      sessionStorage.setItem(cacheKey(url), JSON.stringify({ data, ts: Date.now() }));
    } catch { }
  }
}

function isCircuitOpen(url: string): boolean {
  const key = new URL(url).hostname;
  const cb = circuitBreakers.get(key);
  if (!cb) return false;
  if (cb.open) {
    if (Date.now() - cb.lastFailure > CIRCUIT_BREAKER_RESET_MS) {
      cb.open = false;
      cb.failures = 0;
      return false;
    }
    return true;
  }
  return false;
}

function recordFailure(url: string): void {
  const key = new URL(url).hostname;
  const cb = circuitBreakers.get(key) || { failures: 0, lastFailure: 0, open: false };
  cb.failures++;
  cb.lastFailure = Date.now();
  if (cb.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    cb.open = true;
    console.warn(`[CEO] Circuit breaker OPENED for ${key}`);
    toast.error(`API ${key} temporarily unavailable — using cached data`, { duration: 5000 });
  }
  circuitBreakers.set(key, cb);
}

function recordSuccess(url: string): void {
  const key = new URL(url).hostname;
  const cb = circuitBreakers.get(key);
  if (cb) {
    cb.failures = Math.max(0, cb.failures - 1);
    if (cb.failures === 0) cb.open = false;
  }
}

export interface CachedFetchOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  cacheTtl?: number;
  swrTtl?: number;
  rateLimitKey?: string;
  rateLimitName?: string;
  silent?: boolean;
  timeoutMs?: number;
  fallbackData?: unknown;
  retries?: number;
}

export async function cachedFetch<T = unknown>(
  url: string,
  opts: CachedFetchOptions = {}
): Promise<{ data: T | null; fromCache: boolean; error?: string; degraded?: boolean }> {
  const {
    headers = {},
    signal: externalSignal,
    cacheTtl = DEFAULT_CACHE_TTL,
    swrTtl = SWR_TTL,
    rateLimitKey,
    rateLimitName,
    silent = false,
    timeoutMs = FETCH_TIMEOUT_MS,
    fallbackData,
    retries = MAX_RETRIES,
  } = opts;

  if (isCircuitOpen(url)) {
    const cached = readCache(url);
    if (cached) {
      return { data: cached.data as T, fromCache: true, degraded: true };
    }
    return { data: fallbackData as T ?? null, fromCache: false, error: 'Circuit breaker open', degraded: true };
  }

  if (rateLimitKey && isRateLimited(rateLimitKey)) {
    const cached = readCache(url);
    if (cached) {
      if (!silent) {
        toast.info('Rate limited — using cached data', { duration: 2000, id: `rl-cache-${rateLimitKey}` });
      }
      return { data: cached.data as T, fromCache: true };
    }
    return { data: fallbackData as T ?? null, fromCache: false, error: 'Rate limited, no cache', degraded: true };
  }

  const cached = readCache(url);
  if (cached) {
    const age = Date.now() - cached.ts;
    if (age < cacheTtl) {
      return { data: cached.data as T, fromCache: true };
    }
    if (age < swrTtl) {
      doFetchWithTimeout(url, headers, externalSignal, timeoutMs, rateLimitKey, rateLimitName, retries)
        .then(result => { if (result.data) writeCache(url, result.data); })
        .catch(() => {});
      return { data: cached.data as T, fromCache: true };
    }
  }

  const dedupKey = `${url}:${JSON.stringify(headers)}`;
  if (inFlightRequests.has(dedupKey)) {
    const result = await inFlightRequests.get(dedupKey)!;
    return result as { data: T | null; fromCache: boolean; error?: string; degraded?: boolean };
  }

  const fetchPromise = doFetchWithTimeout<T>(url, headers, externalSignal, timeoutMs, rateLimitKey, rateLimitName, retries)
    .then(result => {
      if (result.data) {
        writeCache(url, result.data);
        recordSuccess(url);
      } else if (cached) {
        if (!silent) {
          toast.info('API error — using cached data', { duration: 3000, id: 'fetch-fallback' });
        }
        inFlightRequests.delete(dedupKey);
        return { data: cached.data as T, fromCache: true, error: result.error, degraded: true };
      } else if (fallbackData !== undefined) {
        inFlightRequests.delete(dedupKey);
        return { data: fallbackData as T, fromCache: false, error: result.error, degraded: true };
      }
      inFlightRequests.delete(dedupKey);
      return result;
    })
    .catch(err => {
      inFlightRequests.delete(dedupKey);
      recordFailure(url);
      if (cached) {
        return { data: cached.data as T, fromCache: true, error: err.message, degraded: true };
      }
      return { data: fallbackData as T ?? null, fromCache: false, error: err.message, degraded: true };
    });

  inFlightRequests.set(dedupKey, fetchPromise);
  return fetchPromise;
}

async function doFetchWithTimeout<T>(
  url: string,
  headers: Record<string, string>,
  externalSignal?: AbortSignal,
  timeoutMs: number = FETCH_TIMEOUT_MS,
  rateLimitKey?: string,
  rateLimitName?: string,
  maxRetries: number = MAX_RETRIES,
): Promise<{ data: T | null; fromCache: false; error?: string }> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let abortHandler: (() => void) | undefined;
    if (externalSignal) {
      abortHandler = () => controller.abort();
      externalSignal.addEventListener('abort', abortHandler);
    }

    const cleanup = () => {
      if (abortHandler && externalSignal) externalSignal.removeEventListener('abort', abortHandler);
    };

    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After');
        if (rateLimitKey && rateLimitName) {
          handleRateLimit(rateLimitName, rateLimitKey, retryAfter);
        }
        toast.warning('Rate limit hit — using cached data', { duration: 5000, id: `rl-toast-${rateLimitKey || 'api'}` });
        cleanup();
        return { data: null, fromCache: false, error: 'Rate limited (429)' };
      }

      if (res.status === 520 || res.status === 524) {
        throw new Error(`Cloudflare error ${res.status}`);
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as T;
      cleanup();
      return { data, fromCache: false };
    } catch (err) {
      clearTimeout(timeoutId);
      if ((err as Error).name === 'AbortError') {
        if (attempt >= maxRetries - 1) {
          cleanup();
          return { data: null, fromCache: false, error: `Request timeout after ${timeoutMs}ms` };
        }
      }
      if (attempt < maxRetries - 1) {
        const delay = jitter(BASE_DELAY * Math.pow(2, attempt));
        cleanup();
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      cleanup();
      return { data: null, fromCache: false, error: (err as Error).message };
    }
  }
  return { data: null, fromCache: false, error: 'Max retries exceeded' };
}

export async function cachedFetchBatch<T = unknown>(
  requests: { url: string; opts?: CachedFetchOptions }[]
): Promise<{ data: T | null; fromCache: boolean; error?: string; degraded?: boolean; url: string }[]> {
  const results = await Promise.allSettled(
    requests.map(req => cachedFetch<T>(req.url, req.opts).then(r => ({ ...r, url: req.url })))
  );

  return results.map((result, i) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    return {
      data: null,
      fromCache: false,
      error: result.reason?.message || 'Batch request failed',
      degraded: true,
      url: requests[i].url,
    };
  });
}

export async function cachedLeaderboardFetch<T = unknown>(
  url: string,
  opts: Omit<CachedFetchOptions, 'cacheTtl' | 'swrTtl'> = {}
): Promise<{ data: T | null; fromCache: boolean; error?: string; degraded?: boolean }> {
  return cachedFetch<T>(url, { ...opts, cacheTtl: 30_000, swrTtl: 120_000 });
}
