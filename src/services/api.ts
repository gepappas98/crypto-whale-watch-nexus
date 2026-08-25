/* ══ API service — cancellable, deduplicated market data fetchers ═══════════
 * All fetches use fetchWithControl (manual AbortController, in-flight dedup,
 * exponential backoff, structured error logging). Cancellation flows through
 * the caller's signal so React effects unmounting will tear down in-flight
 * requests deterministically.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { cachedFetch, fetchWithControl } from '@/lib/cachedFetch';
import { isRateLimited, getCooldownRemaining, RL_KEYS } from '@/lib/rateLimit';

export type ScanSource = 'live' | 'cached' | 'fallback';

export interface ScanResult {
  data: unknown[];
  source: ScanSource;
}

export interface ScanError {
  kind: 'rate_limited' | 'no_data' | 'network';
  message: string;
  cooldownSec?: number;
}

/**
 * Run a market scan. Tries the optional self-hosted /api/scan proxy first
 * (cancellable, 20s timeout), then falls back to CoinGecko via cachedFetch.
 *
 * @returns ScanResult on success, ScanError on failure (never throws for
 *   expected failure modes — caller handles the union).
 */
export async function runScan({
  apiKey,
  signal,
}: {
  apiKey: string;
  signal?: AbortSignal;
}): Promise<ScanResult | ScanError> {
  const isCgDemoKey = apiKey && apiKey.startsWith('CG-');
  const isCgProKey  = apiKey && !apiKey.startsWith('CG-');

  // 1. Try self-hosted backend proxy (may not be deployed — silent on connection error)
  try {
    const proxyHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) proxyHeaders['x-cg-api-key'] = apiKey;
    const proxyRes = await fetchWithControl('/api/scan', {
      headers: proxyHeaders,
      signal,
      timeoutMs: 20_000,
      retries: 1, // backend proxy is local; one retry is enough
      dedupKey: `GET:/api/scan`,
    });
    if (proxyRes.ok) {
      const result = await proxyRes.json();
      if (result.success && Array.isArray(result.data) && result.data.length) {
        return { data: result.data, source: (result.source as ScanSource) || 'live' };
      }
    }
  } catch (err) {
    // Backend unavailable is expected in cloud-only deployments — log without alarm.
    if ((err as Error)?.name !== 'AbortError') {
      console.info('[api.runScan] proxy unavailable, falling back to CG', { error: (err as Error).message });
    }
  }

  // 2. Direct CoinGecko fallback
  if (isRateLimited(RL_KEYS.COINGECKO)) {
    return {
      kind: 'rate_limited',
      message: 'CoinGecko rate-limited',
      cooldownSec: getCooldownRemaining(RL_KEYS.COINGECKO),
    };
  }

  const cgBase = isCgProKey
    ? 'https://pro-api.coingecko.com/api/v3'
    : 'https://api.coingecko.com/api/v3';
  // include_platform=true adds a `platforms` object (chain slug -> contract
  // address) to every coin at zero extra request cost — this is what feeds
  // CoinData.platforms, which the Insider Risk Scanner's real-data path
  // needs to ever have a contract address to look up (see useMarketData.ts
  // processData() and insiderRiskApi.ts's InsiderRiskCoin note).
  const cgUrl = `${cgBase}/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h&include_platform=true`;
  const cgHeaders: Record<string, string> = {};
  if (isCgProKey)  cgHeaders['x-cg-pro-api-key']  = apiKey;
  if (isCgDemoKey) cgHeaders['x-cg-demo-api-key'] = apiKey;

  const result = await cachedFetch<unknown[]>(cgUrl, {
    headers: cgHeaders,
    signal,
    cacheTtl: 10_000,
    swrTtl: 30_000,
    rateLimitKey: RL_KEYS.COINGECKO,
    rateLimitName: 'CoinGecko',
  });

  if (result.data?.length) {
    return { data: result.data, source: result.fromCache ? 'cached' : 'live' };
  }
  return {
    kind: result.error ? 'network' : 'no_data',
    message: result.error ?? 'No data from any source',
  };
}

export function isScanError(r: ScanResult | ScanError): r is ScanError {
  return (r as ScanError).kind !== undefined;
}
