/* ══ NEXUS — Browser-side Exchange Aggregator ════════════════════════════════
 *  Real data only. No mocks. Direct calls to public exchange APIs.
 *  Keeps a small in-memory cache to throttle burst traffic.
 *  All three endpoints are CORS-enabled (verified: api.hyperliquid.xyz,
 *  api.backpack.exchange, data-api.binance.vision).
 * ═══════════════════════════════════════════════════════════════════════════ */

export type Exchange = "hyperliquid" | "backpack" | "binance";

export interface HLAsset {
  symbol: string;
  exchange: "hyperliquid";
  markPrice: number;
  midPrice: number;
  oraclePrice: number;
  fundingRate: number;
  openInterest: number;
  dayVolume: number;
  premium: number;
  prevDayPrice: number;
  impactBid: number;
  impactAsk: number;
  maxLeverage: number;
  timestamp: number;
}

export interface BPTicker {
  symbol: string;
  exchange: "backpack";
  lastPrice: number;
  high24h: number;
  low24h: number;
  volume: number;
  quoteVolume: number;
  priceChangePercent: number;
  timestamp: number;
}

export interface BNTicker {
  symbol: string;
  exchange: "binance";
  lastPrice: number;
  high24h: number;
  low24h: number;
  volume: number;
  quoteVolume: number;
  priceChangePercent: number;
  timestamp: number;
}

export interface AggregateMarket {
  hyperliquid: HLAsset[];
  backpack: BPTicker[];
  binance: BNTicker[];
  timestamp: number;
  errors: Partial<Record<Exchange, string>>;
}

// ── Tiny TTL cache ──────────────────────────────────────────────────────────
const cache = new Map<string, { data: unknown; ts: number }>();
const TTL = 2_000; // 2s — matches the original Nexus poll cadence

async function cachedFetch<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.data as T;
  const data = await fn();
  cache.set(key, { data, ts: Date.now() });
  return data;
}

async function withTimeout<T>(p: Promise<T>, ms = 6000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// ── Hyperliquid ─────────────────────────────────────────────────────────────
export async function fetchHyperliquid(): Promise<HLAsset[]> {
  return cachedFetch("hl", async () => {
    const res = await withTimeout(
      fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "metaAndAssetCtxs" }),
      }),
    );
    if (!res.ok) throw new Error(`HL HTTP ${res.status}`);
    const [meta, ctxs] = (await res.json()) as [
      { universe: Array<{ name: string; maxLeverage: number; isDelisted?: boolean }> },
      Array<{
        markPx: string;
        midPx: string;
        oraclePx: string;
        funding: string;
        openInterest: string;
        dayNtlVlm: string;
        premium: string;
        prevDayPx: string;
        impactPxs: [string, string];
      }>,
    ];
    const out: HLAsset[] = [];
    meta.universe.forEach((asset, i) => {
      const c = ctxs[i];
      if (!c || asset.isDelisted) return;
      out.push({
        symbol: asset.name,
        exchange: "hyperliquid",
        markPrice: parseFloat(c.markPx),
        midPrice: parseFloat(c.midPx),
        oraclePrice: parseFloat(c.oraclePx),
        fundingRate: parseFloat(c.funding),
        openInterest: parseFloat(c.openInterest),
        dayVolume: parseFloat(c.dayNtlVlm),
        premium: parseFloat(c.premium),
        prevDayPrice: parseFloat(c.prevDayPx),
        impactBid: parseFloat(c.impactPxs[0]),
        impactAsk: parseFloat(c.impactPxs[1]),
        maxLeverage: asset.maxLeverage,
        timestamp: Date.now(),
      });
    });
    return out;
  });
}

// ── Backpack Exchange ───────────────────────────────────────────────────────
export async function fetchBackpack(): Promise<BPTicker[]> {
  return cachedFetch("bp", async () => {
    const res = await withTimeout(fetch("https://api.backpack.exchange/api/v1/tickers"));
    if (!res.ok) throw new Error(`BP HTTP ${res.status}`);
    const tickers = (await res.json()) as Array<{
      symbol: string;
      lastPrice: string;
      high: string;
      low: string;
      volume: string;
      quoteVolume: string;
      priceChangePercent: string;
    }>;
    return tickers.map((t) => ({
      symbol: t.symbol,
      exchange: "backpack" as const,
      lastPrice: parseFloat(t.lastPrice),
      high24h: parseFloat(t.high),
      low24h: parseFloat(t.low),
      volume: parseFloat(t.volume),
      quoteVolume: parseFloat(t.quoteVolume),
      priceChangePercent: parseFloat(t.priceChangePercent),
      timestamp: Date.now(),
    }));
  });
}

// ── Binance (data-api.binance.vision is CORS-enabled) ───────────────────────
const BN_PAIRS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "AVAXUSDT", "LINKUSDT", "ARBUSDT", "OPUSDT", "SUIUSDT"];

export async function fetchBinance(): Promise<BNTicker[]> {
  return cachedFetch("bn", async () => {
    const symbols = encodeURIComponent(JSON.stringify(BN_PAIRS));
    const res = await withTimeout(
      fetch(`https://data-api.binance.vision/api/v3/ticker/24hr?symbols=${symbols}`),
    );
    if (!res.ok) throw new Error(`BN HTTP ${res.status}`);
    const tickers = (await res.json()) as Array<{
      symbol: string;
      lastPrice: string;
      highPrice: string;
      lowPrice: string;
      volume: string;
      quoteVolume: string;
      priceChangePercent: string;
    }>;
    return tickers.map((t) => ({
      symbol: t.symbol,
      exchange: "binance" as const,
      lastPrice: parseFloat(t.lastPrice),
      high24h: parseFloat(t.highPrice),
      low24h: parseFloat(t.lowPrice),
      volume: parseFloat(t.volume),
      quoteVolume: parseFloat(t.quoteVolume),
      priceChangePercent: parseFloat(t.priceChangePercent),
      timestamp: Date.now(),
    }));
  });
}

// ── Aggregate ───────────────────────────────────────────────────────────────
export async function fetchAllMarkets(): Promise<AggregateMarket> {
  const errors: AggregateMarket["errors"] = {};
  const [hl, bp, bn] = await Promise.all([
    fetchHyperliquid().catch((e) => {
      errors.hyperliquid = (e as Error).message;
      return [] as HLAsset[];
    }),
    fetchBackpack().catch((e) => {
      errors.backpack = (e as Error).message;
      return [] as BPTicker[];
    }),
    fetchBinance().catch((e) => {
      errors.binance = (e as Error).message;
      return [] as BNTicker[];
    }),
  ]);
  return { hyperliquid: hl, backpack: bp, binance: bn, timestamp: Date.now(), errors };
}
