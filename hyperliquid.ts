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

const EDGE_FN_URL = (() => {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!base) return null;
  return `${base}/functions/v1/hyperliquid-cache`;
})();

const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

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
  if (!EDGE_FN_URL) {
    throw new HLApiError(
      'VITE_SUPABASE_URL is not set — cannot reach hyperliquid-cache edge function',
    );
  }

  const params = new URLSearchParams({ type });
  if (address) params.set('address', address);

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
