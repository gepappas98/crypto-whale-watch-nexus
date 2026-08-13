/* ══ WHALE RADAR — SOLANA WALLET ACTIVITY ═══════════════════════════════════════
 *  The "🐳 LIVE WALLET TRACKER" tab (WRRightPanel.tsx) let you add a Solana
 *  address + label, but nothing ever fetched anything for it —
 *  WalletEntry.lastActivity existed as a field and was never populated.
 *  This closes that gap with two free, public Solana JSON-RPC calls per
 *  tracked wallet: getBalance (current SOL balance) and
 *  getSignaturesForAddress (recent transaction history, used to derive
 *  last-activity time and a 24h transaction count).
 *
 *  No API key needed — mainnet-beta's public RPC endpoint is open, same
 *  trust model as this app's other free-tier public API usage. A small
 *  in-memory TTL cache keeps a page with several tracked wallets from
 *  re-fetching on every poll tick.
 *
 *  Doesn't reuse lib/cachedFetch.ts because Solana's JSON-RPC needs a POST
 *  with a body — that shared helper is GET-only.
 * ═══════════════════════════════════════════════════════════════════════════ */

const SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';
const CACHE_TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 10_000;
const LAMPORTS_PER_SOL = 1_000_000_000;

export interface WalletActivity {
  balanceSol: number;
  lastActivityIso: string | null;
  recentTxCount24h: number;
  fetchedAt: number;
}

const cache = new Map<string, { data: WalletActivity; ts: number }>();

export interface RpcSignatureEntry {
  signature: string;
  blockTime: number | null;
}

/** Exported so walletSkillScoring.ts can reuse the same timeout/error
 *  handling instead of re-deriving its own RPC client. */
export async function solanaRpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(SOLANA_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Solana RPC HTTP ${res.status}`);
    const json = await res.json() as { result?: T; error?: { message?: string } };
    if (json.error) throw new Error(json.error.message ?? 'Solana RPC error');
    if (json.result === undefined) throw new Error('Solana RPC returned no result');
    return json.result;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetches current balance + recent activity for a Solana address. Cached
 * for CACHE_TTL_MS so a poll loop across several tracked wallets doesn't
 * re-hit the RPC endpoint faster than that per address. Throws on network/
 * RPC failure — callers should catch per-wallet so one bad address doesn't
 * block the rest of the tracked list.
 */
export async function fetchWalletActivity(address: string): Promise<WalletActivity> {
  const cached = cache.get(address);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  const [balanceResult, signatures] = await Promise.all([
    solanaRpcCall<{ value: number }>('getBalance', [address]),
    solanaRpcCall<RpcSignatureEntry[]>('getSignaturesForAddress', [address, { limit: 20 }]),
  ]);

  const balanceSol = (balanceResult?.value ?? 0) / LAMPORTS_PER_SOL;
  const nowSec = Date.now() / 1000;
  const withTime = signatures.filter((s) => s.blockTime != null);
  const recentTxCount24h = withTime.filter((s) => nowSec - (s.blockTime as number) < 86_400).length;
  const mostRecent = withTime[0]; // getSignaturesForAddress returns newest-first
  const lastActivityIso = mostRecent ? new Date((mostRecent.blockTime as number) * 1000).toISOString() : null;

  const data: WalletActivity = { balanceSol, lastActivityIso, recentTxCount24h, fetchedAt: Date.now() };
  cache.set(address, { data, ts: Date.now() });
  return data;
}
