/* ══ REGIME ENGINE — signal collection ═════════════════════════════════════
 *  Every input here is real, already-available market data. Nothing is
 *  invented or simulated: if an upstream read fails, the signal's score is
 *  null and it drops out of the weighted average instead of faking neutral.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { proxied } from '@/lib/binanceProxy';
import type { RegimeSignal } from './types';

const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));

async function getJson<T>(url: string, timeoutMs = 12_000): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(proxied(url), { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

const pct = (n: number, d = 1) => `${n >= 0 ? '+' : ''}${n.toFixed(d)}%`;

/* ── BTC trend + momentum (daily closes) ─────────────────────────────────── */
async function btcTrendSignals(): Promise<RegimeSignal[]> {
  const raw = await getJson<unknown[][]>('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=260');
  const closes = (raw ?? []).map((c) => Number(c[4])).filter(Number.isFinite);
  if (closes.length < 60) {
    return [
      { id: 'btc_trend', label: 'BTC trend (EMA50/200)', score: null, value: '—', detail: 'BTC daily candles unavailable' },
      { id: 'btc_momentum', label: 'BTC momentum (EMA50 slope)', score: null, value: '—', detail: 'BTC daily candles unavailable' },
    ];
  }
  const price = closes[closes.length - 1];
  const e50 = ema(closes, 50);
  const e200 = closes.length >= 200 ? ema(closes, 200) : null;
  const ema50 = e50[e50.length - 1];
  const ema200 = e200 ? e200[e200.length - 1] : null;
  const distPct = (price / ema50 - 1) * 100;
  const cross = ema200 == null ? 0 : ema50 > ema200 ? 1 : -1;
  const trendScore = clamp(0.6 * clamp(distPct / 6) + 0.4 * cross);

  const slopeRef = e50[Math.max(0, e50.length - 11)];
  const slopePct = (ema50 / slopeRef - 1) * 100;

  return [
    {
      id: 'btc_trend',
      label: 'BTC trend (EMA50/200)',
      score: trendScore,
      value: `${pct(distPct)} vs EMA50`,
      detail:
        ema200 == null
          ? `BTC is ${pct(distPct)} from its 50-day EMA (200-day history incomplete)`
          : `BTC is ${pct(distPct)} from its 50-day EMA and the 50 EMA is ${ema50 > ema200 ? 'above' : 'below'} the 200 EMA`,
    },
    {
      id: 'btc_momentum',
      label: 'BTC momentum (EMA50 slope)',
      score: clamp(slopePct / 3),
      value: `${pct(slopePct, 2)} / 10d`,
      detail: `The 50-day EMA itself has moved ${pct(slopePct, 2)} over the last 10 days`,
    },
  ];
}

/* ── Derivatives: open interest rate-of-change + funding ─────────────────── */
async function derivativeSignals(): Promise<RegimeSignal[]> {
  const [oi, prem] = await Promise.all([
    getJson<{ sumOpenInterest: string }[]>(
      'https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=1h&limit=24',
    ),
    getJson<{ lastFundingRate: string }>('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT'),
  ]);

  let oiSignal: RegimeSignal = {
    id: 'oi_roc',
    label: 'Open interest (24h ROC)',
    score: null,
    value: '—',
    detail: 'Binance futures open-interest history unavailable',
  };
  if (oi && oi.length >= 2) {
    const first = Number(oi[0].sumOpenInterest);
    const last = Number(oi[oi.length - 1].sumOpenInterest);
    if (first > 0 && Number.isFinite(last)) {
      const roc = (last / first - 1) * 100;
      oiSignal = {
        id: 'oi_roc',
        label: 'Open interest (24h ROC)',
        score: clamp(roc / 6),
        value: pct(roc),
        detail: `BTC perp open interest is ${roc >= 0 ? 'building' : 'unwinding'} — ${pct(roc)} over 24h`,
      };
    }
  }

  let fundSignal: RegimeSignal = {
    id: 'funding',
    label: 'Funding rate',
    score: null,
    value: '—',
    detail: 'Binance futures funding rate unavailable',
  };
  if (prem) {
    const rate = Number(prem.lastFundingRate) * 100; // percent per 8h
    if (Number.isFinite(rate)) {
      // Mildly positive funding is healthy trend participation; extreme
      // positive is crowded leverage, which reads late-cycle, not bullish.
      const score = rate <= 0 ? clamp(rate / 0.02) : rate <= 0.03 ? clamp(rate / 0.03) : clamp(1 - (rate - 0.03) / 0.04);
      fundSignal = {
        id: 'funding',
        label: 'Funding rate',
        score,
        value: `${rate.toFixed(4)}%/8h`,
        detail:
          rate > 0.05
            ? `Funding at ${rate.toFixed(4)}%/8h — longs are crowded and paying up (late-cycle read)`
            : rate < 0
              ? `Funding is negative (${rate.toFixed(4)}%/8h) — shorts are paying, positioning is bearish`
              : `Funding at ${rate.toFixed(4)}%/8h — healthy long participation without crowding`,
      };
    }
  }

  return [oiSignal, fundSignal];
}

/* ── Aggressive spot flow on BTC (taker buy vs sell notional) ────────────── */
async function aggressiveFlowSignal(): Promise<RegimeSignal> {
  const trades = await getJson<{ p: string; q: string; m: boolean }[]>(
    'https://api.binance.com/api/v3/aggTrades?symbol=BTCUSDT&limit=1000',
  );
  if (!trades || trades.length < 50) {
    return {
      id: 'aggressive_flow',
      label: 'Aggressive BTC flow',
      score: null,
      value: '—',
      detail: 'Binance aggregate trades unavailable',
    };
  }
  let buy = 0;
  let sell = 0;
  for (const t of trades) {
    const usd = Number(t.p) * Number(t.q);
    if (!Number.isFinite(usd)) continue;
    if (t.m) sell += usd;
    else buy += usd;
  }
  const total = buy + sell;
  if (total <= 0) {
    return { id: 'aggressive_flow', label: 'Aggressive BTC flow', score: null, value: '—', detail: 'No trade notional' };
  }
  const imbalance = (buy - sell) / total;
  return {
    id: 'aggressive_flow',
    label: 'Aggressive BTC flow',
    score: clamp(imbalance * 4),
    value: `${(imbalance * 100).toFixed(1)}% ${imbalance >= 0 ? 'buy' : 'sell'}`,
    detail: `Market-order flow on BTC is ${Math.abs(imbalance * 100).toFixed(1)}% skewed to the ${imbalance >= 0 ? 'buy' : 'sell'} side over the last 1000 trades`,
  };
}

/* ── Fear & Greed (level + rate of change) ───────────────────────────────── */
async function sentimentSignals(): Promise<RegimeSignal[]> {
  const fng = await getJson<{ data?: { value: string }[] }>('https://api.alternative.me/fng/?limit=8');
  const series = (fng?.data ?? []).map((d) => Number(d.value)).filter(Number.isFinite);
  if (!series.length) {
    return [
      { id: 'fng_level', label: 'Fear & Greed level', score: null, value: '—', detail: 'Fear & Greed index unavailable' },
      { id: 'fng_roc', label: 'Fear & Greed 7d change', score: null, value: '—', detail: 'Fear & Greed index unavailable' },
    ];
  }
  const now = series[0];
  // Greed is bullish up to a point; extreme greed (>80) is a late-cycle read.
  const level = now <= 50 ? (now - 50) / 50 : now <= 80 ? (now - 50) / 30 : clamp(1 - (now - 80) / 12);
  const prev = series[series.length - 1];
  const roc = now - prev;

  return [
    {
      id: 'fng_level',
      label: 'Fear & Greed level',
      score: clamp(level),
      value: String(now),
      detail:
        now > 80
          ? `Fear & Greed at ${now} — extreme greed, historically a late-cycle condition`
          : `Fear & Greed at ${now} (${now >= 50 ? 'greed' : 'fear'} side of neutral)`,
    },
    {
      id: 'fng_roc',
      label: 'Fear & Greed 7d change',
      score: clamp(roc / 20),
      value: `${roc >= 0 ? '+' : ''}${roc.toFixed(0)} pts`,
      detail: `Sentiment has moved ${roc >= 0 ? 'up' : 'down'} ${Math.abs(roc).toFixed(0)} points over ~7 days (${prev} → ${now})`,
    },
  ];
}

/* ── BTC dominance trend (needs its own local history) ───────────────────── */
const DOM_KEY = 'wr_regime_dominance_history';
type DomPoint = { ts: number; dom: number };

function readDomHistory(): DomPoint[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DOM_KEY) ?? '[]') as DomPoint[];
    return Array.isArray(raw) ? raw.filter((p) => typeof p?.dom === 'number') : [];
  } catch {
    return [];
  }
}

async function dominanceSignal(): Promise<RegimeSignal> {
  const global = await getJson<{ data?: { market_cap_percentage?: Record<string, number> } }>(
    'https://api.coingecko.com/api/v3/global',
  );
  const dom = global?.data?.market_cap_percentage?.btc;
  if (typeof dom !== 'number') {
    return { id: 'btc_dominance', label: 'BTC dominance trend', score: null, value: '—', detail: 'CoinGecko global data unavailable' };
  }

  const cutoff = Date.now() - 7 * 24 * 3_600_000;
  const history = [...readDomHistory().filter((p) => p.ts > cutoff), { ts: Date.now(), dom }].slice(-500);
  try {
    localStorage.setItem(DOM_KEY, JSON.stringify(history));
  } catch {
    /* ignore */
  }

  // Compare against the oldest point at least 6h old; until we have one, the
  // signal is honestly unavailable rather than a guessed zero.
  const ref = history.find((p) => Date.now() - p.ts >= 6 * 3_600_000);
  if (!ref) {
    return {
      id: 'btc_dominance',
      label: 'BTC dominance trend',
      score: null,
      value: `${dom.toFixed(2)}%`,
      detail: 'Building dominance history — needs 6h of samples before it can read a trend',
    };
  }
  const delta = dom - ref.dom;
  return {
    id: 'btc_dominance',
    label: 'BTC dominance trend',
    score: clamp(-delta / 1.5),
    value: `${dom.toFixed(2)}% (${delta >= 0 ? '+' : ''}${delta.toFixed(2)})`,
    detail: `BTC dominance is ${delta <= 0 ? 'falling' : 'rising'} (${delta >= 0 ? '+' : ''}${delta.toFixed(2)} pts) — capital is rotating ${delta <= 0 ? 'into alts' : 'back into BTC'}`,
  };
}

/* ── Stablecoin supply flow (needs its own local history) ─────────────────
 *  Closes the "stablecoin/liquidity flow" P1 item from the README's
 *  Strategic Direction section. Total stablecoin market cap is the closest
 *  thing crypto has to an on-chain "dry powder" gauge: net issuance
 *  (Tether/Circle minting more USDT/USDC) means fresh capital is entering
 *  the ecosystem and sitting ready to buy; net redemption means capital is
 *  actively leaving crypto altogether, not just rotating between coins
 *  inside it — a meaningfully different read than BTC dominance or
 *  ETH/BTC strength, both of which only capture rotation *within* the
 *  market. Same local-history technique as dominanceSignal() above, since
 *  CoinGecko doesn't expose a ready-made "growth" number to read directly. */
const STABLE_KEY = 'wr_regime_stablecoin_history';
type StablePoint = { ts: number; mcap: number };

function readStableHistory(): StablePoint[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STABLE_KEY) ?? '[]') as StablePoint[];
    return Array.isArray(raw) ? raw.filter((p) => typeof p?.mcap === 'number') : [];
  } catch {
    return [];
  }
}

async function stablecoinFlowSignal(): Promise<RegimeSignal> {
  const raw = await getJson<{ market_cap?: number }[]>(
    'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=stablecoins&order=market_cap_desc&per_page=100&page=1',
  );
  const mcap = (raw ?? []).reduce((sum, c) => sum + (typeof c.market_cap === 'number' ? c.market_cap : 0), 0);
  if (!raw || raw.length === 0 || mcap <= 0) {
    return {
      id: 'stablecoin_flow',
      label: 'Stablecoin supply flow',
      score: null,
      value: '—',
      detail: 'CoinGecko stablecoins category data unavailable',
    };
  }

  const cutoff = Date.now() - 8 * 24 * 3_600_000;
  const history = [...readStableHistory().filter((p) => p.ts > cutoff), { ts: Date.now(), mcap }].slice(-500);
  try {
    localStorage.setItem(STABLE_KEY, JSON.stringify(history));
  } catch {
    /* ignore */
  }

  // Compare against the oldest point at least 24h old — net issuance is a
  // slower-moving, noisier-at-short-horizons metric than dominance, so a
  // same-day reference (like dominance's 6h) would mostly capture exchange
  // reserve noise rather than real minting/redemption. Until we have one,
  // honestly unavailable rather than a guessed zero.
  const ref = history.find((p) => Date.now() - p.ts >= 24 * 3_600_000);
  if (!ref) {
    return {
      id: 'stablecoin_flow',
      label: 'Stablecoin supply flow',
      score: null,
      value: `$${(mcap / 1e9).toFixed(1)}B`,
      detail: 'Building stablecoin supply history — needs 24h of samples before it can read a trend',
    };
  }
  const pctChange = (mcap / ref.mcap - 1) * 100;
  return {
    id: 'stablecoin_flow',
    label: 'Stablecoin supply flow',
    // Scaled so a ~2% total-supply move over 24h — genuinely large net
    // minting/redemption, not routine noise — saturates the signal.
    // Day-to-day noise on a multi-hundred-billion-dollar aggregate is
    // typically well under 0.5%, so a tighter divisor here would mean
    // ordinary noise saturates the score every tick, making this a useless
    // always-±1 flag instead of a real weighted contributor.
    score: clamp(pctChange / 2),
    value: `$${(mcap / 1e9).toFixed(1)}B (${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(2)}%)`,
    detail: `Total stablecoin supply is ${pctChange >= 0 ? 'up' : 'down'} ${Math.abs(pctChange).toFixed(2)}% over ~24h ($${(mcap / 1e9).toFixed(1)}B total) — ${pctChange >= 0 ? 'fresh capital is entering crypto' : 'capital is leaving crypto, not just rotating within it'}`,
  };
}

/* ── ETH/BTC relative strength ────────────────────────────────────────────
 *  Closes the "BTC/ETH relative strength" P1 item from the README's
 *  Strategic Direction section. A second, independent rotation read
 *  alongside BTC dominance: dominance is BTC vs the *whole* market's total
 *  cap (can move on a stablecoin or altcoin-basket effect); this is BTC vs
 *  specifically ETH, the market's #2 asset and the closest thing crypto has
 *  to a risk-on/risk-off bellwether pair. Both belong to the same "rotation"
 *  family (see families.ts) since they're both answers to "which asset is
 *  capital moving into," just measured against a different denominator. */
async function ethBtcStrengthSignal(): Promise<RegimeSignal> {
  const raw = await getJson<unknown[][]>('https://api.binance.com/api/v3/klines?symbol=ETHBTC&interval=1d&limit=10');
  const closes = (raw ?? []).map((c) => Number(c[4])).filter(Number.isFinite);
  if (closes.length < 8) {
    return {
      id: 'eth_btc_strength',
      label: 'ETH/BTC relative strength',
      score: null,
      value: '—',
      detail: 'ETHBTC daily candles unavailable',
    };
  }
  const now = closes[closes.length - 1];
  const weekAgo = closes[closes.length - 8];
  const pctChange = (now / weekAgo - 1) * 100;
  return {
    id: 'eth_btc_strength',
    label: 'ETH/BTC relative strength',
    score: clamp(pctChange / 4),
    value: `${pct(pctChange)} / 7d`,
    detail: `ETH/BTC is ${pct(pctChange)} over the last 7 days — capital is rotating ${pctChange >= 0 ? 'into ETH (and, historically, alts more broadly)' : 'back into BTC'}`,
  };
}

/* ── Local inputs: breadth + whale flow (already in the app's own state) ─── */
export interface LocalInputs {
  /** Live scanner rows — used for market breadth. */
  coins: { change: number }[];
  /** Live whale feed — used for the whale buy/sell notional ratio. */
  whales: { side: string; usdt: number; ts: number }[];
}

const STABLE_BASES = new Set(['USDT', 'USDC', 'BUSD', 'TUSD', 'DAI', 'FDUSD', 'USDP', 'EUR', 'GBP', 'TRY', 'BRL', 'ARS']);
const LEVERAGED_TOKEN_RE = /(UP|DOWN|BULL|BEAR)USDT$/;

/** Real market-wide breadth: % of top-volume USDT spot pairs on Binance
 *  green on 24h, not just the user's own scanned/watchlist coins. Ranked by
 *  quoteVolume so illiquid noise doesn't dilute the read. Falls back to the
 *  old watchlist-scoped proxy (clearly labeled as a fallback in `detail`,
 *  not silently) if the market-wide fetch fails — missing/degraded data
 *  still shouldn't just vanish into a null score when a usable proxy exists. */
async function marketBreadthSignal(fallbackCoins: LocalInputs['coins']): Promise<RegimeSignal> {
  const raw = await getJson<{ symbol: string; priceChangePercent: string; quoteVolume: string }[]>(
    'https://api.binance.com/api/v3/ticker/24hr',
  );
  const usdtPairs = (raw ?? []).filter((t) => {
    if (!t.symbol.endsWith('USDT') || LEVERAGED_TOKEN_RE.test(t.symbol)) return false;
    if (STABLE_BASES.has(t.symbol.slice(0, -4))) return false;
    return Number.isFinite(Number(t.priceChangePercent)) && Number.isFinite(Number(t.quoteVolume));
  });
  if (usdtPairs.length < 30) return watchlistBreadthSignal(fallbackCoins, true);

  const top = usdtPairs.sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume)).slice(0, 150);
  const up = top.filter((t) => Number(t.priceChangePercent) > 0).length;
  const share = (up / top.length) * 100;
  return {
    id: 'breadth',
    label: 'Market breadth',
    score: clamp((share - 50) / 25),
    value: `${share.toFixed(0)}% up`,
    detail: `${up} of top ${top.length} USDT pairs by volume on Binance are green on 24h (market-wide, not just your watchlist) — participation is ${share >= 60 ? 'broad' : share >= 45 ? 'mixed' : 'narrow'}`,
  };
}

function watchlistBreadthSignal(coins: LocalInputs['coins'], isFallback = false): RegimeSignal {
  const usable = coins.filter((c) => Number.isFinite(c.change));
  if (usable.length < 10) {
    return { id: 'breadth', label: 'Market breadth', score: null, value: '—', detail: 'Not enough scanned assets yet' };
  }
  const up = usable.filter((c) => c.change > 0).length;
  const share = (up / usable.length) * 100;
  return {
    id: 'breadth',
    label: 'Market breadth',
    score: clamp((share - 50) / 25),
    value: `${share.toFixed(0)}% up`,
    detail: isFallback
      ? `Market-wide breadth fetch failed — falling back to your own watchlist: ${up} of ${usable.length} tracked assets are green on 24h`
      : `${up} of ${usable.length} tracked assets are green on 24h — participation is ${share >= 60 ? 'broad' : share >= 45 ? 'mixed' : 'narrow'}`,
  };
}

function whaleFlowSignal(whales: LocalInputs['whales']): RegimeSignal {
  const cutoff = Date.now() - 60 * 60_000;
  const recent = whales.filter((w) => w.ts >= cutoff && Number.isFinite(w.usdt));
  if (recent.length < 8) {
    return { id: 'whale_flow', label: 'Whale buy/sell flow', score: null, value: '—', detail: 'Too few whale trades in the last hour' };
  }
  let buy = 0;
  let sell = 0;
  for (const w of recent) {
    if (w.side?.toUpperCase() === 'BUY') buy += w.usdt;
    else sell += w.usdt;
  }
  const total = buy + sell;
  if (total <= 0) {
    return { id: 'whale_flow', label: 'Whale buy/sell flow', score: null, value: '—', detail: 'No whale notional in window' };
  }
  const imbalance = (buy - sell) / total;
  return {
    id: 'whale_flow',
    label: 'Whale buy/sell flow',
    score: clamp(imbalance * 3),
    value: `${(imbalance * 100).toFixed(0)}% ${imbalance >= 0 ? 'buy' : 'sell'}`,
    detail: `Whale prints in the last hour are ${Math.abs(imbalance * 100).toFixed(0)}% skewed to the ${imbalance >= 0 ? 'accumulation' : 'distribution'} side across ${recent.length} trades`,
  };
}

/** Collect every regime signal for one tick. Never throws. */
export async function collectSignals(local: LocalInputs): Promise<RegimeSignal[]> {
  const [trend, derivs, aggressive, sentiment, dominance, breadth, ethBtc, stableFlow] = await Promise.all([
    btcTrendSignals(),
    derivativeSignals(),
    aggressiveFlowSignal(),
    sentimentSignals(),
    dominanceSignal(),
    marketBreadthSignal(local.coins),
    ethBtcStrengthSignal(),
    stablecoinFlowSignal(),
  ]);
  return [
    ...trend,
    breadth,
    whaleFlowSignal(local.whales),
    aggressive,
    ...derivs,
    ...sentiment,
    dominance,
    ethBtc,
    stableFlow,
  ];
}
