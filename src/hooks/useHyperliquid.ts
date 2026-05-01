/* HYPERLIQUID HOOKS - FIXED
 * Now fetches real perpetual trading data from api.hyperliquid.xyz/info
 * All hooks route through hlFetch() which automatically:
 *   - Trading types → api.hyperliquid.xyz/info (POST, no auth)
 *   - Block explorer types → Supabase Edge Function → hypurrscan.io
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  hlFetch, type HLCachedResponse, type HLMarketsResponse, type HLAllMids,
  type HLFundingSnapshot, type HLL2Book, type HLClearinghouseState,
  type HLBlock, type HLTx, type HLAddressStats, type HLLeaderEntry, type HLBalanceRPC,
} from '@/lib/hyperliquid';

export const hlKeys = {
  markets: () => ['hl', 'markets'] as const,
  allMids: () => ['hl', 'allMids'] as const,
  fundingHistory: (coin: string) => ['hl', 'fundingHistory', coin.toUpperCase()] as const,
  l2Book: (coin: string) => ['hl', 'l2Book', coin.toUpperCase()] as const,
  clearinghouse: (addr: string) => ['hl', 'clearinghouse', addr.toLowerCase()] as const,
  blocks: () => ['hl', 'blocks'] as const,
  txs: () => ['hl', 'txs'] as const,
  leaderboard: () => ['hl', 'leaderboard'] as const,
  address: (addr: string) => ['hl', 'address', addr.toLowerCase()] as const,
  balance: (addr: string) => ['hl', 'balance', addr.toLowerCase()] as const,
};

const MARKETS_INTERVAL = 3000;
const MIDS_INTERVAL = 1000;
const FUNDING_INTERVAL = 5000;
const BOOK_INTERVAL = 1000;
const CLEARINGHOUSE_INTERVAL = 3000;
const BLOCKS_INTERVAL = 3000;
const TXS_INTERVAL = 3000;

// ═══════════════════════════════════════════════════════════════════════════
// TRADING DATA HOOKS (NEW)
// ═══════════════════════════════════════════════════════════════════════════

export interface HLMarketsResult {
  markets: HLMarketsResponse['markets'];
  summary: HLMarketsResponse['summary'] | null;
  age_ms: number | undefined;
  cached: boolean;
  stale: boolean;
  isFirstLoad: boolean;
  error: Error | null;
}

export function useHLMarkets(): HLMarketsResult {
  const query = useQuery({
    queryKey: hlKeys.markets(),
    queryFn: ({ signal }) => hlFetch('metaAndAssetCtxs', undefined, signal),
    refetchInterval: MARKETS_INTERVAL, staleTime: MARKETS_INTERVAL, gcTime: 60000,
    retry: 2, refetchIntervalInBackground: false, refetchOnWindowFocus: false,
  });
  const resp = query.data as HLCachedResponse<HLMarketsResponse> | undefined;
  return {
    markets: resp?.data?.markets ?? [], summary: resp?.data?.summary ?? null,
    age_ms: resp?.age_ms, cached: resp?.cached ?? false, stale: resp?.stale ?? false,
    isFirstLoad: query.isLoading, error: query.error as Error | null,
  };
}

export interface HLAllMidsResult {
  mids: HLAllMids; age_ms: number | undefined; cached: boolean;
  isFirstLoad: boolean; error: Error | null;
}

export function useHLAllMids(): HLAllMidsResult {
  const query = useQuery({
    queryKey: hlKeys.allMids(),
    queryFn: ({ signal }) => hlFetch('allMids', undefined, signal),
    refetchInterval: MIDS_INTERVAL, staleTime: MIDS_INTERVAL, gcTime: 30000,
    retry: 2, refetchIntervalInBackground: false, refetchOnWindowFocus: false,
  });
  const resp = query.data as HLCachedResponse<HLAllMids> | undefined;
  return {
    mids: resp?.data ?? {}, age_ms: resp?.age_ms, cached: resp?.cached ?? false,
    isFirstLoad: query.isLoading, error: query.error as Error | null,
  };
}

export interface HLFundingHistoryResult {
  history: HLFundingSnapshot[]; age_ms: number | undefined; cached: boolean;
  isLoading: boolean; isFetching: boolean; error: Error | null; refetch: () => void;
}

export function useHLFundingHistory(coin: string | null, startTime?: number): HLFundingHistoryResult {
  const c = coin?.toUpperCase() ?? '';
  const query = useQuery({
    queryKey: hlKeys.fundingHistory(c),
    queryFn: ({ signal }) => hlFetch('fundingHistory', c, signal, startTime),
    enabled: c.length > 0, refetchInterval: FUNDING_INTERVAL, staleTime: FUNDING_INTERVAL,
    gcTime: 120000, retry: 1, refetchOnWindowFocus: false,
  });
  const resp = query.data as HLCachedResponse<HLFundingSnapshot[]> | undefined;
  return {
    history: resp?.data ?? [], age_ms: resp?.age_ms, cached: resp?.cached ?? false,
    isLoading: query.isLoading, isFetching: query.isFetching,
    error: query.error as Error | null, refetch: query.refetch,
  };
}

export interface HLL2BookResult {
  book: HLL2Book | null; age_ms: number | undefined; cached: boolean;
  isLoading: boolean; isFetching: boolean; error: Error | null;
}

export function useHLL2Book(coin: string | null): HLL2BookResult {
  const c = coin?.toUpperCase() ?? '';
  const query = useQuery({
    queryKey: hlKeys.l2Book(c),
    queryFn: ({ signal }) => hlFetch('l2Book', c, signal),
    enabled: c.length > 0, refetchInterval: BOOK_INTERVAL, staleTime: BOOK_INTERVAL,
    gcTime: 30000, retry: 2, refetchIntervalInBackground: false, refetchOnWindowFocus: false,
  });
  const resp = query.data as HLCachedResponse<HLL2Book> | undefined;
  return {
    book: resp?.data ?? null, age_ms: resp?.age_ms, cached: resp?.cached ?? false,
    isLoading: query.isLoading, isFetching: query.isFetching, error: query.error as Error | null,
  };
}

export interface HLClearinghouseResult {
  state: HLClearinghouseState | null; age_ms: number | undefined; cached: boolean;
  isLoading: boolean; isFetching: boolean; error: Error | null; refetch: () => void;
}

export function useHLClearinghouse(address: string | null): HLClearinghouseResult {
  const addr = address?.trim().toLowerCase() ?? '';
  const query = useQuery({
    queryKey: hlKeys.clearinghouse(addr),
    queryFn: ({ signal }) => hlFetch('clearinghouse', addr, signal),
    enabled: addr.length >= 10, staleTime: CLEARINGHOUSE_INTERVAL, gcTime: 60000,
    refetchInterval: CLEARINGHOUSE_INTERVAL, retry: 1, refetchOnWindowFocus: false,
  });
  const resp = query.data as HLCachedResponse<HLClearinghouseState> | undefined;
  return {
    state: resp?.data ?? null, age_ms: resp?.age_ms, cached: resp?.cached ?? false,
    isLoading: query.isLoading, isFetching: query.isFetching,
    error: query.error as Error | null, refetch: query.refetch,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// BLOCK EXPLORER HOOKS (UNCHANGED)
// ═══════════════════════════════════════════════════════════════════════════

export interface HLBlocksResult {
  blocks: HLBlock[]; age_ms: number | undefined; cached: boolean;
  isFirstLoad: boolean; error: Error | null;
}

export function useHLBlocks(): HLBlocksResult {
  const query = useQuery({
    queryKey: hlKeys.blocks(),
    queryFn: ({ signal }) => hlFetch('blocks', undefined, signal),
    refetchInterval: BLOCKS_INTERVAL, staleTime: BLOCKS_INTERVAL, gcTime: 60000,
    retry: 2, refetchIntervalInBackground: false, refetchOnWindowFocus: false,
  });
  const resp = query.data as HLCachedResponse<HLBlock[]> | undefined;
  return {
    blocks: resp?.data ?? [], age_ms: resp?.age_ms, cached: resp?.cached ?? false,
    isFirstLoad: query.isLoading, error: query.error as Error | null,
  };
}

export interface HLTxsResult {
  txs: HLTx[]; age_ms: number | undefined; cached: boolean;
  isFirstLoad: boolean; error: Error | null;
}

export function useHLTxs(): HLTxsResult {
  const query = useQuery({
    queryKey: hlKeys.txs(),
    queryFn: ({ signal }) => hlFetch('txs', undefined, signal),
    refetchInterval: TXS_INTERVAL, staleTime: TXS_INTERVAL, gcTime: 60000,
    retry: 2, refetchIntervalInBackground: false, refetchOnWindowFocus: false,
  });
  const resp = query.data as HLCachedResponse<HLTx[]> | undefined;
  return {
    txs: resp?.data ?? [], age_ms: resp?.age_ms, cached: resp?.cached ?? false,
    isFirstLoad: query.isLoading, error: query.error as Error | null,
  };
}

export interface HLLeaderboardResult {
  entries: HLLeaderEntry[]; age_ms: number | undefined; cached: boolean;
  isFirstLoad: boolean; error: Error | null;
}

export function useHLLeaderboard(): HLLeaderboardResult {
  const query = useQuery({
    queryKey: hlKeys.leaderboard(),
    queryFn: ({ signal }) => hlFetch('leaderboard', undefined, signal),
    refetchInterval: 10000, staleTime: 10000, gcTime: 120000,
    retry: 2, refetchOnWindowFocus: false,
  });
  const resp = query.data as HLCachedResponse<HLLeaderEntry[]> | undefined;
  return {
    entries: resp?.data ?? [], age_ms: resp?.age_ms, cached: resp?.cached ?? false,
    isFirstLoad: query.isLoading, error: query.error as Error | null,
  };
}

export interface HLAddressResult {
  stats: HLAddressStats | null; age_ms: number | undefined; cached: boolean;
  isLoading: boolean; isFetching: boolean; error: Error | null;
}

export function useHLAddress(address: string | null): HLAddressResult {
  const addr = address?.trim().toLowerCase() ?? '';
  const query = useQuery({
    queryKey: hlKeys.address(addr),
    queryFn: ({ signal }) => hlFetch('address', addr, signal),
    enabled: addr.length >= 10, staleTime: 5000, gcTime: 60000,
    retry: 1, refetchOnWindowFocus: false,
  });
  const resp = query.data as HLCachedResponse<HLAddressStats> | undefined;
  return {
    stats: resp?.data ?? null, age_ms: resp?.age_ms, cached: resp?.cached ?? false,
    isLoading: query.isLoading, isFetching: query.isFetching, error: query.error as Error | null,
  };
}

export interface HLBalanceResult {
  balance: string | null; age_ms: number | undefined; cached: boolean;
  isLoading: boolean; isFetching: boolean; error: Error | null;
}

export function useHLBalance(address: string | null): HLBalanceResult {
  const addr = address?.trim().toLowerCase() ?? '';
  const query = useQuery({
    queryKey: hlKeys.balance(addr),
    queryFn: ({ signal }) => hlFetch('balance', addr, signal),
    enabled: addr.length >= 10, staleTime: 5000, gcTime: 60000,
    retry: 1, refetchOnWindowFocus: false,
  });
  const resp = query.data as HLCachedResponse<HLBalanceRPC> | undefined;
  return {
    balance: resp?.data?.result ?? null, age_ms: resp?.age_ms, cached: resp?.cached ?? false,
    isLoading: query.isLoading, isFetching: query.isFetching, error: query.error as Error | null,
  };
}

export function useAgeMsLive(serverTs: number | undefined): number {
  const [age, setAge] = useState(0);
  const rafRef = useRef(0);
  useEffect(() => {
    if (!serverTs) return;
    const tick = () => { setAge(Date.now() - serverTs); rafRef.current = window.setTimeout(tick, 100); };
    tick();
    return () => clearTimeout(rafRef.current);
  }, [serverTs]);
  return age;
}

export function usePrefetchHL() {
  const qc = useQueryClient();
  return useCallback(() => {
    qc.prefetchQuery({ queryKey: hlKeys.markets(), queryFn: ({ signal }) => hlFetch('metaAndAssetCtxs', undefined, signal), staleTime: MARKETS_INTERVAL });
    qc.prefetchQuery({ queryKey: hlKeys.allMids(), queryFn: ({ signal }) => hlFetch('allMids', undefined, signal), staleTime: MIDS_INTERVAL });
  }, [qc]);
}
