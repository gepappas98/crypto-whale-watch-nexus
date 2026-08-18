const BINANCE = "https://api.binance.com";

/** Normalize a user-supplied asset ("btc", "BTC/USDT", "BTCUSDT") to a Binance pair.
 *  BUG FIXED: the old check was `/(USDT|USDC|BUSD|BTC|ETH)$/.test(raw)`,
 *  which matched "BTC" and "ETH" against THEMSELVES (the whole string is
 *  the suffix) — so a bare "BTC" or "ETH" query was passed straight to
 *  Binance as symbol=BTC / symbol=ETH instead of being suffixed to
 *  BTCUSDT / ETHUSDT. Binance has no such pair, so every tool that
 *  resolves a symbol through here (get_market_snapshot, get_whale_trades,
 *  get_orderbook_pressure, get_price_history, get_trade_flow,
 *  get_technical_indicators, get_funding_and_open_interest) would fail on
 *  the two most commonly requested assets.
 *  Fix requires a non-empty base-asset prefix before the quote suffix, so
 *  it only treats the input as "already a full pair" when there's an
 *  actual base asset in front of the quote currency (BTCUSDT, ETHBTC,
 *  SOLBTC all still pass through unchanged) — a bare BTC/ETH/USDT with
 *  nothing in front no longer matches and correctly gets USDT appended. */
export function toPair(symbol: string): string {
  const raw = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!raw) throw new Error("symbol is required");
  const quoted = raw.match(/^(.+)(USDT|USDC|BUSD|BTC|ETH|BNB)$/);
  return quoted ? raw : `${raw}USDT`;
}

export async function binanceGet<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const url = new URL(`${BINANCE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url.toString(), {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Binance ${path} failed (${res.status}) — the pair may not be listed`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

const BINANCE_FUTURES = "https://fapi.binance.com";

export async function binanceFuturesGet<T>(
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const url = new URL(`${BINANCE_FUTURES}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url.toString(), {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Binance futures ${path} failed (${res.status}) — the perpetual may not be listed`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Small JSON fetch helper with a timeout, for the other public APIs the tools use. */
export async function jsonFetch<T>(url: string, init?: RequestInit, timeoutMs = 10_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { accept: "application/json", ...(init?.headers ?? {}) },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Request to ${new URL(url).host} failed (${res.status})`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Tiny in-memory cache for the MCP tools' heaviest upstream calls — the
 *  full Binance 24hr ticker dataset (used by both get_top_movers and
 *  search_assets) and Hyperliquid's full market metadata. This is the
 *  real fix for "a public MCP endpoint can generate upstream API load":
 *  it bounds how often the actual expensive request goes out regardless
 *  of how many MCP calls arrive, which is the concrete harm a full-ticker
 *  fetch on every call risks.
 *
 *  What this ISN'T: per-client rate limiting. `defineTool`'s handler only
 *  receives the tool's structured input arguments — no request object, no
 *  caller IP, no headers — so there's no caller identity available at
 *  this layer to throttle against. A determined single caller could still
 *  make many calls; this cache just makes each one after the first free
 *  (a cache hit, no upstream request) rather than making it slow AND
 *  expensive. Real per-client throttling would need to sit in front of
 *  this Supabase Edge Function (an API gateway / reverse proxy), not
 *  inside a tool handler.
 *
 *  Scoped to one warm Edge Function instance, not shared/distributed —
 *  same limitation as trading-bridge/index.ts's redditToken cache. Resets
 *  whenever a cold instance spins up; that's fine here since the point is
 *  smoothing bursts within a short window, not long-term storage. */
const cache = new Map<string, { data: unknown; expiresAt: number }>();

export async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.data as T;
  const data = await fetcher();
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  if (cache.size > 100) {
    for (const k of [...cache.keys()].slice(0, 50)) cache.delete(k);
  }
  return data;
}
