/* ══ HYPERLIQUID — Types & API Client ════════════════════════════════════════
 *  All Hypurrscan data flows through the Supabase Edge Function cache.
 *  The frontend NEVER calls api.hypurrscan.io directly.
 * ═══════════════════════════════════════════════════════════════════════════ */

// ── Response wrapper from edge function ──────────────────────────────────────

export interface HLCachedResponse<T> {
  data: T;
  cached: boolean;
  stale?: boolean;
  rateLimited?: boolean;
  age_ms?: number;
  fetch_ms?: number;
  ts: number;        // server timestamp (epoch ms)
  error?: string;
}

// ── Block ─────────────────────────────────────────────────────────────────────

export interface HLBlock {
  height: number;
  hash: string;
  time: number;          // epoch ms
  proposer?: string;
  txCount: number;
  gasUsed?: number;
  gasLimit?: number;
}

// ── Transaction ───────────────────────────────────────────────────────────────

export interface HLTx {
  hash: string;
  blockHeight: number;
  time: number;          // epoch ms
  from: string;
  to?: string;
  value?: string;        // in USDC or native token
  action?: string;       // e.g. "trade", "transfer", "deposit"
  status: 'success' | 'failure' | 'pending';
}

// ── Address / Wallet ──────────────────────────────────────────────────────────

export interface HLAddressStats {
  address: string;
  txCount: number;
  volume24h?: number;    // USD
  totalVolume?: number;  // USD
  pnl24h?: number;
  firstSeen?: number;    // epoch ms
  lastSeen?: number;     // epoch ms
  tags?: string[];       // e.g. ["whale", "mm"]
  rank?: number;
  recentTxs?: HLTx[];
}

// ── Balance (from RPC) ────────────────────────────────────────────────────────

export interface HLBalanceRPC {
  jsonrpc: string;
  id: number;
  result?: string;   // hex balance
  error?: { code: number; message: string };
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

export interface HLLeaderEntry {
  rank: number;
  address: string;
  volume24h: number;
  pnl24h: number;
  totalVolume: number;
}

// ── API client ────────────────────────────────────────────────────────────────

/** Reads Supabase URL from (1) localStorage runtime override, (2) build-time env var */
function getSupabaseUrl(): string | null {
  try {
    const rt = localStorage.getItem('wr_supabase_url');
    if (rt?.startsWith('https://')) return rt;
  } catch { /* SSR / no localStorage */ }
  return (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? null;
}

/** Reads anon key from (1) localStorage runtime override, (2) build-time env var */
function getSupabaseAnonKey(): string | undefined {
  try {
    const rt = localStorage.getItem('wr_supabase_anon_key');
    if (rt && rt.length > 20) return rt;
  } catch { /* SSR */ }
  return import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
}

function getEdgeFnUrl(): string | null {
  const base = getSupabaseUrl();
  if (!base) return null;
  return `${base}/functions/v1/hyperliquid-cache`;
}

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
 * Throws HLApiError on non-ok responses.
 */
export async function hlFetch<T>(
  type: 'blocks' | 'txs' | 'address' | 'balance' | 'leaderboard',
  address?: string,
  signal?: AbortSignal,
): Promise<HLCachedResponse<T>> {
  const edgeUrl = getEdgeFnUrl();
  if (!edgeUrl) {
    throw new HLApiError(
      'Supabase URL not configured — set VITE_SUPABASE_URL or enter it in Settings → Hyperliquid',
    );
  }

  const anonKey = getSupabaseAnonKey();
  const params = new URLSearchParams({ type });
  if (address) params.set('address', address);

  const res = await fetch(`${edgeUrl}?${params}`, {
    headers: {
      ...(anonKey ? { apikey: anonKey, Authorization: `Bearer ${anonKey}` } : {}),
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

/** Returns true if the Supabase URL is configured (build-time or runtime) */
export function isHLConfigured(): boolean {
  return !!getEdgeFnUrl();
}

// ── Formatters ────────────────────────────────────────────────────────────────

/** "123ms ago" / "2s ago" / "1m ago" */
export function fmtAgo(epochMs: number | undefined): string {
  if (!epochMs) return '—';
  const diff = Date.now() - epochMs;
  if (diff < 1_000) return `${diff}ms ago`;
  if (diff < 60_000) return `${(diff / 1_000).toFixed(1)}s ago`;
  return `${Math.floor(diff / 60_000)}m ago`;
}

/** Shorten 0xABCD...WXYZ to 0xABCD…WXYZ */
export function shortAddr(addr: string, head = 6, tail = 4): string {
  if (!addr || addr.length <= head + tail + 2) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

/** Hex wei → readable HYPE amount (18 decimals) */
export function hexToHype(hex: string | undefined): string {
  if (!hex) return '0';
  const wei = BigInt(hex);
  const whole = wei / BigInt(1e18);
  const frac = (wei % BigInt(1e18)) / BigInt(1e14); // 4 decimals
  return `${whole}.${String(frac).padStart(4, '0')} HYPE`;
}
