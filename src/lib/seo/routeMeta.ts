/* ══ ROUTE METADATA ═══════════════════════════════════════════════════════════
 * Single source of truth for per-route <title>, description and canonical URL.
 * Consumed by <RouteSeo /> which applies these to document.head on navigation.
 */

export const SITE_NAME = 'Whale Radar';
export const SITE_ORIGIN = 'https://crypto-whale-watch-nexus.lovable.app';

/** Sitewide defaults — must stay in sync with the static tags in index.html. */
export const DEFAULT_TITLE = 'Whale Radar — Real-Time Crypto Whale Tracker';
export const DEFAULT_DESCRIPTION =
  'Track crypto whale trades live on Binance, Bybit, Solana & Hyperliquid. Free AI manipulation detection, alerts, and trading signals.';

export interface RouteMeta {
  title: string;
  description: string;
  /** Exclude from search indexes (error pages, redirects). */
  noindex?: boolean;
}

/** Exact pathname → metadata. Trailing slashes are normalised before lookup. */
export const ROUTE_META: Record<string, RouteMeta> = {
  '/': {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
  },
  '/orderflow': {
    title: 'Orderflow Pro — Whale Radar',
    description:
      'Live Binance order flow: depth ladder, bid/ask imbalance, CVD, liquidation pressure and hidden-liquidity signals in one real-time terminal.',
  },

  // ── Trading Intelligence Hub ──────────────────────────────────────────────
  '/trading-hub': {
    title: 'Trading Intelligence Hub — Whale Radar',
    description:
      'Technical analysis, backtesting, sentiment and screening for crypto markets, built on live exchange data with no simulated inputs.',
  },
  '/trading-hub/technical': {
    title: 'Technical Analysis — Whale Radar',
    description:
      'Live RSI, MACD, moving averages, Bollinger Bands and momentum readings computed from real-time crypto price data.',
  },
  '/trading-hub/backtest': {
    title: 'Strategy Backtesting — Whale Radar',
    description:
      'Backtest crypto trading strategies against historical candles and review win rate, drawdown and realised return before risking capital.',
  },
  '/trading-hub/screener': {
    title: 'Crypto Market Screener — Whale Radar',
    description:
      'Screen crypto markets by volume, volatility, momentum and manipulation risk to surface tradeable setups as they form.',
  },
  '/trading-hub/sentiment': {
    title: 'Market Sentiment — Whale Radar',
    description:
      'Track crypto market sentiment, funding rates and positioning to see when the crowd is leaning too far in one direction.',
  },
  '/trading-hub/timeframes': {
    title: 'Multi-Timeframe Analysis — Whale Radar',
    description:
      'Compare crypto trend and momentum across multiple timeframes at once to confirm setups and spot conflicting signals.',
  },
  '/trading-hub/patterns': {
    title: 'Chart Pattern Detection — Whale Radar',
    description:
      'Automatically detect breakouts, reversals and continuation patterns on live crypto charts across your watchlist.',
  },

  // ── Nexus terminal ────────────────────────────────────────────────────────
  '/nexus/whale': {
    title: 'Nexus Whale Watch — Whale Radar',
    description:
      'Watch large crypto orders hit the tape in real time across Binance, Bybit and Solana, with size thresholds you control.',
  },
  '/nexus/arbitrage': {
    title: 'Nexus Arbitrage — Whale Radar',
    description:
      'Spot live cross-exchange crypto price gaps and funding spreads, with fees and depth factored into every opportunity.',
  },
  '/nexus/grid': {
    title: 'Grid Bot Studio — Whale Radar',
    description:
      'Design and stress-test crypto grid trading strategies against live volatility before deploying them to a real account.',
  },
  '/nexus/volume': {
    title: 'Volume Maker — Whale Radar',
    description:
      'Analyse crypto volume distribution and liquidity profiles to understand where real participation sits in the book.',
  },
  '/nexus/portfolio': {
    title: 'Portfolio Tracker — Whale Radar',
    description:
      'Track crypto holdings, live P&L and position risk alongside the whale activity moving your tokens.',
  },
  '/nexus/crystal-ball': {
    title: 'Crystal Ball Forecast — Whale Radar',
    description:
      'AI-assisted crypto price scenarios built from live order flow, whale positioning and technical context.',
  },
};

/** Metadata used for unmatched routes (404). Kept out of search indexes. */
export const NOT_FOUND_META: RouteMeta = {
  title: 'Page Not Found — Whale Radar',
  description: 'The page you are looking for does not exist on Whale Radar.',
  noindex: true,
};

/** Strip trailing slash (except root) so "/orderflow/" resolves like "/orderflow". */
export function normalisePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

export function resolveRouteMeta(pathname: string): RouteMeta {
  return ROUTE_META[normalisePath(pathname)] ?? NOT_FOUND_META;
}

export function canonicalFor(pathname: string): string {
  return `${SITE_ORIGIN}${normalisePath(pathname)}`;
}
