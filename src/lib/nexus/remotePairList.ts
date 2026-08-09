/* ══ NEXUS — Remote Pair List ══════════════════════════════════════════════════
 *  Ported concept from freqtrade's plugins/pairlist/RemotePairList.py: pull
 *  a curated whitelist of symbols from an external JSON endpoint instead of
 *  hardcoding it, with a local cache + TTL so a flaky/offline remote never
 *  blocks the app. Useful for sharing one "approved symbols" list across
 *  multiple Whale Radar deployments without a redeploy, or for pointing at
 *  a team-curated feed (e.g. a private Gist/S3 JSON) rather than editing
 *  source.
 *
 *  Re-implemented from scratch in TS with the fetch/cache/fallback pattern
 *  — no freqtrade source copied. Expected remote JSON shape:
 *    { "pairs": ["BTCUSDT", "ETHUSDT", ...] }
 *  (freqtrade's own RemotePairList uses the same top-level "pairs" key,
 *  so an existing freqtrade-format remote pairlist JSON works unmodified.)
 * ═══════════════════════════════════════════════════════════════════════════ */

const CONFIG_KEY = "nexus_remote_pairlist_url_v1";
const CACHE_KEY = "nexus_remote_pairlist_cache_v1";
const DEFAULT_TTL_MINUTES = 60;

interface RemotePairListCache {
  url: string;
  pairs: string[];
  fetchedAt: number;
}

interface RemotePairListResponse {
  pairs?: string[];
  refresh_period?: number; // freqtrade's field name, seconds — honored if present
}

export function getRemotePairListUrl(): string | null {
  try {
    return localStorage.getItem(CONFIG_KEY);
  } catch {
    return null;
  }
}

export function setRemotePairListUrl(url: string | null): void {
  try {
    if (url) localStorage.setItem(CONFIG_KEY, url);
    else localStorage.removeItem(CONFIG_KEY);
  } catch (e) {
    console.error("[RemotePairList] failed to persist URL:", e);
  }
}

function loadCache(): RemotePairListCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as RemotePairListCache) : null;
  } catch {
    return null;
  }
}

function persistCache(cache: RemotePairListCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.error("[RemotePairList] failed to persist cache:", e);
  }
}

export interface RemotePairListResult {
  pairs: string[];
  source: "remote" | "cache" | "none";
  error?: string;
}

/**
 * Fetches the configured remote pairlist URL, validates the shape, caches
 * the result, and returns it. On any failure (no URL configured, network
 * error, bad shape), falls back to the last good cache rather than
 * returning an empty list and silently emptying the app's tracked pairs —
 * same "degrade gracefully" posture as safeInvoke.ts elsewhere in this app.
 */
export async function fetchRemotePairList(opts: {
  ttlMinutes?: number;
  forceRefresh?: boolean;
} = {}): Promise<RemotePairListResult> {
  const ttlMinutes = opts.ttlMinutes ?? DEFAULT_TTL_MINUTES;
  const url = getRemotePairListUrl();
  const cache = loadCache();

  if (!url) {
    return cache ? { pairs: cache.pairs, source: "cache" } : { pairs: [], source: "none" };
  }

  const cacheFresh =
    cache && cache.url === url && Date.now() - cache.fetchedAt < ttlMinutes * 60_000;
  if (cacheFresh && !opts.forceRefresh) {
    return { pairs: cache.pairs, source: "cache" };
  }

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 10_000);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: abort.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as RemotePairListResponse;
    if (!Array.isArray(data.pairs)) {
      throw new Error('Remote response missing a "pairs" array');
    }
    const pairs = data.pairs
      .filter((p): p is string => typeof p === "string" && p.length > 0)
      .map((p) => p.toUpperCase());

    persistCache({ url, pairs, fetchedAt: Date.now() });
    return { pairs, source: "remote" };
  } catch (e) {
    const error = (e as Error).message;
    if (cache && cache.url === url) {
      return { pairs: cache.pairs, source: "cache", error };
    }
    return { pairs: [], source: "none", error };
  } finally {
    clearTimeout(timer);
  }
}

export function clearRemotePairListCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // no-op
  }
}

/**
 * Synchronous, no-network read of whatever's currently cached for the
 * configured URL — for callers that can't await a fetch (e.g. a filter
 * chain evaluated per-coin, per-scan). Returns [] if no URL is configured
 * or nothing's been fetched yet; callers should treat an empty result as
 * "no whitelist configured", not "whitelist of nothing", so this only
 * makes sense combined with getRemotePairListUrl() — see
 * lib/pairFilters.ts's remoteWhitelistFilter for the actual gate.
 */
export function getCachedRemotePairList(): string[] {
  const url = getRemotePairListUrl();
  if (!url) return [];
  const cache = loadCache();
  return cache && cache.url === url ? cache.pairs : [];
}
