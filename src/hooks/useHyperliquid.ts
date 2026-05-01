/* ══ HYPERLIQUID — TanStack Query Hooks ══════════════════════════════════════
 * FIX: Was fetching blocks/txs/leaderboard (block explorer data — useless for
 *      the Whale Watch dashboard). Now fetches real perpetual trading data.
 *
 * All hooks fetch ONLY from the Supabase Edge Function cache.
 * Pattern: stale-while-revalidate with per-type intervals matching edge TTLs.
 *
 * Poll intervals (match edge function TTL_MAP):
 *   metaAndAssetCtxs → 3 000ms  ← main dashboard (prices, funding, OI)
 *   allMids          → 1 000ms  ← fast mid-price ticker
 *   fundingHistory   → 5 000ms  ← per-coin hourly history
 *   l2Book           → 1 000ms  ← per-coin order book
 *   clearinghouse    → 3 000ms  ← per-address account state
 * ═══════════════════════════════════════════════════════════════════════════ */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  hlFetch,
  type HLMarket,
  type HLSummary,
  type HLMarketsResponse,
  type HLAllMids,
  type HLFundingSnapshot,
  type HLL2Book,
  type HLClearinghouseState,
  type HLCachedResponse,
} from '@/lib/hyperliquid';

// ── Query key factory ─────────────────────────────────────────────────────────

export const hlKeys = {
  markets:        ()           => ['hl', 'markets']                         as const,
  allMids:        ()           => ['hl', 'allMids']                         as const,
  fundingHistory: (coin: string) => ['hl', 'fundingHistory', coin.toUpperCase()] as const,
  l2Book:         (coin: string) => ['hl', 'l2Book',         coin.toUpperCase()] as const,
  clearinghouse:  (addr: string) => ['hl', 'clearinghouse',  addr.toLowerCase()] as const,
};

// ── Poll intervals ────────────────────────────────────────────────────────────

const MARKETS_INTERVAL     = 3_000;
const MIDS_INTERVAL        = 1_000;
const FUNDING_INTERVAL     = 5_000;
const BOOK_INTERVAL        = 1_000;
const CLEARINGHOUSE_INTERVAL = 3_000;

// ─────────────────────────────────────────────────────────────────────────────
// useHLMarkets
// Powers all four summary cards + the Hyperliquid Perpetuals table.
// Returns merged markets array + aggregate summary from metaAndAssetCtxs.
// ─────────────────────────────────────────────────────────────────────────────

export interface HLMarketsResult {
  markets:      HLMarket[];
  summary:      HLSummary | null;
  age_ms:       number | undefined;
  cached:       boolean;
  stale:        boolean;
  isFirstLoad:  boolean;
  error:        Error | null;
}

export function useHLMarkets(): HLMarketsResult {
  const query = useQuery({
    queryKey: hlKeys.markets(),
    queryFn:  ({ signal }) =>
      hlFetch<HLMarketsResponse>('metaAndAssetCtxs', undefined, signal),
    refetchInterval:            MARKETS_INTERVAL,
    staleTime:                  MARKETS_INTERVAL,
    gcTime:                     60_000,
    retry:                      2,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus:        false,
  });

  const resp = query.data as HLCachedResponse<HLMarketsResponse> | undefined;

  return {
    markets:     resp?.data?.markets  ?? [],
    summary:     resp?.data?.summary  ?? null,
    age_ms:      resp?.age_ms,
    cached:      resp?.cached  ?? false,
    stale:       resp?.stale   ?? false,
    isFirstLoad: query.isLoading,
    error:       query.error as Error | null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// useHLAllMids
// Fast-polling mid prices for every perp asset.
// Returns a plain object: { BTC: "104200.5", ETH: "2510.0", ... }
// ─────────────────────────────────────────────────────────────────────────────

export interface HLAllMidsResult {
  mids:        HLAllMids;
  age_ms:      number | undefined;
  cached:      boolean;
  isFirstLoad: boolean;
  error:       Error | null;
}

export function useHLAllMids(): HLAllMidsResult {
  const query = useQuery({
    queryKey: hlKeys.allMids(),
    queryFn:  ({ signal }) =>
      hlFetch<HLAllMids>('allMids', undefined, signal),
    refetchInterval:            MIDS_INTERVAL,
    staleTime:                  MIDS_INTERVAL,
    gcTime:                     30_000,
    retry:                      2,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus:        false,
  });

  const resp = query.data as HLCachedResponse<HLAllMids> | undefined;

  return {
    mids:        resp?.data ?? {},
    age_ms:      resp?.age_ms,
    cached:      resp?.cached ?? false,
    isFirstLoad: query.isLoading,
    error:       query.error as Error | null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// useHLFundingHistory
// Hourly funding rate history for a single coin.
// Pass startTime in ms — defaults to 24h ago if omitted.
// ─────────────────────────────────────────────────────────────────────────────

export interface HLFundingHistoryResult {
  history:    HLFundingSnapshot[];
  age_ms:     number | undefined;
  cached:     boolean;
  isLoading:  boolean;
  isFetching: boolean;
  error:      Error | null;
  refetch:    () => void;
}

export function useHLFundingHistory(
  coin: string | null,
  startTime?: number,
): HLFundingHistoryResult {
  const c = coin?.toUpperCase() ?? '';

  const query = useQuery({
    queryKey: hlKeys.fundingHistory(c),
    queryFn:  ({ signal }) =>
      hlFetch<HLFundingSnapshot[]>(
        'fundingHistory',
        c,
        signal,
        startTime,
      ),
    enabled:        c.length > 0,
    refetchInterval: FUNDING_INTERVAL,
    staleTime:       FUNDING_INTERVAL,
    gcTime:          120_000,
    retry:           1,
    refetchOnWindowFocus: false,
  });

  const resp = query.data as HLCachedResponse<HLFundingSnapshot[]> | undefined;

  return {
    history:    resp?.data ?? [],
    age_ms:     resp?.age_ms,
    cached:     resp?.cached    ?? false,
    isLoading:  query.isLoading,
    isFetching: query.isFetching,
    error:      query.error as Error | null,
    refetch:    query.refetch,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// useHLL2Book
// Live L2 order book for a single coin.
// ─────────────────────────────────────────────────────────────────────────────

export interface HLL2BookResult {
  book:       HLL2Book | null;
  age_ms:     number | undefined;
  cached:     boolean;
  isLoading:  boolean;
  isFetching: boolean;
  error:      Error | null;
}

export function useHLL2Book(coin: string | null): HLL2BookResult {
  const c = coin?.toUpperCase() ?? '';

  const query = useQuery({
    queryKey: hlKeys.l2Book(c),
    queryFn:  ({ signal }) =>
      hlFetch<HLL2Book>('l2Book', c, signal),
    enabled:             c.length > 0,
    refetchInterval:     BOOK_INTERVAL,
    staleTime:           BOOK_INTERVAL,
    gcTime:              30_000,
    retry:               2,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });

  const resp = query.data as HLCachedResponse<HLL2Book> | undefined;

  return {
    book:       resp?.data ?? null,
    age_ms:     resp?.age_ms,
    cached:     resp?.cached    ?? false,
    isLoading:  query.isLoading,
    isFetching: query.isFetching,
    error:      query.error as Error | null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// useHLClearinghouse
// Perpetual account state for a wallet address.
// Returns positions, margin summary, withdrawable balance, etc.
// ─────────────────────────────────────────────────────────────────────────────

export interface HLClearinghouseResult {
  state:      HLClearinghouseState | null;
  age_ms:     number | undefined;
  cached:     boolean;
  isLoading:  boolean;
  isFetching: boolean;
  error:      Error | null;
  refetch:    () => void;
}

export function useHLClearinghouse(address: string | null): HLClearinghouseResult {
  const addr = address?.trim().toLowerCase() ?? '';

  const query = useQuery({
    queryKey: hlKeys.clearinghouse(addr),
    queryFn:  ({ signal }) =>
      hlFetch<HLClearinghouseState>('clearinghouse', addr, signal),
    enabled:         addr.length >= 10,
    staleTime:       CLEARINGHOUSE_INTERVAL,
    gcTime:          60_000,
    refetchInterval: CLEARINGHOUSE_INTERVAL,
    retry:           1,
    refetchOnWindowFocus: false,
  });

  const resp = query.data as HLCachedResponse<HLClearinghouseState> | undefined;

  return {
    state:      resp?.data ?? null,
    age_ms:     resp?.age_ms,
    cached:     resp?.cached    ?? false,
    isLoading:  query.isLoading,
    isFetching: query.isFetching,
    error:      query.error as Error | null,
    refetch:    query.refetch,
  };
}

// ── useAgeMsLive ──────────────────────────────────────────────────────────────
// Animates the "data updated Xms ago" badge without requiring a re-fetch.
// Ticks every 100ms so the number feels live. (UNCHANGED)

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
// Call when the Whale Watch tab becomes visible to warm the cache early.

export function usePrefetchHL() {
  const qc = useQueryClient();

  return useCallback(() => {
    qc.prefetchQuery({
      queryKey: hlKeys.markets(),
      queryFn:  ({ signal }) =>
        hlFetch<HLMarketsResponse>('metaAndAssetCtxs', undefined, signal),
      staleTime: MARKETS_INTERVAL,
    });
    qc.prefetchQuery({
      queryKey: hlKeys.allMids(),
      queryFn:  ({ signal }) =>
        hlFetch<HLAllMids>('allMids', undefined, signal),
      staleTime: MIDS_INTERVAL,
    });
  }, [qc]);
}
