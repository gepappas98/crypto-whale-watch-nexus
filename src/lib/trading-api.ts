// Trading Bridge API client — calls the Lovable Cloud edge function.
// Every function returns LIVE data from the Deno bridge. No fallbacks.

import { supabase } from "@/integrations/supabase/client";
import type {
  TechnicalAnalysis, BacktestResult, MarketSnapshotItem, SentimentResult,
  NewsItem, ScreenerRow, PatternHit, MultiTimeframeRow, CombinedAnalysis, YahooQuote,
} from "@/types/trading";

const FN = "trading-bridge";

async function call<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke(`${FN}${path}`, {
    body,
  });
  if (error) throw new Error(error.message ?? String(error));
  if (data && typeof data === "object" && "error" in data) {
    throw new Error(String((data as any).error));
  }
  return data as T;
}

export const tradingApi = {
  technical: (symbol: string, timeframe = "1D") =>
    call<TechnicalAnalysis>("/technical-analysis", { symbol, timeframe }),

  multiple: (symbols: string[], timeframe = "1D") =>
    call<TechnicalAnalysis[]>("/multiple-analysis", { symbols, timeframe }),

  bollinger: (symbol: string, timeframe = "1D") =>
    call<TechnicalAnalysis["bollinger"] & { symbol: string; price: number }>(
      "/bollinger-analysis", { symbol, timeframe },
    ),

  backtest: (params: { symbol: string; strategy: string; period: string; capital: number; commission: number }) =>
    call<BacktestResult>("/backtest", params),

  compareStrategies: (symbol: string, period = "1y", capital = 10000, commission = 0.1) =>
    call<{ symbol: string; period: string; results: Array<{ strategy: string; totalReturn: number; sharpe: number; winRate: number; maxDrawdown: number; tradeCount: number }> }>(
      "/compare-strategies", { symbol, period, capital, commission },
    ),

  marketSnapshot: () =>
    call<{ items: MarketSnapshotItem[]; timestamp: number }>("/market-snapshot"),

  sentiment: (symbol: string) =>
    call<SentimentResult>("/sentiment", { symbol }),

  news: (symbol?: string) =>
    call<{ items: NewsItem[]; timestamp: number }>("/news", { symbol }),

  combined: (symbol: string, timeframe = "1D") =>
    call<CombinedAnalysis>("/combined-analysis", { symbol, timeframe }),

  screener: (filters: Record<string, unknown> = {}) =>
    call<{ items: ScreenerRow[]; timestamp: number }>("/screener", { filters }),

  scanSignal: (signal_type: string) =>
    call<{ items: ScreenerRow[]; timestamp: number }>("/scan-signal", { signal_type }),

  patterns: (symbol: string, timeframe = "1D") =>
    call<{ symbol: string; patterns: PatternHit[]; timestamp: number }>("/candlestick-patterns", { symbol, timeframe }),

  multiTimeframe: (symbol: string) =>
    call<{ symbol: string; timeframes: MultiTimeframeRow[]; alignment: string; timestamp: number }>("/multi-timeframe", { symbol }),

  yahooPrice: (symbol: string) =>
    call<YahooQuote>("/yahoo-price", { symbol }),
};

export const REFRESH = {
  market: 15_000,
  technical: 30_000,
  sentiment: 120_000,
  news: 120_000,
  screener: 60_000,
  patterns: 300_000,
  multiTimeframe: 60_000,
};
