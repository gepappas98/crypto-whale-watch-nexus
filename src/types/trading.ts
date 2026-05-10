// Live trading bridge response types — match the Deno edge function exactly.

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }

export interface TechnicalAnalysis {
  symbol: string;
  timeframe: string;
  price: number;
  timestamp: number;
  rsi: { value: number; signal: "OVERSOLD" | "OVERBOUGHT" | "NEUTRAL" };
  macd: {
    line: number; signal: number; hist: number;
    histSeries: number[];
    goldenCross: boolean; deathCross: boolean;
  };
  bollinger: {
    upper: number; mid: number; lower: number;
    pctB: number; rating: number; squeeze: boolean; width: number;
  };
  ema: {
    ema20: number; ema50: number; ema200: number;
    bullish: boolean; goldenCross: boolean; deathCross: boolean;
  };
  supertrend: { direction: "UPTREND" | "DOWNTREND"; value: number; atr: number };
  overall: { signal: string; confidence: number; bullVotes: number; bearVotes: number; totalVotes: number };
  support: number;
  resistance: number;
}

export interface BacktestTrade {
  entryDate: number; exitDate: number; type: "LONG";
  entry: number; exit: number; pnl: number; ret: number;
}

export interface BacktestResult {
  strategy: string;
  initialCapital: number;
  finalEquity: number;
  totalReturn: number;
  winRate: number;
  sharpe: number;
  calmar: number;
  maxDrawdown: number;
  profitFactor: number;
  expectancy: number;
  bestTrade: number;
  worstTrade: number;
  tradeCount: number;
  buyHoldReturn: number;
  outperformance: number;
  equity: { t: number; v: number }[];
  trades: BacktestTrade[];
}

export interface MarketSnapshotItem {
  symbol: string; label: string;
  price?: number; change?: number; changePct?: number;
  spark?: number[]; timestamp?: number; error?: string;
}

export interface SentimentResult {
  symbol: string;
  score: number;
  label: string;
  postsAnalyzed: number;
  bullishHits: number;
  bearishHits: number;
  topPosts: { title: string; url: string; score: number; created: number; sentiment: string }[];
  timestamp: number;
}

export interface NewsItem {
  title: string; url: string; source: string;
  published: number; sentiment: "Positive" | "Negative" | "Neutral";
}

export interface ScreenerRow {
  symbol: string; exchange: string;
  price: number; change24h: number; volume: number;
  rsi: number; macdHist: number; bollingerRating: number;
  signal: string;
}

export interface PatternHit {
  name: string; type: "Bullish" | "Bearish" | "Neutral";
  confidence: number; index: number; time: number;
  miniChart: Candle[];
}

export interface MultiTimeframeRow {
  timeframe: string;
  trend?: "UPTREND" | "DOWNTREND";
  rsi?: number; macdHist?: number; signal?: string;
  support?: number; resistance?: number; price?: number;
  error?: string;
}

export interface CombinedAnalysis {
  symbol: string;
  verdict: string;
  confidence: number;
  breakdown: { technical: string; sentiment: string; news: string };
  mixed: boolean;
  technical: TechnicalAnalysis;
  sentiment: SentimentResult;
  news: NewsItem[];
}

export interface YahooQuote {
  symbol: string; price: number; change: number; changePct: number;
  timestamp: number; spark: number[];
}
