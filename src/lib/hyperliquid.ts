/* HYPERLIQUID API CLIENT - FIXED
 * Now supports BOTH block explorer (hypurrscan) AND trading API (hyperliquid.xyz)
 * Trading API calls go DIRECTLY to api.hyperliquid.xyz/info (POST, no auth)
 * Block explorer calls still go through Supabase Edge Function cache.
 */

export interface HLCachedResponse<T = any> {
  data: T; cached: boolean; stale?: boolean; rateLimited?: boolean;
  age_ms?: number; fetch_ms?: number; ts: number; error?: string;
}

// Block Explorer Types (hypurrscan.io)
export interface HLBlock { height: number; hash: string; time: number; proposer?: string; txCount: number; gasUsed?: number; gasLimit?: number; }
export interface HLTx { hash: string; blockHeight: number; time: number; from: string; to?: string; value?: string; action?: string; status: 'success' | 'failure' | 'pending'; }
export interface HLAddressStats { address: string; txCount: number; volume24h?: number; totalVolume?: number; pnl24h?: number; firstSeen?: number; lastSeen?: number; tags?: string[]; rank?: number; recentTxs?: HLTx[]; }
export interface HLBalanceRPC { jsonrpc: string; id: number; result?: string; error?: { code: number; message: string }; }
export interface HLLeaderEntry { rank: number; address: string; volume24h: number; pnl24h: number; totalVolume: number; }

// Trading API Types (api.hyperliquid.xyz/info)
export interface HLAssetCtx { dayNtlVlm: string; funding: string; impactPxs: [string, string]; markPx: string; midPx: string; openInterest: string; oraclePx: string; premium: string; prevDayPx: string; }
export interface HLMeta { universe: Array<{ name: string; szDecimals: number; maxLeverage: number; onlyIsolated?: boolean; isDelisted?: boolean; }>; }
export interface HLMarket { symbol: string; markPrice: number; midPrice: number; oraclePrice: number; fundingRate: number; openInterest: number; dayVolume: number; premium: number; prevDayPrice: number; impactBid: number; impactAsk: number; maxLeverage: number; }
export interface HLSummary { totalOI: number; totalVolume24h: number; avgFundingRate: number; marketCount: number; }
export interface HLMarketsResponse { markets: HLMarket[]; summary: HLSummary; }
export type HLAllMids = Record<string, string>;
export interface HLFundingSnapshot { coin: string; fundingRate: string; premium: string; time: number; }
export interface HLL2Book { coin: string; levels: Array<{ px: string; sz: string; n: number }>; }
export interface HLClearinghouseState { assetPositions: Array<{ coin: string; szi: string; entryPx: string; positionValue: string; unrealizedPnl: string; leverage: { type: string; value: number }; liquidationPx: string | null; marginUsed: string; }>; crossMarginSummary: { accountValue: string; totalMarginUsed: string; totalRawUsd: string; withdrawable: string; }; }

export type HLBlockExplorerType = 'blocks' | 'txs' | 'address' | 'balance' | 'leaderboard';
export type HLTradingType = 'metaAndAssetCtxs' | 'allMids' | 'fundingHistory' | 'l2Book' | 'clearinghouse';
export type HLFetchType = HLBlockExplorerType | HLTradingType;

// Supabase config (for block explorer only)
function getSupabaseUrl(): string | null {
  try { const rt = localStorage.getItem('wr_supabase_url'); if (rt?.startsWith('https://')) return rt; } catch { }
  return (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? null;
}
function getSupabaseAnonKey(): string | undefined {
  try { const rt = localStorage.getItem('wr_supabase_anon_key'); if (rt && rt.length > 20) return rt; } catch { }
  return import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
}
function getEdgeFnUrl(): string | null {
  const base = getSupabaseUrl();
  if (!base) return null;
  return `${base}/functions/v1/hyperliquid-cache`;
}

export class HLApiError extends Error {
  constructor(message: string, public readonly status?: number) { super(message); this.name = 'HLApiError'; }
}

export async function hlFetch<T = any>(type: HLFetchType, address?: string, signal?: AbortSignal, startTime?: number): Promise<HLCachedResponse<T>> {
  if (isTradingType(type)) return fetchTradingAPI(type, address, signal, startTime);
  return fetchBlockExplorer(type as HLBlockExplorerType, address, signal);
}

function isTradingType(type: HLFetchType): type is HLTradingType {
  return ['metaAndAssetCtxs', 'allMids', 'fundingHistory', 'l2Book', 'clearinghouse'].includes(type);
}

async function fetchTradingAPI<T>(type: HLTradingType, address?: string, signal?: AbortSignal, startTime?: number): Promise<HLCachedResponse<T>> {
  const start = performance.now();
  let body: any;
  switch (type) {
    case 'metaAndAssetCtxs': body = { type: 'metaAndAssetCtxs' }; break;
    case 'allMids': body = { type: 'allMids' }; break;
    case 'fundingHistory': body = { type: 'fundingHistory', coin: address?.toUpperCase() ?? '', startTime: startTime ?? Date.now() - 24 * 60 * 60 * 1000 }; break;
    case 'l2Book': body = { type: 'l2Book', coin: address?.toUpperCase() ?? '' }; break;
    case 'clearinghouse': body = { type: 'clearinghouseState', user: address ?? '' }; break;
  }
  const res = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  });
  if (!res.ok) throw new HLApiError(`Hyperliquid Trading API error: HTTP ${res.status}`, res.status);
  const raw = await res.json();
  const fetchMs = Math.round(performance.now() - start);
  let data: T;
  if (type === 'metaAndAssetCtxs') {
    const [meta, assetCtxs] = raw as [HLMeta, HLAssetCtx[]];
    data = transformMetaAndAssetCtxs(meta, assetCtxs) as T;
  } else { data = raw; }
  return { data, cached: false, stale: false, age_ms: 0, fetch_ms: fetchMs, ts: Date.now() };
}

function transformMetaAndAssetCtxs(meta: HLMeta, ctxs: HLAssetCtx[]): HLMarketsResponse {
  const markets: HLMarket[] = meta.universe.map((asset, i) => {
    const ctx = ctxs[i];
    return {
      symbol: asset.name, markPrice: parseFloat(ctx.markPx), midPrice: parseFloat(ctx.midPx),
      oraclePrice: parseFloat(ctx.oraclePx), fundingRate: parseFloat(ctx.funding),
      openInterest: parseFloat(ctx.openInterest), dayVolume: parseFloat(ctx.dayNtlVlm),
      premium: parseFloat(ctx.premium), prevDayPrice: parseFloat(ctx.prevDayPx),
      impactBid: parseFloat(ctx.impactPxs[0]), impactAsk: parseFloat(ctx.impactPxs[1]),
      maxLeverage: asset.maxLeverage,
    };
  });
  const summary: HLSummary = {
    totalOI: markets.reduce((s, m) => s + m.openInterest, 0),
    totalVolume24h: markets.reduce((s, m) => s + m.dayVolume, 0),
    avgFundingRate: markets.reduce((s, m) => s + m.fundingRate, 0) / markets.length,
    marketCount: markets.length,
  };
  return { markets, summary };
}

async function fetchBlockExplorer<T>(type: HLBlockExplorerType, address?: string, signal?: AbortSignal): Promise<HLCachedResponse<T>> {
  const edgeUrl = getEdgeFnUrl();
  if (!edgeUrl) throw new HLApiError('Supabase URL not configured — set VITE_SUPABASE_URL or enter it in Settings');
  const anonKey = getSupabaseAnonKey();
  const params = new URLSearchParams({ type });
  if (address) params.set('address', address);
  const res = await fetch(`${edgeUrl}?${params}`, {
    headers: { ...(anonKey ? { apikey: anonKey, Authorization: `Bearer ${anonKey}` } : {}), 'Content-Type': 'application/json' },
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new HLApiError((body as { error?: string }).error ?? `HTTP ${res.status}`, res.status);
  }
  return res.json() as Promise<HLCachedResponse<T>>;
}

export function isHLConfigured(): boolean { return !!getEdgeFnUrl(); }

export function fmtAgo(epochMs: number | undefined): string {
  if (!epochMs) return '—';
  const diff = Date.now() - epochMs;
  if (diff < 1000) return `${diff}ms ago`;
  if (diff < 60000) return `${(diff / 1000).toFixed(1)}s ago`;
  return `${Math.floor(diff / 60000)}m ago`;
}

export function shortAddr(addr: string, head = 6, tail = 4): string {
  if (!addr || addr.length <= head + tail + 2) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function hexToHype(hex: string | undefined): string {
  if (!hex) return '0';
  const wei = BigInt(hex);
  const whole = wei / BigInt(1e18);
  const frac = (wei % BigInt(1e18)) / BigInt(1e14);
  return `${whole}.${String(frac).padStart(4, '0')} HYPE`;
}
