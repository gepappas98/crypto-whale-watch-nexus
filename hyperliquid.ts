/* ══ HYPERLIQUID — Types & API Client ════════════════════════════════════════
 * FIX: Was typed for api.hypurrscan.io (block explorer).
 *      Now typed for api.hyperliquid.xyz/info (trading API).
 *
 * All data flows through the Supabase Edge Function cache.
 * The frontend NEVER calls api.hyperliquid.xyz directly.
 * ═══════════════════════════════════════════════════════════════════════════ */

// ── Response wrapper from edge function (UNCHANGED) ───────────────────────────

export interface HLCachedResponse<T> {
  data:         T;
  cached:       boolean;
  stale?:       boolean;
  rateLimited?: boolean;
  age_ms?:      number;
  fetch_ms?:    number;
  ts:           number;   // server timestamp (epoch ms)
  error?:       string;
}

// ── Market (one perpetual asset) ──────────────────────────────────────────────

export interface HLMarket {
  asset:           string;   // e.g. "BTC"
  markPx:          number;   // mark price USD
  oraclePx:        number;   // oracle price USD
  premium:         number;   // (mark - oracle) / oracle  e.g. 0.0002 = 0.02 %
  funding:         number;   // 8-h funding rate as fraction  e.g. 0.0001
  openInterest:    number;   // OI in coin units
  openInterestUsd: number;   // OI in USD
  dayVolumeUsd:    number;   // 24-h notional volume USD
  maxLeverage:     number;
  szDecimals:      number;
}

// ── Summary (aggregate over all markets) ─────────────────────────────────────

export interface HLSummary {
  totalOiUsd:   number;   // sum of openInterestUsd
  totalVolUsd:  number;   // sum of dayVolumeUsd
  avgFunding8h: number;   // mean funding rate (fraction)
  marketCount:  number;
}

// ── Full metaAndAssetCtxs response ────────────────────────────────────────────

export interface HLMarketsResponse {
  markets:   HLMarket[];
  summary:   HLSummary;
  fetchedAt: string;
}

// ── allMids response ──────────────────────────────────────────────────────────

export type HLAllMids = Record<string, string>; // { BTC: "104200.5", ETH: "2510.0", ... }

// ── Funding history (one snapshot per hour) ───────────────────────────────────

export interface HLFundingSnapshot {
  coin:        string;
  fundingRate: string;   // fraction as string e.g. "0.0001"
  premium:     string;
  time:        number;   // epoch ms
}

// ── L2 order book ─────────────────────────────────────────────────────────────

export interface HLL2Level {
  px:   string;   // price
  sz:   string;   // size
  n:    number;   // number of orders at this level
}

export interface HLL2Book {
  coin:   string;
  time:   number;
  levels: [HLL2Level[], HLL2Level[]];  // [bids, asks]
}

// ── Clearinghouse (perpetual account state) ───────────────────────────────────

export interface HLPosition {
  coin:           string;
  szi:            string;   // signed size (negative = short)
  entryPx:        string;
  positionValue:  string;
  unrealizedPnl:  string;
  returnOnEquity: string;
  liquidationPx:  string | null;
  leverage: {
    type:  'isolated' | 'cross';
    value: number;
    rawUsd?: string;
  };
}

export interface HLClearinghouseState {
  assetPositions: Array<{ position: HLPosition; type: string }>;
  crossMaintenanceMarginUsed: string;
  crossMarginSummary: {
    accountValue:    string;
    totalMarginUsed: string;
    totalNtlPos:     string;
    totalRawUsd:     string;
  };
  marginSummary: {
    accountValue:    string;
    totalMarginUsed: string;
    totalNtlPos:     string;
    totalRawUsd:     string;
  };
  time:        number;
  withdrawable: string;
}

// ── API client ────────────────────────────────────────────────────────────────

const EDGE_FN_URL = (() => {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!base) return null;
  return `${base}/functions/v1/hyperliquid-cache`;
})();

const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export type HLFetchType =
  | 'metaAndAssetCtxs'
  | 'allMids'
  | 'meta'
  | 'fundingHistory'
  | 'l2Book'
  | 'clearinghouse';

export class HLApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'HLApiError';
  }
}

/**
 * Fetch from the Supabase Edge Function cache.
 *
 * @param type      - Which HL trading API endpoint to hit
 * @param coinOrAddr - coin symbol for fundingHistory/l2Book; address for clearinghouse
 * @param signal    - AbortSignal from TanStack Query
 * @param startTime - epoch ms, only used for fundingHistory (defaults to 24h ago)
 */
export async function hlFetch<T>(
  type: HLFetchType,
  coinOrAddr?: string,
  signal?: AbortSignal,
  startTime?: number,
): Promise<HLCachedResponse<T>> {
  if (!EDGE_FN_URL) {
    throw new HLApiError(
      'VITE_SUPABASE_URL is not set — cannot reach hyperliquid-cache edge function',
    );
  }

  const params = new URLSearchParams({ type });

  if (coinOrAddr) {
    // Route the param to the correct key based on type
    if (type === 'clearinghouse') {
      params.set('address', coinOrAddr);
    } else {
      params.set('coin', coinOrAddr);
    }
  }

  if (startTime != null) {
    params.set('startTime', String(startTime));
  }

  const res = await fetch(`${EDGE_FN_URL}?${params}`, {
    headers: {
      ...(ANON_KEY ? { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } : {}),
      'Content-Type': 'application/json',
    },
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new HLApiError(
      (body as { error?: string }).error ?? `HTTP ${res.status}`,
      res.status,
    );
  }

  return res.json() as Promise<HLCachedResponse<T>>;
}

// ── Formatters ────────────────────────────────────────────────────────────────

/** "123ms ago" / "2.1s ago" / "1m ago" (UNCHANGED) */
export function fmtAgo(epochMs: number | undefined): string {
  if (!epochMs) return '—';
  const diff = Date.now() - epochMs;
  if (diff < 1_000)  return `${diff}ms ago`;
  if (diff < 60_000) return `${(diff / 1_000).toFixed(1)}s ago`;
  return `${Math.floor(diff / 60_000)}m ago`;
}

/** Shorten 0xABCD...WXYZ → 0xABCD…WXYZ (UNCHANGED) */
export function shortAddr(addr: string, head = 6, tail = 4): string {
  if (!addr || addr.length <= head + tail + 2) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

/** Format USD value: $1.23B / $456.7M / $12.3K / $123.45 */
export function fmtUsd(value: number): string {
  if (value >= 1e9)  return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6)  return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3)  return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

/** Format funding rate as percentage: 0.0001 → "0.0100%" */
export function fmtFunding(rate: number): string {
  return `${(rate * 100).toFixed(4)}%`;
}

/** Format premium: 0.0002 → "+0.02%" / -0.0001 → "-0.01%" */
export function fmtPremium(premium: number): string {
  const pct = premium * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(4)}%`;
}

/** Mark price with appropriate decimal places */
export function fmtPrice(px: number): string {
  if (px >= 1000) return `$${px.toLocaleString('en-US', { maximumFractionDigits: 1 })}`;
  if (px >= 1)    return `$${px.toFixed(4)}`;
  return `$${px.toFixed(6)}`;
}
