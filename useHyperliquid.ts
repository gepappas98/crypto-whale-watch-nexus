/* ══ HYPERLIQUID — TanStack Query Hooks ══════════════════════════════════════
 *  All hooks fetch ONLY from the Supabase Edge Function cache.
 *  Pattern: stale-while-revalidate with per-type intervals.
 *
 *  Poll intervals:
 *    blocks / txs   → 300ms (show cached instantly, feel "live")
 *    address/balance → 2 000ms (wallet detail is less time-sensitive)
 *    leaderboard     → 5 000ms
 * ═══════════════════════════════════════════════════════════════════════════ */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  hlFetch,
  type HLBlock,
  type HLTx,
  type HLAddressStats,
  type HLBalanceRPC,
  type HLLeaderEntry,
  type HLCachedResponse,
} from '@/lib/hyperliquid';

// ── Query key factory ─────────────────────────────────────────────────────────

export const hlKeys = {
  blocks:      () => ['hl', 'blocks'] as const,
  txs:         () => ['hl', 'txs'] as const,
  address:     (addr: string) => ['hl', 'address', addr.toLowerCase()] as const,
  balance:     (addr: string) => ['hl', 'balance', addr.toLowerCase()] as const,
  leaderboard: () => ['hl', 'leaderboard'] as const,
};

// ── Shared query options ──────────────────────────────────────────────────────

const BLOCK_INTERVAL  = 300;      // ms — ultra-fast poll, cached response
const ADDR_INTERVAL   = 2_000;    // ms — per-address cache window
const LEADER_INTERVAL = 5_000;    // ms

// ── useHLBlocks ───────────────────────────────────────────────────────────────

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
    staleTime: 500,               // data is "fresh" for 500ms matching edge TTL
    gcTime: 30_000,
    retry: 2,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });

  const resp = query.data as HLCachedResponse<HLBlock[]> | undefined;

  return {
    blocks:      resp?.data ?? [],
    age_ms:      resp?.age_ms,
    cached:      resp?.cached ?? false,
    stale:       resp?.stale ?? false,
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
    retry: 2,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });

  const resp = query.data as HLCachedResponse<HLTx[]> | undefined;

  return {
    txs:         resp?.data ?? [],
    age_ms:      resp?.age_ms,
    cached:      resp?.cached ?? false,
    isFirstLoad: query.isLoading,
    error:       query.error as Error | null,
  };
}

// ── useHLAddress ──────────────────────────────────────────────────────────────

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
    queryFn: ({ signal }) => hlFetch<HLAddressStats>('address', addr, signal),
    enabled: addr.length >= 10,
    staleTime: ADDR_INTERVAL,
    gcTime: 60_000,
    refetchInterval: ADDR_INTERVAL,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const resp = query.data as HLCachedResponse<HLAddressStats> | undefined;

  return {
    stats:      resp?.data ?? null,
    age_ms:     resp?.age_ms,
    cached:     resp?.cached ?? false,
    isLoading:  query.isLoading,
    isFetching: query.isFetching,
    error:      query.error as Error | null,
    refetch:    query.refetch,
  };
}

// ── useHLBalance ──────────────────────────────────────────────────────────────

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
    enabled: addr.length >= 10,
    staleTime: ADDR_INTERVAL,
    gcTime: 60_000,
    refetchInterval: ADDR_INTERVAL,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const resp = query.data as HLCachedResponse<HLBalanceRPC> | undefined;

  return {
    hexBalance: resp?.data?.result ?? null,
    age_ms:     resp?.age_ms,
    cached:     resp?.cached ?? false,
    isLoading:  query.isLoading,
    error:      query.error as Error | null,
  };
}

// ── useHLLeaderboard ──────────────────────────────────────────────────────────

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
    staleTime: LEADER_INTERVAL,
    gcTime: 60_000,
    retry: 2,
    refetchOnWindowFocus: false,
  });

  const resp = query.data as HLCachedResponse<HLLeaderEntry[]> | undefined;

  return {
    entries:     resp?.data ?? [],
    age_ms:      resp?.age_ms,
    cached:      resp?.cached ?? false,
    isFirstLoad: query.isLoading,
    error:       query.error as Error | null,
  };
}

// ── useAgeMsLive ──────────────────────────────────────────────────────────────
// Animates the "data updated Xms ago" badge without requiring a re-fetch.
// Ticks every 100ms so the number feels live.

export function useAgeMsLive(serverTs: number | undefined): number {
  const [age, setAge] = useState<number>(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!serverTs) return;

    const tick = () => {
      setAge(Date.now() - serverTs);
      rafRef.current = window.setTimeout(tick, 100);
    };
    tick();
    return () => clearTimeout(rafRef.current);
  }, [serverTs]);

  return age;
}

// ── usePrefetchHL ─────────────────────────────────────────────────────────────
// Call this when the HL Explorer tab becomes visible to warm the cache early.

export function usePrefetchHL() {
  const qc = useQueryClient();

  return useCallback(() => {
    qc.prefetchQuery({
      queryKey: hlKeys.blocks(),
      queryFn: ({ signal }) => hlFetch<HLBlock[]>('blocks', undefined, signal),
      staleTime: 500,
    });
    qc.prefetchQuery({
      queryKey: hlKeys.txs(),
      queryFn: ({ signal }) => hlFetch<HLTx[]>('txs', undefined, signal),
      staleTime: 500,
    });
  }, [qc]);
}
