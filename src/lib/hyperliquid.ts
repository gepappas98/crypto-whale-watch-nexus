/* ══ HYPERLIQUID CLIENT ═══════════════════════════════════════════════════════
 *  Direct browser client for Hyperliquid trading API (no backend required).
 *  Block-explorer features (blocks/txs/wallets/leaderboard) require an
 *  external indexer; when unconfigured, those endpoints return empty data
 *  rather than mock values — keeping the project's "no simulated data" rule.
 * ═══════════════════════════════════════════════════════════════════════════ */

const HL_TRADING_URL = 'https://api.hyperliquid.xyz/info';

// Optional: explorer indexer (Hypurrscan / custom edge fn). Unset by default.
const HL_EXPLORER_URL: string | undefined =
  import.meta.env?.VITE_HL_EXPLORER_URL || undefined;

export function isHLConfigured(): boolean {
  return Boolean(HL_EXPLORER_URL);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface HLUniverseAsset { name: string; maxLeverage?: number }
interface HLAssetCtx { markPx?: string; oraclePx?: string; funding?: string; openInterest?: string; dayNtlVlm?: string }
interface HLMetaAndAssetCtxsResponse { universe?: HLUniverseAsset[] }
interface HLFundingHistoryEntry { coin: string; fundingRate: string; premium: string; time: number }

export interface HLCachedResponse<T = unknown> {
  data: T;
  cached: boolean;
  stale?: boolean;
  rateLimited?: boolean;
  age_ms?: number;
  fetch_ms?: number;
  ts: number;
  error?: string;
}

export interface HLBlock {
  height: number;
  hash: string;
  time: number;       // epoch ms
  txCount: number;
  proposer?: string;
}

export interface HLTx {
  hash: string;
  from: string;
  to?: string;
  blockHeight: number;
  time: number;
  value?: string;     // USD or HYPE numeric string
  action?: string;
  status: 'success' | 'failure' | 'pending';
}

export interface HLAddressStats {
  address: string;
  volume24h?: number;
  pnl24h?: number;
  txCount?: number;
  lastSeen?: number;
  rank?: number;
  tags?: string[];
}

export interface HLBalanceRPC {
  result: string;     // hex-encoded wei-style balance
}

export interface HLLeaderEntry {
  rank: number;
  address: string;
  volume24h: number;
  pnl24h: number;
}

export interface HLMarket {
  symbol: string;
  markPrice: number;
  oraclePrice: number;
  premium: number;
  fundingRate: number;
  openInterest: number;
  dayVolume: number;
  maxLeverage: number;
}

export interface HLMarketSummary {
  totalOI: number;
  totalVolume24h: number;
  avgFundingRate: number;
  marketCount: number;
}

export type HLEndpoint =
  | 'blocks'
  | 'txs'
  | 'address'
  | 'balance'
  | 'leaderboard'
  | 'markets'
  | 'allMids'
  | 'metaAndAssetCtxs'
  | 'fundingHistory'
  | 'l2Book'
  | 'clearinghouse';

export class HLApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'HLApiError';
  }
}

// ── Core POST ─────────────────────────────────────────────────────────────────

async function postTrading(body: unknown, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(HL_TRADING_URL, {
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
  if (json == null) throw new HLApiError('Empty response');
  return json;
}

// ── Markets builder (real Hyperliquid metaAndAssetCtxs) ───────────────────────

async function fetchMarkets(signal?: AbortSignal): Promise<{ markets: HLMarket[]; summary: HLMarketSummary }> {
  const raw = await postTrading({ type: 'metaAndAssetCtxs' }, signal) as [HLMetaAndAssetCtxsResponse, HLAssetCtx[]] | undefined;
  const meta = raw?.[0];
  const ctxs = raw?.[1];
  if (!meta?.universe || !Array.isArray(ctxs)) {
    return { markets: [], summary: { totalOI: 0, totalVolume24h: 0, avgFundingRate: 0, marketCount: 0 } };
  }
  const markets: HLMarket[] = meta.universe.map((u, i) => {
    const c = ctxs[i] ?? {};
    const mark = parseFloat(c.markPx ?? '0');
    const oracle = parseFloat(c.oraclePx ?? '0');
    return {
      symbol: u.name,
      markPrice: mark,
      oraclePrice: oracle,
      premium: oracle > 0 ? (mark - oracle) / oracle : 0,
      fundingRate: parseFloat(c.funding ?? '0'),
      openInterest: parseFloat(c.openInterest ?? '0') * mark,
      dayVolume: parseFloat(c.dayNtlVlm ?? '0'),
      maxLeverage: u.maxLeverage ?? 0,
    };
  });
  const totalOI = markets.reduce((s, m) => s + m.openInterest, 0);
  const totalVolume24h = markets.reduce((s, m) => s + m.dayVolume, 0);
  const avgFundingRate = markets.length > 0
    ? markets.reduce((s, m) => s + m.fundingRate, 0) / markets.length
    : 0;
  return {
    markets,
    summary: { totalOI, totalVolume24h, avgFundingRate, marketCount: markets.length },
  };
}

// ── Unified fetch (used by hooks) ─────────────────────────────────────────────

export async function hlFetch<T = unknown>(
  endpoint: HLEndpoint,
  paramOrParams?: string | { coin?: string; user?: string; startTime?: number },
  signal?: AbortSignal,
): Promise<HLCachedResponse<T>> {
  const start = performance.now();
  let data: unknown;

  switch (endpoint) {
    // ── Real trading data (Hyperliquid public API) ─────────────────────────
    case 'allMids': {
      const raw = await postTrading({ type: 'allMids' }, signal) as Record<string, string>;
      data = Object.entries(raw).map(([symbol, price]) => ({
        symbol,
        price: parseFloat(price),
      }));
      break;
    }
    case 'markets': {
      data = await fetchMarkets(signal);
      break;
    }
    case 'metaAndAssetCtxs': {
      data = await postTrading({ type: 'metaAndAssetCtxs' }, signal);
      break;
    }
    case 'fundingHistory': {
      const p = typeof paramOrParams === 'object' ? paramOrParams : undefined;
      if (!p?.coin) throw new HLApiError('coin required');
      const raw = await postTrading({
        type: 'fundingHistory',
        coin: p.coin.toUpperCase(),
        startTime: p.startTime ?? Date.now() - 86_400_000,
      }, signal) as HLFundingHistoryEntry[];
      data = raw.map((f) => ({
        coin: f.coin,
        fundingRate: parseFloat(f.fundingRate),
        premium: parseFloat(f.premium),
        time: f.time,
      }));
      break;
    }
    case 'l2Book': {
      const p = typeof paramOrParams === 'object' ? paramOrParams : undefined;
      if (!p?.coin) throw new HLApiError('coin required');
      const raw = await postTrading({ type: 'l2Book', coin: p.coin.toUpperCase() }, signal) as {
        coin: string;
        levels?: [Array<{ px: string; sz: string }>, Array<{ px: string; sz: string }>];
      };
      data = {
        coin: raw.coin,
        bids: (raw.levels?.[0] ?? []).map((l) => ({ price: parseFloat(l.px), size: parseFloat(l.sz) })),
        asks: (raw.levels?.[1] ?? []).map((l) => ({ price: parseFloat(l.px), size: parseFloat(l.sz) })),
      };
      break;
    }
    case 'clearinghouse': {
      const p = typeof paramOrParams === 'object' ? paramOrParams : undefined;
      if (!p?.user) throw new HLApiError('user required');
      data = await postTrading({ type: 'clearinghouseState', user: p.user }, signal);
      break;
    }

    // ── Explorer endpoints (require external indexer) ──────────────────────
    case 'blocks':
    case 'txs':
    case 'leaderboard': {
      // Without an explorer indexer we return empty arrays — never mock data.
      data = [];
      break;
    }
    case 'address': {
      data = null;
      break;
    }
    case 'balance': {
      data = { result: '0x0' } as HLBalanceRPC;
      break;
    }

    default:
      throw new HLApiError(`unsupported endpoint: ${endpoint}`);
  }

  return {
    data: data as T,
    cached: false,
    fetch_ms: Math.round(performance.now() - start),
    ts: Date.now(),
  };
}

// ── Formatting helpers ────────────────────────────────────────────────────────

export function shortAddr(addr: string | undefined | null, head = 6, tail = 4): string {
  if (!addr) return '—';
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function fmtAgo(epochMs: number | undefined | null): string {
  if (!epochMs) return '—';
  const diff = Date.now() - epochMs;
  if (diff < 1_000) return `${Math.max(0, diff)}ms`;
  if (diff < 60_000) return `${(diff / 1_000).toFixed(1)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

export function hexToHype(hex: string | undefined | null): string {
  if (!hex) return '—';
  try {
    const wei = BigInt(hex);
    // 18 decimals, render as fixed-2 HYPE
    const whole = wei / 10n ** 18n;
    const frac = (wei % 10n ** 18n) / 10n ** 16n; // two decimals
    const fracStr = frac.toString().padStart(2, '0');
    return `${whole.toString()}.${fracStr} HYPE`;
  } catch {
    return '—';
  }
}
