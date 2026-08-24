/* ══ HYPERLIQUID — React Query hooks ═════════════════════════════════════════
 *  Browser-direct hooks. Markets uses real Hyperliquid trading API.
 *  Explorer hooks (blocks/txs/wallets/leaderboard) return empty data when no
 *  explorer indexer is configured — never mock values.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  hlFetch,
  type HLBlock,
  type HLTx,
  type HLAddressStats,
  type HLBalanceRPC,
  type HLLeaderEntry,
  type HLMarket,
  type HLMarketSummary,
  type HLCachedResponse,
} from '@/lib/hyperliquid';

// ── Query keys ───────────────────────────────────────────────────────────────

export const hlKeys = {
  blocks:      () => ['hl', 'blocks'] as const,
  txs:         () => ['hl', 'txs'] as const,
  address:     (a: string) => ['hl', 'address', a.toLowerCase()] as const,
  balance:     (a: string) => ['hl', 'balance', a.toLowerCase()] as const,
  leaderboard: () => ['hl', 'leaderboard'] as const,
  markets:     () => ['hl', 'markets'] as const,
  allMids:     () => ['hl', 'allMids'] as const,
};

const BLOCK_INTERVAL  = 1_000;
const ADDR_INTERVAL   = 2_000;
const LEADER_INTERVAL = 5_000;
const MARKETS_INTERVAL = 3_000;

// ── allMids (legacy) ─────────────────────────────────────────────────────────

export function useAllMids() {
  const [data, setData] = useState<{ symbol: string; price: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await hlFetch<{ symbol: string; price: number }[]>('allMids');
        if (!cancelled) setData(res.data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { data, loading, error };
}

// ── useHLBlocks ──────────────────────────────────────────────────────────────

export interface HLBlocksResult {
  blocks: HLBlock[];
  age_ms: number | undefined;
  cached: boolean;
  stale: boolean;
  isFirstLoad: boolean;
  error: Error | null;
}

export function useHLBlocks(): HLBlocksResult {
  const query = useQuery({
    queryKey: hlKeys.blocks(),
    queryFn: ({ signal }) => hlFetch<HLBlock[]>('blocks', undefined, signal),
    refetchInterval: BLOCK_INTERVAL,
    staleTime: 500,
    gcTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const r = query.data as HLCachedResponse<HLBlock[]> | undefined;
  return {
    blocks:      r?.data ?? [],
    age_ms:      r?.age_ms,
    cached:      r?.cached ?? false,
    stale:       r?.stale ?? false,
    isFirstLoad: query.isLoading,
    error:       query.error as Error | null,
  };
}

// ── useHLTxs ─────────────────────────────────────────────────────────────────

export interface HLTxsResult {
  txs: HLTx[];
  age_ms: number | undefined;
  cached: boolean;
  isFirstLoad: boolean;
  error: Error | null;
}

export function useHLTxs(): HLTxsResult {
  const query = useQuery({
    queryKey: hlKeys.txs(),
    queryFn: ({ signal }) => hlFetch<HLTx[]>('txs', undefined, signal),
    refetchInterval: BLOCK_INTERVAL,
    staleTime: 500,
    gcTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const r = query.data as HLCachedResponse<HLTx[]> | undefined;
  return {
    txs:         r?.data ?? [],
    age_ms:      r?.age_ms,
    cached:      r?.cached ?? false,
    isFirstLoad: query.isLoading,
    error:       query.error as Error | null,
  };
}

// ── useHLAddress ─────────────────────────────────────────────────────────────

export interface HLAddressResult {
  stats: HLAddressStats | null;
  age_ms: number | undefined;
  cached: boolean;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useHLAddress(address: string | null): HLAddressResult {
  const addr = address?.trim().toLowerCase() ?? '';
  const query = useQuery({
    queryKey: hlKeys.address(addr),
    queryFn: ({ signal }) => hlFetch<HLAddressStats | null>('address', addr, signal),
    enabled: addr.length === 42 && addr.startsWith('0x'),
    staleTime: ADDR_INTERVAL,
    gcTime: 60_000,
    refetchInterval: ADDR_INTERVAL,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const r = query.data as HLCachedResponse<HLAddressStats | null> | undefined;
  return {
    stats:      r?.data ?? null,
    age_ms:     r?.age_ms,
    cached:     r?.cached ?? false,
    isLoading:  query.isLoading,
    isFetching: query.isFetching,
    error:      query.error as Error | null,
    refetch:    query.refetch,
  };
}

// ── useHLBalance ─────────────────────────────────────────────────────────────

export interface HLBalanceResult {
  hexBalance: string | null;
  age_ms: number | undefined;
  cached: boolean;
  isLoading: boolean;
  error: Error | null;
}

export function useHLBalance(address: string | null): HLBalanceResult {
  const addr = address?.trim().toLowerCase() ?? '';
  const query = useQuery({
    queryKey: hlKeys.balance(addr),
    queryFn: ({ signal }) => hlFetch<HLBalanceRPC>('balance', addr, signal),
    enabled: addr.length === 42 && addr.startsWith('0x'),
    staleTime: ADDR_INTERVAL,
    gcTime: 60_000,
    refetchInterval: ADDR_INTERVAL,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const r = query.data as HLCachedResponse<HLBalanceRPC> | undefined;
  return {
    hexBalance: r?.data?.result ?? null,
    age_ms:     r?.age_ms,
    cached:     r?.cached ?? false,
    isLoading:  query.isLoading,
    error:      query.error as Error | null,
  };
}

// ── useHLLeaderboard ─────────────────────────────────────────────────────────

export interface HLLeaderboardResult {
  entries: HLLeaderEntry[];
  age_ms: number | undefined;
  cached: boolean;
  isFirstLoad: boolean;
  error: Error | null;
}

export function useHLLeaderboard(): HLLeaderboardResult {
  const query = useQuery({
    queryKey: hlKeys.leaderboard(),
    queryFn: ({ signal }) => hlFetch<HLLeaderEntry[]>('leaderboard', undefined, signal),
    refetchInterval: LEADER_INTERVAL,
    refetchIntervalInBackground: false,
    staleTime: LEADER_INTERVAL,
    gcTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const r = query.data as HLCachedResponse<HLLeaderEntry[]> | undefined;
  return {
    entries:     r?.data ?? [],
    age_ms:      r?.age_ms,
    cached:      r?.cached ?? false,
    isFirstLoad: query.isLoading,
    error:       query.error as Error | null,
  };
}

// ── useHLMarkets ─────────────────────────────────────────────────────────────

export interface HLMarketsResult {
  markets: HLMarket[];
  summary: HLMarketSummary | null;
  age_ms: number | undefined;
  cached: boolean;
  isFirstLoad: boolean;
  error: Error | null;
}

export function useHLMarkets(): HLMarketsResult {
  const query = useQuery({
    queryKey: hlKeys.markets(),
    queryFn: ({ signal }) =>
      hlFetch<{ markets: HLMarket[]; summary: HLMarketSummary }>('markets', undefined, signal),
    refetchInterval: MARKETS_INTERVAL,
    staleTime: 1_000,
    gcTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const r = query.data as
    | HLCachedResponse<{ markets: HLMarket[]; summary: HLMarketSummary }>
    | undefined;
  return {
    markets:     r?.data?.markets ?? [],
    summary:     r?.data?.summary ?? null,
    age_ms:      r?.age_ms,
    cached:      r?.cached ?? false,
    isFirstLoad: query.isLoading,
    error:       query.error as Error | null,
  };
}

// ── useAgeMsLive ─────────────────────────────────────────────────────────────

export function useAgeMsLive(serverTs: number | undefined): number {
  const [age, setAge] = useState<number>(0);
  const timerRef = useRef<number>(0);

  useEffect(() => {
    if (!serverTs) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      setAge(Date.now() - serverTs);
      timerRef.current = window.setTimeout(tick, 100);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timerRef.current);
    };
  }, [serverTs]);

  return age;
}
