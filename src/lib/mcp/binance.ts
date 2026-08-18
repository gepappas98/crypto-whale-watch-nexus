import { cached, withBudget } from "./guard";

export { cached } from "./guard";

const BINANCE = "https://api.binance.com";

/** Default cache TTL for upstream market reads (ms). */
const DEFAULT_TTL = 5_000;

/**
 * Normalize a user-supplied asset ("btc", "BTC/USDT", "BTCUSDT") to a Binance pair.
 * Only stablecoin quotes (USDT/USDC/BUSD) are treated as already-paired.
 * BTC and ETH are base assets, so "BTC" becomes "BTCUSDT", not "BTC".
 */
export function toPair(symbol: string): string {
  const raw = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!raw) throw new Error("symbol is required");
  return /(USDT|USDC|BUSD)$/.test(raw) ? raw : `${raw}USDT`;
}

async function fetchJson<T>(url: string, label: string, init?: RequestInit, timeoutMs = 10_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { accept: "application/json", ...(init?.headers ?? {}) },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(label.replace("{status}", String(res.status)));
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function buildUrl(base: string, path: string, params: Record<string, string | number>): string {
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url.toString();
}

export async function binanceGet<T>(
  path: string,
  params: Record<string, string | number>,
  ttlMs = DEFAULT_TTL,
): Promise<T> {
  const url = buildUrl(BINANCE, path, params);
  return cached(url, ttlMs, () =>
    withBudget(() =>
      fetchJson<T>(url, `Binance ${path} failed ({status}) — the pair may not be listed`),
    ),
  );
}

const BINANCE_FUTURES = "https://fapi.binance.com";

export async function binanceFuturesGet<T>(
  path: string,
  params: Record<string, string | number> = {},
  ttlMs = DEFAULT_TTL,
): Promise<T> {
  const url = buildUrl(BINANCE_FUTURES, path, params);
  return cached(url, ttlMs, () =>
    withBudget(() =>
      fetchJson<T>(url, `Binance futures ${path} failed ({status}) — the perpetual may not be listed`),
    ),
  );
}

/** Small JSON fetch helper with a timeout, for the other public APIs the tools use. */
export async function jsonFetch<T>(
  url: string,
  init?: RequestInit,
  timeoutMs = 10_000,
  ttlMs = DEFAULT_TTL,
): Promise<T> {
  const host = new URL(url).host;
  const key = `${init?.method ?? "GET"} ${url} ${typeof init?.body === "string" ? init.body : ""}`;
  return cached(key, ttlMs, () =>
    withBudget(() => fetchJson<T>(url, `Request to ${host} failed ({status})`, init, timeoutMs)),
  );
}
