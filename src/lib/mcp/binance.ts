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
