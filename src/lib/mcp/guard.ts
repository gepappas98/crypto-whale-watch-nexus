/**
 * Abuse guard for the public, unauthenticated MCP tools.
 *
 * The tools are read-only, but they proxy upstream public APIs (Binance,
 * Hyperliquid, CoinGecko, alternative.me). Without protection a single caller
 * can loop tool calls and burn the shared upstream rate budget for everyone.
 *
 * Three layers, all in-memory and per server instance:
 *  1. Token bucket  — caps sustained outbound requests per second.
 *  2. Concurrency   — caps simultaneous in-flight upstream requests.
 *  3. Cache + dedupe — identical URLs share one response for a short TTL.
 */

const MAX_CONCURRENT = 8;
const REFILL_PER_SEC = 12;
const BUCKET_CAPACITY = 24;
const MAX_WAIT_MS = 8_000;
const MAX_CACHE_ENTRIES = 300;

let tokens = BUCKET_CAPACITY;
let lastRefill = Date.now();
let inFlight = 0;

function refill() {
  const now = Date.now();
  const elapsed = (now - lastRefill) / 1000;
  if (elapsed <= 0) return;
  tokens = Math.min(BUCKET_CAPACITY, tokens + elapsed * REFILL_PER_SEC);
  lastRefill = now;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait for a rate-limit token and a concurrency slot, then run `fn`. */
export async function withBudget<T>(fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + MAX_WAIT_MS;
  for (;;) {
    refill();
    if (tokens >= 1 && inFlight < MAX_CONCURRENT) break;
    if (Date.now() > deadline) {
      throw new Error("Upstream market data is rate limited right now — retry in a few seconds");
    }
    await sleep(80);
  }
  tokens -= 1;
  inFlight += 1;
  try {
    return await fn();
  } finally {
    inFlight -= 1;
  }
}

type Entry = { expires: number; value: Promise<unknown> };
const cache = new Map<string, Entry>();

function prune() {
  const now = Date.now();
  for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Share one in-flight/recent response per key. Collapses duplicate concurrent
 * calls and serves repeats from memory for `ttlMs`.
 */
export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;

  const value = fn().catch((err) => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, { expires: Date.now() + ttlMs, value });
  prune();
  return value;
}
