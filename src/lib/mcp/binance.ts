const BINANCE = "https://api.binance.com";

/** Normalize a user-supplied asset ("btc", "BTC/USDT", "BTCUSDT") to a Binance pair. */
export function toPair(symbol: string): string {
  const raw = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!raw) throw new Error("symbol is required");
  return /(USDT|USDC|BUSD|BTC|ETH)$/.test(raw) ? raw : `${raw}USDT`;
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
