/* PRODUCTION FIXED v3
 * fixes:
 * - empty coin/user validation
 * - allMids transformation
 * - fundingHistory shape
 * - l2Book normalization
 * - clearinghouse validation
 * - proxy removed (unstable for POST)
 * - strict error handling
 */

export interface HLCachedResponse<T = any> {
  data: T;
  cached: boolean;
  stale?: boolean;
  rateLimited?: boolean;
  age_ms?: number;
  fetch_ms?: number;
  ts: number;
  error?: string;
}

/* ================= TYPES ================= */

export type HLTradingType =
  | 'metaAndAssetCtxs'
  | 'allMids'
  | 'fundingHistory'
  | 'l2Book'
  | 'clearinghouse';

export class HLApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'HLApiError';
  }
}

/* ================= CORE ================= */

const HL_URL = 'https://api.hyperliquid.xyz/info';

async function post(body: unknown, signal?: AbortSignal) {
  const res = await fetch(HL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new HLApiError(`HTTP ${res.status} ${txt}`, res.status);
  }

  const json = await res.json();
  if (!json) throw new HLApiError('Empty response');

  return json;
}

/* ================= MAIN ================= */

export async function hlFetch<T = any>(
  type: HLTradingType,
  params?: { coin?: string; user?: string; startTime?: number },
  signal?: AbortSignal
): Promise<HLCachedResponse<T>> {
  const start = performance.now();

  let body: any;

  switch (type) {
    case 'metaAndAssetCtxs':
      body = { type };
      break;

    case 'allMids':
      body = { type };
      break;

    case 'fundingHistory':
      if (!params?.coin) throw new HLApiError('coin required');
      body = {
        type,
        coin: params.coin.toUpperCase(),
        startTime: params.startTime ?? Date.now() - 86400000,
      };
      break;

    case 'l2Book':
      if (!params?.coin) throw new HLApiError('coin required');
      body = {
        type,
        coin: params.coin.toUpperCase(),
      };
      break;

    case 'clearinghouse':
      if (!params?.user) throw new HLApiError('user required');
      body = {
        type: 'clearinghouseState',
        user: params.user,
      };
      break;

    default:
      throw new HLApiError('invalid type');
  }

  const raw = await post(body, signal);

  let data: any;

  /* ===== TRANSFORMS ===== */

  if (type === 'allMids') {
    data = Object.entries(raw).map(([symbol, price]) => ({
      symbol,
      price: parseFloat(price as string),
    }));
  }

  else if (type === 'fundingHistory') {
    data = (raw as any[]).map((f) => ({
      coin: f.coin,
      fundingRate: parseFloat(f.fundingRate),
      premium: parseFloat(f.premium),
      time: f.time,
    }));
  }

  else if (type === 'l2Book') {
    data = {
      coin: raw.coin,
      bids: raw.levels
        .filter((l: any) => Number(l.sz) > 0)
        .map((l: any) => ({
          price: parseFloat(l.px),
          size: parseFloat(l.sz),
        })),
      asks: raw.levels
        .filter((l: any) => Number(l.sz) < 0)
        .map((l: any) => ({
          price: parseFloat(l.px),
          size: Math.abs(parseFloat(l.sz)),
        })),
    };
  }

  else {
    data = raw;
  }

  return {
    data,
    cached: false,
    fetch_ms: Math.round(performance.now() - start),
    ts: Date.now(),
  };
}
