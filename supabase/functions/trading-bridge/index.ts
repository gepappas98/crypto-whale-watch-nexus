// Trading Bridge — Deno port of tradingview-mcp-server tools.
// Real data sources: Yahoo Finance (OHLC), Binance (screener), Reddit (sentiment),
// RSS feeds (news). All indicators + backtest computed in TypeScript.
// No mocks. No placeholders. Failures bubble up as real errors.

/** Turns a failed upstream response into a short, human-readable error —
 *  never the raw body. Reddit's anti-bot block page and Yahoo's error
 *  pages are full HTML/CSS documents, sometimes tens of KB; interpolating
 *  that directly into `throw new Error(...)` used to mean the ENTIRE page
 *  ended up as the error's .message, which then rendered verbatim in the
 *  UI (a wall of raw CSS instead of an error) because nothing between here
 *  and the render call (safeInvoke.ts, trading-api.ts, Sentiment.tsx) ever
 *  capped it — every layer just faithfully passed the message through.
 *  Strips tags/whitespace and caps length so that can't happen again,
 *  regardless of what any upstream source returns on failure. */
function describeUpstreamError(source: string, status: number, rawBody: string): string {
  const stripped = rawBody
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const snippet = stripped.slice(0, 120);
  return snippet ? `${source} ${status}: ${snippet}` : `${source} ${status}`;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const err = (msg: string, status = 500, extra: Record<string, unknown> = {}) =>
  json({ error: msg, ...extra }, status);

// ─── Yahoo Finance ─────────────────────────────────────────────────────────
type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

const TF_MAP: Record<string, { interval: string; range: string }> = {
  "15m": { interval: "15m", range: "5d" },
  "1H":  { interval: "60m", range: "1mo" },
  "4H":  { interval: "60m", range: "3mo" }, // resampled below
  "1D":  { interval: "1d", range: "6mo" },
  "1W":  { interval: "1wk", range: "2y" },
  "1M":  { interval: "1mo", range: "5y" },
};

async function yahooChart(
  symbol: string,
  interval = "1d",
  range = "6mo",
): Promise<Candle[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 TradingBridge/1.0" },
  });
  if (!r.ok) throw new Error(describeUpstreamError(`Yahoo ${symbol}`, r.status, await r.text()));
  const j = await r.json();
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo: no data for ${symbol}`);
  const ts: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  const out: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i], v = q.volume?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    out.push({ t: ts[i] * 1000, o, h, l, c, v: v ?? 0 });
  }
  if (!out.length) throw new Error(`Yahoo: empty series for ${symbol}`);
  return out;
}

function resample4H(hourly: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < hourly.length; i += 4) {
    const slice = hourly.slice(i, i + 4);
    if (!slice.length) break;
    out.push({
      t: slice[0].t,
      o: slice[0].o,
      h: Math.max(...slice.map(x => x.h)),
      l: Math.min(...slice.map(x => x.l)),
      c: slice[slice.length - 1].c,
      v: slice.reduce((a, b) => a + b.v, 0),
    });
  }
  return out;
}

async function getCandles(symbol: string, timeframe = "1D"): Promise<Candle[]> {
  const tf = TF_MAP[timeframe] ?? TF_MAP["1D"];
  const candles = await yahooChart(symbol, tf.interval, tf.range);
  return timeframe === "4H" ? resample4H(candles) : candles;
}

async function yahooQuote(symbol: string) {
  const c = await yahooChart(symbol, "1d", "5d");
  const last = c[c.length - 1];
  const prev = c[c.length - 2] ?? last;
  return {
    symbol,
    price: last.c,
    change: last.c - prev.c,
    changePct: ((last.c - prev.c) / prev.c) * 100,
    timestamp: last.t,
    spark: c.slice(-24).map(x => x.c),
  };
}

// ─── Indicators ────────────────────────────────────────────────────────────
const sma = (a: number[], p: number) => {
  const out: number[] = Array(a.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i];
    if (i >= p) s -= a[i - p];
    if (i >= p - 1) out[i] = s / p;
  }
  return out;
};

const ema = (a: number[], p: number) => {
  const out: number[] = Array(a.length).fill(NaN);
  const k = 2 / (p + 1);
  let prev = a[0];
  out[0] = prev;
  for (let i = 1; i < a.length; i++) {
    prev = a[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
};

function rsi(closes: number[], p = 14) {
  const out: number[] = Array(closes.length).fill(NaN);
  if (closes.length < p + 1) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  g /= p; l /= p;
  out[p] = 100 - 100 / (1 + g / (l || 1e-9));
  for (let i = p + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const up = d > 0 ? d : 0, dn = d < 0 ? -d : 0;
    g = (g * (p - 1) + up) / p;
    l = (l * (p - 1) + dn) / p;
    out[i] = 100 - 100 / (1 + g / (l || 1e-9));
  }
  return out;
}

function macd(closes: number[], fast = 12, slow = 26, sig = 9) {
  const eF = ema(closes, fast), eS = ema(closes, slow);
  const line = closes.map((_, i) => eF[i] - eS[i]);
  const signal = ema(line, sig);
  const hist = line.map((v, i) => v - signal[i]);
  return { line, signal, hist };
}

function bollinger(closes: number[], p = 20, mult = 2) {
  const mid = sma(closes, p);
  const upper: number[] = Array(closes.length).fill(NaN);
  const lower: number[] = Array(closes.length).fill(NaN);
  for (let i = p - 1; i < closes.length; i++) {
    let s = 0;
    for (let j = i - p + 1; j <= i; j++) s += (closes[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / p);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }
  return { upper, mid, lower };
}

function atr(c: Candle[], p = 14) {
  const tr: number[] = [c[0].h - c[0].l];
  for (let i = 1; i < c.length; i++) {
    tr.push(Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c)));
  }
  const out: number[] = Array(c.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < p && i < tr.length; i++) s += tr[i];
  if (tr.length >= p) out[p - 1] = s / p;
  for (let i = p; i < tr.length; i++) {
    out[i] = (out[i - 1] * (p - 1) + tr[i]) / p;
  }
  return out;
}

function supertrend(c: Candle[], p = 10, mult = 3) {
  const a = atr(c, p);
  const dir: number[] = Array(c.length).fill(1);
  const st: number[] = Array(c.length).fill(NaN);
  for (let i = p; i < c.length; i++) {
    const hl2 = (c[i].h + c[i].l) / 2;
    const upper = hl2 + mult * a[i];
    const lower = hl2 - mult * a[i];
    const prevSt = st[i - 1] ?? upper;
    if (c[i].c > prevSt) dir[i] = 1;
    else if (c[i].c < prevSt) dir[i] = -1;
    else dir[i] = dir[i - 1];
    st[i] = dir[i] === 1 ? lower : upper;
  }
  return { dir, st };
}

// ─── Analysis assembly ─────────────────────────────────────────────────────
function technicalAnalysis(symbol: string, candles: Candle[], timeframe: string) {
  const closes = candles.map(c => c.c);
  const last = closes.length - 1;
  const r = rsi(closes);
  const m = macd(closes);
  const bb = bollinger(closes);
  const e20 = ema(closes, 20), e50 = ema(closes, 50), e200 = ema(closes, 200);
  const st = supertrend(candles);

  const price = closes[last];
  const rsiV = r[last];
  const bbWidth = (bb.upper[last] - bb.lower[last]) / bb.mid[last];
  const pctB = (price - bb.lower[last]) / (bb.upper[last] - bb.lower[last]);
  const recentWidths = closes.slice(-30).map((_, i) => {
    const idx = closes.length - 30 + i;
    return (bb.upper[idx] - bb.lower[idx]) / bb.mid[idx];
  }).filter(x => !isNaN(x));
  const avgWidth = recentWidths.reduce((a, b) => a + b, 0) / recentWidths.length;
  const squeeze = bbWidth < avgWidth * 0.7;

  // Bollinger ±3 rating: -3 (deep below lower) to +3 (deep above upper)
  let bbRating = 0;
  if (pctB <= 0) bbRating = -3;
  else if (pctB < 0.2) bbRating = -2;
  else if (pctB < 0.4) bbRating = -1;
  else if (pctB < 0.6) bbRating = 0;
  else if (pctB < 0.8) bbRating = 1;
  else if (pctB < 1) bbRating = 2;
  else bbRating = 3;

  // Aggregate signal
  const votes: Array<-1 | 0 | 1> = [];
  votes.push(rsiV < 30 ? 1 : rsiV > 70 ? -1 : 0);
  votes.push(m.hist[last] > 0 && m.hist[last - 1] <= 0 ? 1 : m.hist[last] < 0 && m.hist[last - 1] >= 0 ? -1 : m.hist[last] > 0 ? 1 : -1);
  votes.push(bbRating <= -2 ? 1 : bbRating >= 2 ? -1 : 0);
  votes.push(e20[last] > e50[last] ? 1 : -1);
  votes.push(e50[last] > e200[last] ? 1 : -1);
  votes.push(st.dir[last] === 1 ? 1 : -1);
  const score = votes.reduce<number>((a, b) => a + b, 0);
  const bull = votes.filter(v => v === 1).length;
  const bear = votes.filter(v => v === -1).length;
  let signal: string;
  if (score >= 4) signal = "STRONG BUY";
  else if (score >= 2) signal = "BUY";
  else if (score <= -4) signal = "STRONG SELL";
  else if (score <= -2) signal = "SELL";
  else signal = "HOLD";
  const confidence = Math.round((Math.max(bull, bear) / votes.length) * 100);

  // Cross detection
  const goldenCross = e20[last] > e50[last] && e20[last - 1] <= e50[last - 1];
  const deathCross = e20[last] < e50[last] && e20[last - 1] >= e50[last - 1];
  const macdGolden = m.line[last] > m.signal[last] && m.line[last - 1] <= m.signal[last - 1];
  const macdDeath = m.line[last] < m.signal[last] && m.line[last - 1] >= m.signal[last - 1];

  // Support/resistance — simple swing high/low over last 50
  const window = candles.slice(-50);
  const support = Math.min(...window.map(c => c.l));
  const resistance = Math.max(...window.map(c => c.h));

  return {
    symbol,
    timeframe,
    price,
    timestamp: candles[last].t,
    rsi: { value: rsiV, signal: rsiV < 30 ? "OVERSOLD" : rsiV > 70 ? "OVERBOUGHT" : "NEUTRAL" },
    macd: {
      line: m.line[last], signal: m.signal[last], hist: m.hist[last],
      histSeries: m.hist.slice(-30),
      goldenCross: macdGolden, deathCross: macdDeath,
    },
    bollinger: {
      upper: bb.upper[last], mid: bb.mid[last], lower: bb.lower[last],
      pctB, rating: bbRating, squeeze,
      width: bbWidth,
    },
    ema: {
      ema20: e20[last], ema50: e50[last], ema200: e200[last],
      bullish: e20[last] > e50[last],
      goldenCross, deathCross,
    },
    supertrend: {
      direction: st.dir[last] === 1 ? "UPTREND" : "DOWNTREND",
      value: st.st[last],
      atr: atr(candles)[last],
    },
    overall: { signal, confidence, bullVotes: bull, bearVotes: bear, totalVotes: votes.length },
    support, resistance,
  };
}

// ─── Backtest engine ───────────────────────────────────────────────────────
type Trade = { entryDate: number; exitDate: number; type: "LONG"; entry: number; exit: number; pnl: number; ret: number };

function backtest(candles: Candle[], strategy: string, capital: number, commission: number) {
  const closes = candles.map(c => c.c);
  const r = rsi(closes);
  const m = macd(closes);
  const bb = bollinger(closes);
  const e20 = ema(closes, 20), e50 = ema(closes, 50);
  const st = supertrend(candles);

  const trades: Trade[] = [];
  let position: { entry: number; entryT: number } | null = null;
  let cash = capital;
  let units = 0;
  const equity: { t: number; v: number }[] = [];

  const sig = (i: number): "BUY" | "SELL" | null => {
    if (i < 50) return null;
    switch (strategy) {
      case "rsi":
        if (r[i] < 30 && r[i - 1] >= 30) return "BUY";
        if (r[i] > 70 && r[i - 1] <= 70) return "SELL";
        return null;
      case "bollinger":
        if (closes[i] < bb.lower[i] && closes[i - 1] >= bb.lower[i - 1]) return "BUY";
        if (closes[i] > bb.upper[i] && closes[i - 1] <= bb.upper[i - 1]) return "SELL";
        return null;
      case "macd":
        if (m.line[i] > m.signal[i] && m.line[i - 1] <= m.signal[i - 1]) return "BUY";
        if (m.line[i] < m.signal[i] && m.line[i - 1] >= m.signal[i - 1]) return "SELL";
        return null;
      case "ema_cross":
        if (e20[i] > e50[i] && e20[i - 1] <= e50[i - 1]) return "BUY";
        if (e20[i] < e50[i] && e20[i - 1] >= e50[i - 1]) return "SELL";
        return null;
      case "supertrend":
        if (st.dir[i] === 1 && st.dir[i - 1] === -1) return "BUY";
        if (st.dir[i] === -1 && st.dir[i - 1] === 1) return "SELL";
        return null;
      case "donchian": {
        const lookback = 20;
        if (i < lookback) return null;
        const hi = Math.max(...closes.slice(i - lookback, i));
        const lo = Math.min(...closes.slice(i - lookback, i));
        if (closes[i] > hi) return "BUY";
        if (closes[i] < lo) return "SELL";
        return null;
      }
    }
    return null;
  };

  for (let i = 0; i < candles.length; i++) {
    const s = sig(i);
    const price = closes[i];
    if (s === "BUY" && !position) {
      const fee = cash * commission / 100;
      units = (cash - fee) / price;
      position = { entry: price, entryT: candles[i].t };
      cash = 0;
    } else if (s === "SELL" && position) {
      const proceeds = units * price;
      const fee = proceeds * commission / 100;
      cash = proceeds - fee;
      const pnl = cash - capital - trades.reduce((a, t) => a + t.pnl, 0);
      trades.push({
        entryDate: position.entryT, exitDate: candles[i].t, type: "LONG",
        entry: position.entry, exit: price,
        pnl, ret: ((price - position.entry) / position.entry) * 100,
      });
      position = null;
      units = 0;
    }
    const v = position ? units * price : cash;
    equity.push({ t: candles[i].t, v });
  }

  // Close open position at end
  if (position) {
    const price = closes[closes.length - 1];
    cash = units * price;
    trades.push({
      entryDate: position.entryT, exitDate: candles[candles.length - 1].t, type: "LONG",
      entry: position.entry, exit: price,
      pnl: cash - capital - trades.reduce((a, t) => a + t.pnl, 0),
      ret: ((price - position.entry) / position.entry) * 100,
    });
  }

  const finalEquity = equity[equity.length - 1]?.v ?? capital;
  const totalReturn = ((finalEquity - capital) / capital) * 100;
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;
  const profitFactor = losses.length ? wins.reduce((a, t) => a + t.pnl, 0) / Math.abs(losses.reduce((a, t) => a + t.pnl, 0) || 1) : 0;
  const expectancy = trades.length ? trades.reduce((a, t) => a + t.pnl, 0) / trades.length : 0;
  let peak = -Infinity, maxDD = 0;
  for (const e of equity) {
    if (e.v > peak) peak = e.v;
    const dd = ((e.v - peak) / peak) * 100;
    if (dd < maxDD) maxDD = dd;
  }
  // Sharpe (daily-ish approximation)
  const rets: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    rets.push((equity[i].v - equity[i - 1].v) / (equity[i - 1].v || 1));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const std = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length || 1));
  const sharpe = std ? (mean / std) * Math.sqrt(252) : 0;
  const calmar = maxDD ? totalReturn / Math.abs(maxDD) : 0;

  // Buy & hold
  const bh = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;

  return {
    strategy,
    initialCapital: capital,
    finalEquity,
    totalReturn,
    winRate,
    sharpe,
    calmar,
    maxDrawdown: maxDD,
    profitFactor,
    expectancy,
    bestTrade: trades.length ? Math.max(...trades.map(t => t.pnl)) : 0,
    worstTrade: trades.length ? Math.min(...trades.map(t => t.pnl)) : 0,
    tradeCount: trades.length,
    buyHoldReturn: bh,
    outperformance: totalReturn - bh,
    equity,
    trades,
  };
}

// ─── Reddit sentiment ──────────────────────────────────────────────────────
const BULL_WORDS = ["moon", "bullish", "buy", "long", "pump", "rally", "breakout", "support", "accumulate", "uptrend", "🚀", "ath", "hold", "hodl"];
const BEAR_WORDS = ["dump", "bearish", "sell", "short", "crash", "drop", "resistance", "downtrend", "rug", "rekt", "bear", "fall", "tank"];

const REDDIT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TradingBridge/1.0 (contact: trading-bridge@whale-radar.app)";

let redditToken: { accessToken: string; expiresAt: number } | null = null;

/** Reddit's anonymous www.reddit.com/*.json endpoints started rejecting
 *  datacenter/edge-function traffic outright ("You've been blocked by
 *  network security... use your developer token") — this isn't a header
 *  or User-Agent problem, it's an IP-reputation block, so no request
 *  shape fixes it. The actual fix Reddit's own error message points to:
 *  authenticate via OAuth. Uses the "client_credentials" grant (a Reddit
 *  "script"-type app's id+secret, no end-user login involved) — see this
 *  repo's README's "Reddit Sentiment Setup" section for how to create one.
 *  Returns null (not a thrown error) when REDDIT_CLIENT_ID/SECRET aren't
 *  configured, so redditSentiment() can fall back to the anonymous
 *  endpoint and produce an honest "needs a developer token" message
 *  instead of a confusing raw block-page error. */
async function getRedditToken(): Promise<string | null> {
  const clientId = Deno.env.get("REDDIT_CLIENT_ID");
  const clientSecret = Deno.env.get("REDDIT_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;

  if (redditToken && Date.now() < redditToken.expiresAt) return redditToken.accessToken;

  const r = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": REDDIT_UA,
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(describeUpstreamError("Reddit OAuth", r.status, await r.text()));
  const j = await r.json();
  if (!j.access_token) throw new Error("Reddit OAuth: no access_token in response — check REDDIT_CLIENT_ID/SECRET");
  // Refresh a minute early rather than exactly on expiry.
  redditToken = { accessToken: j.access_token, expiresAt: Date.now() + Math.max(0, (j.expires_in ?? 3600) - 60) * 1000 };
  return redditToken.accessToken;
}

async function redditSentiment(symbol: string) {
  const token = symbol.replace(/-USD$/i, "").replace(/USDT$/i, "");
  const accessToken = await getRedditToken();
  const base = accessToken ? "https://oauth.reddit.com" : "https://www.reddit.com";
  const url = `${base}/r/CryptoCurrency/search.json?q=${encodeURIComponent(token)}&restrict_sr=1&sort=new&limit=25`;

  const headers: Record<string, string> = {
    "User-Agent": REDDIT_UA,
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  const r = await fetch(url, { headers });
  if (!r.ok) {
    if (!accessToken) {
      // Anonymous request, no credentials configured — give an actionable
      // message instead of Reddit's raw block-page text, since header
      // tweaks alone can't fix this (see getRedditToken()'s docstring).
      throw new Error(
        `Reddit ${r.status}: blocked (no developer token configured — set REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET, see README's Reddit Sentiment Setup)`,
      );
    }
    throw new Error(describeUpstreamError("Reddit", r.status, await r.text()));
  }
  const j = await r.json();
  const posts = (j?.data?.children ?? []).map((c: any) => c.data);
  let bull = 0, bear = 0;
  const items = posts.map((p: any) => {
    const text = `${p.title} ${p.selftext ?? ""}`.toLowerCase();
    const b = BULL_WORDS.filter(w => text.includes(w)).length;
    const s = BEAR_WORDS.filter(w => text.includes(w)).length;
    bull += b; bear += s;
    const label = b > s ? "Bullish" : s > b ? "Bearish" : "Neutral";
    return {
      title: p.title,
      url: `https://reddit.com${p.permalink}`,
      score: p.score,
      created: p.created_utc * 1000,
      sentiment: label,
    };
  });
  const total = bull + bear;
  const score = total ? (bull - bear) / total : 0;
  return {
    symbol,
    score,
    label: score > 0.2 ? "Bullish" : score < -0.2 ? "Bearish" : "Neutral",
    postsAnalyzed: posts.length,
    bullishHits: bull,
    bearishHits: bear,
    topPosts: items.slice(0, 5),
    timestamp: Date.now(),
  };
}

// ─── RSS news ──────────────────────────────────────────────────────────────
const FEEDS = [
  // No trailing slash — CoinDesk's own feed self-links without one (its
  // <atom:link rel="self"> points to the no-slash URL), and that's the
  // form confirmed to actually return the feed rather than a redirect/404.
  { src: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss" },
  { src: "CoinTelegraph", url: "https://cointelegraph.com/rss" },
  { src: "Decrypt", url: "https://decrypt.co/feed" },
];

// Same fix as the Reddit endpoint: CoinDesk/CoinTelegraph sit behind CDN/bot
// protection that was silently rejecting the bare "TradingBridge/1.0"
// User-Agent with no other headers — only Decrypt's CDN let it through,
// which is why only Decrypt was ever showing up. Both feeds fetch fine
// with a fuller, browser-like header set (verified independently before
// this fix).
const NEWS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 TradingBridge/1.0",
  "Accept": "application/rss+xml, application/xml, text/xml, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

function tagSentiment(text: string): "Positive" | "Negative" | "Neutral" {
  const t = text.toLowerCase();
  const p = BULL_WORDS.filter(w => t.includes(w)).length;
  const n = BEAR_WORDS.filter(w => t.includes(w)).length;
  return p > n ? "Positive" : n > p ? "Negative" : "Neutral";
}

async function fetchNews(symbol?: string) {
  const all: any[] = [];
  for (const f of FEEDS) {
    try {
      const r = await fetch(f.url, { headers: NEWS_HEADERS });
      if (!r.ok) {
        // Was previously silent — a feed could fail forever with zero way
        // to tell why. Logged, not thrown: one dead feed shouldn't fail
        // the whole /news response when others are still live.
        console.warn(`[trading-bridge] news feed ${f.src} failed: ${r.status}`);
        continue;
      }
      const xml = await r.text();
      const items = [...xml.matchAll(/<item[\s\S]*?<\/item>/g)].slice(0, 15);
      for (const m of items) {
        const block = m[0];
        const title = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1]?.trim() ?? "";
        const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? "";
        const date = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? "";
        if (!title) continue;
        if (symbol) {
          const tok = symbol.replace(/-USD$/i, "").toLowerCase();
          if (!title.toLowerCase().includes(tok)) continue;
        }
        all.push({
          title, url: link, source: f.src,
          published: date ? new Date(date).getTime() : Date.now(),
          sentiment: tagSentiment(title),
        });
      }
    } catch (e) {
      console.warn(`[trading-bridge] news feed ${f.src} threw:`, (e as Error)?.message ?? e);
    }
  }
  all.sort((a, b) => b.published - a.published);
  return all.slice(0, 30);
}

// ─── Binance screener ──────────────────────────────────────────────────────
async function binanceScreener(filters: any) {
  const r = await fetch("https://api.binance.com/api/v3/ticker/24hr");
  if (!r.ok) throw new Error(`Binance ${r.status}`);
  const tickers: any[] = await r.json();
  const usdtPairs = tickers.filter(t => t.symbol.endsWith("USDT")).slice(0, 100);
  // Pull klines for top 20 by volume to compute RSI
  const top = [...usdtPairs].sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume)).slice(0, 30);
  const results = await Promise.all(top.map(async (t) => {
    try {
      const kr = await fetch(`https://api.binance.com/api/v3/klines?symbol=${t.symbol}&interval=1h&limit=100`);
      const k = await kr.json();
      const closes = k.map((x: any) => parseFloat(x[4]));
      const r14 = rsi(closes);
      const m = macd(closes);
      const bb = bollinger(closes);
      const last = closes.length - 1;
      const pctB = (closes[last] - bb.lower[last]) / (bb.upper[last] - bb.lower[last]);
      let bbRating = 0;
      if (pctB <= 0) bbRating = -3; else if (pctB < 0.2) bbRating = -2; else if (pctB < 0.4) bbRating = -1;
      else if (pctB < 0.6) bbRating = 0; else if (pctB < 0.8) bbRating = 1; else if (pctB < 1) bbRating = 2; else bbRating = 3;
      const rsiV = r14[last];
      let signal = "HOLD";
      if (rsiV < 30 && m.hist[last] > 0) signal = "BUY";
      else if (rsiV > 70 && m.hist[last] < 0) signal = "SELL";
      return {
        symbol: t.symbol,
        exchange: "Binance",
        price: parseFloat(t.lastPrice),
        change24h: parseFloat(t.priceChangePercent),
        volume: parseFloat(t.quoteVolume),
        rsi: rsiV,
        macdHist: m.hist[last],
        bollingerRating: bbRating,
        signal,
      };
    } catch { return null; }
  }));
  let out = results.filter(Boolean) as any[];
  if (filters?.signal && filters.signal !== "all") {
    const want = filters.signal.toLowerCase();
    out = out.filter(r => {
      if (want === "oversold") return r.rsi < 30;
      if (want === "overbought") return r.rsi > 70;
      if (want === "trending up") return r.change24h > 5;
      if (want === "trending down") return r.change24h < -5;
      return true;
    });
  }
  if (filters?.minRsi != null) out = out.filter(r => r.rsi >= filters.minRsi);
  if (filters?.maxRsi != null) out = out.filter(r => r.rsi <= filters.maxRsi);
  if (filters?.minVolume != null) out = out.filter(r => r.volume >= filters.minVolume);
  return out;
}

// ─── Candlestick patterns ─────────────────────────────────────────────────
function detectPatterns(candles: Candle[]) {
  const patterns: any[] = [];
  for (let i = 2; i < candles.length; i++) {
    const c = candles[i], p1 = candles[i - 1], p2 = candles[i - 2];
    const body = Math.abs(c.c - c.o);
    const range = c.h - c.l;
    const upperW = c.h - Math.max(c.c, c.o);
    const lowerW = Math.min(c.c, c.o) - c.l;

    // Doji
    if (body / (range || 1) < 0.1) {
      patterns.push({ name: "Doji", type: "Neutral", confidence: 80, index: i, time: c.t });
    }
    // Hammer
    if (lowerW > body * 2 && upperW < body * 0.5 && c.c > c.o) {
      patterns.push({ name: "Hammer", type: "Bullish", confidence: 75, index: i, time: c.t });
    }
    // Shooting Star
    if (upperW > body * 2 && lowerW < body * 0.5 && c.c < c.o) {
      patterns.push({ name: "Shooting Star", type: "Bearish", confidence: 75, index: i, time: c.t });
    }
    // Bullish Engulfing
    if (p1.c < p1.o && c.c > c.o && c.o < p1.c && c.c > p1.o) {
      patterns.push({ name: "Bullish Engulfing", type: "Bullish", confidence: 85, index: i, time: c.t });
    }
    // Bearish Engulfing
    if (p1.c > p1.o && c.c < c.o && c.o > p1.c && c.c < p1.o) {
      patterns.push({ name: "Bearish Engulfing", type: "Bearish", confidence: 85, index: i, time: c.t });
    }
    // Morning Star
    if (p2.c < p2.o && Math.abs(p1.c - p1.o) < body * 0.3 && c.c > c.o && c.c > (p2.o + p2.c) / 2) {
      patterns.push({ name: "Morning Star", type: "Bullish", confidence: 90, index: i, time: c.t });
    }
    // Evening Star
    if (p2.c > p2.o && Math.abs(p1.c - p1.o) < body * 0.3 && c.c < c.o && c.c < (p2.o + p2.c) / 2) {
      patterns.push({ name: "Evening Star", type: "Bearish", confidence: 90, index: i, time: c.t });
    }
  }
  // Keep most recent occurrence per pattern name + last 10 candles for chart
  const byName: Record<string, any> = {};
  for (const p of patterns) {
    if (!byName[p.name] || p.time > byName[p.name].time) {
      byName[p.name] = {
        ...p,
        miniChart: candles.slice(Math.max(0, p.index - 9), p.index + 1),
      };
    }
  }
  return Object.values(byName).sort((a: any, b: any) => b.time - a.time);
}

// ─── Router ────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  // Strip function name from path
  const path = url.pathname.replace(/^\/trading-bridge/, "").replace(/^\/api/, "") || "/";

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    if (path === "/" || path === "/health") {
      return json({ ok: true, service: "trading-bridge", time: Date.now() });
    }

    if (path === "/technical-analysis") {
      const { symbol, timeframe = "1D" } = body;
      if (!symbol) return err("symbol required", 400);
      const candles = await getCandles(symbol, timeframe);
      return json(technicalAnalysis(symbol, candles, timeframe));
    }

    if (path === "/multiple-analysis") {
      const { symbols, timeframe = "1D" } = body;
      if (!Array.isArray(symbols)) return err("symbols[] required", 400);
      const out = await Promise.all(symbols.map(async (s: string) => {
        try {
          const c = await getCandles(s, timeframe);
          return technicalAnalysis(s, c, timeframe);
        } catch (e) { return { symbol: s, error: String(e) }; }
      }));
      return json(out);
    }

    if (path === "/bollinger-analysis") {
      const { symbol, timeframe = "1D" } = body;
      const candles = await getCandles(symbol, timeframe);
      const ta = technicalAnalysis(symbol, candles, timeframe);
      return json({ symbol, ...ta.bollinger, price: ta.price });
    }

    if (path === "/backtest") {
      const { symbol, strategy = "rsi", period = "1y", capital = 10000, commission = 0.1 } = body;
      if (!symbol) return err("symbol required", 400);
      const candles = await yahooChart(symbol, "1d", period);
      return json(backtest(candles, strategy, capital, commission));
    }

    if (path === "/compare-strategies") {
      const { symbol, period = "1y", capital = 10000, commission = 0.1 } = body;
      const candles = await yahooChart(symbol, "1d", period);
      const strategies = ["rsi", "bollinger", "macd", "ema_cross", "supertrend", "donchian"];
      const results = strategies.map(s => {
        const r = backtest(candles, s, capital, commission);
        return {
          strategy: s,
          totalReturn: r.totalReturn,
          sharpe: r.sharpe,
          winRate: r.winRate,
          maxDrawdown: r.maxDrawdown,
          tradeCount: r.tradeCount,
        };
      });
      results.sort((a, b) => b.totalReturn - a.totalReturn);
      return json({ symbol, period, results });
    }

    if (path === "/market-snapshot") {
      const symbols = ["^GSPC", "^IXIC", "BTC-USD", "ETH-USD", "^VIX", "EURUSD=X", "SPY", "GLD"];
      const labels: Record<string, string> = {
        "^GSPC": "S&P 500", "^IXIC": "NASDAQ", "BTC-USD": "BTC", "ETH-USD": "ETH",
        "^VIX": "VIX", "EURUSD=X": "EUR/USD", "SPY": "SPY", "GLD": "GLD",
      };
      const out = await Promise.all(symbols.map(async (s) => {
        try {
          const q = await yahooQuote(s);
          return { ...q, label: labels[s] };
        } catch (e) { return { symbol: s, label: labels[s], error: String(e) }; }
      }));
      return json({ items: out, timestamp: Date.now() });
    }

    if (path === "/sentiment") {
      const { symbol } = body;
      if (!symbol) return err("symbol required", 400);
      return json(await redditSentiment(symbol));
    }

    if (path === "/news") {
      return json({ items: await fetchNews(body.symbol), timestamp: Date.now() });
    }

    if (path === "/combined-analysis") {
      const { symbol, timeframe = "1D" } = body;
      const candles = await getCandles(symbol, timeframe);
      const ta = technicalAnalysis(symbol, candles, timeframe);
      const [sent, news] = await Promise.all([
        redditSentiment(symbol).catch(e => ({ error: String(e), score: 0, label: "Neutral" })),
        fetchNews(symbol).catch(() => []),
      ]);
      const newsScore = (news as any[]).reduce((a, n) => a + (n.sentiment === "Positive" ? 1 : n.sentiment === "Negative" ? -1 : 0), 0);
      const newsLabel = newsScore > 0 ? "Positive" : newsScore < 0 ? "Negative" : "Neutral";
      const techVote = ta.overall.signal.includes("BUY") ? 1 : ta.overall.signal.includes("SELL") ? -1 : 0;
      const sentVote = (sent as any).score > 0.2 ? 1 : (sent as any).score < -0.2 ? -1 : 0;
      const newsVote = newsScore > 0 ? 1 : newsScore < 0 ? -1 : 0;
      const combined = techVote + sentVote + newsVote;
      let verdict = "HOLD";
      if (combined >= 3) verdict = "STRONG BUY";
      else if (combined === 2) verdict = "BUY";
      else if (combined <= -3) verdict = "STRONG SELL";
      else if (combined === -2) verdict = "SELL";
      const agree = [techVote, sentVote, newsVote].filter(v => Math.sign(v) === Math.sign(combined) && v !== 0).length;
      const confidence = Math.round((agree / 3) * 100);
      return json({
        symbol,
        verdict,
        confidence,
        breakdown: {
          technical: ta.overall.signal,
          sentiment: (sent as any).label,
          news: newsLabel,
        },
        mixed: agree < 2,
        technical: ta,
        sentiment: sent,
        news,
      });
    }

    if (path === "/screener") {
      return json({ items: await binanceScreener(body.filters ?? {}), timestamp: Date.now() });
    }

    if (path === "/scan-signal") {
      const { signal_type = "oversold" } = body;
      return json({ items: await binanceScreener({ signal: signal_type }), timestamp: Date.now() });
    }

    if (path === "/candlestick-patterns") {
      const { symbol, timeframe = "1D" } = body;
      const candles = await getCandles(symbol, timeframe);
      return json({ symbol, patterns: detectPatterns(candles), timestamp: Date.now() });
    }

    if (path === "/multi-timeframe") {
      const { symbol } = body;
      const tfs = ["1W", "1D", "4H", "1H", "15m"];
      const results = await Promise.all(tfs.map(async tf => {
        try {
          const c = await getCandles(symbol, tf);
          const ta = technicalAnalysis(symbol, c, tf);
          return {
            timeframe: tf,
            trend: ta.supertrend.direction,
            rsi: ta.rsi.value,
            macdHist: ta.macd.hist,
            signal: ta.overall.signal,
            support: ta.support,
            resistance: ta.resistance,
            price: ta.price,
          };
        } catch (e) { return { timeframe: tf, error: String(e) }; }
      }));
      const trends = results.filter((r: any) => r.trend).map((r: any) => r.trend);
      const allBull = trends.length > 0 && trends.every(t => t === "UPTREND");
      const allBear = trends.length > 0 && trends.every(t => t === "DOWNTREND");
      return json({
        symbol,
        timeframes: results,
        alignment: allBull ? "ALL TIMEFRAMES BULLISH" : allBear ? "ALL TIMEFRAMES BEARISH" : "MIXED SIGNALS",
        timestamp: Date.now(),
      });
    }

    if (path === "/yahoo-price") {
      const { symbol } = body;
      return json(await yahooQuote(symbol));
    }

    return err(`Unknown path: ${path}`, 404);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Upstream data issues (Yahoo empty/no-data, transient 4xx/5xx) should not
    // crash the client. Return 200 + fallback flag so the UI can render an
    // empty-state instead of a blank screen.
    const isUpstreamData =
      // [\w-]+ not \w+ for the Yahoo symbol segment — this app's default
      // symbols are hyphenated ("BTC-USD"), which \w+ alone doesn't match,
      // so this classifier was silently never firing for the app's own
      // default symbol format and falling through to a raw 500 instead.
      // "Reddit OAuth" covers getRedditToken()'s own failure shapes too
      // (token-fetch 4xx/5xx, or a malformed token response) — those
      // don't fit the plain "Reddit \d{3}" pattern.
      /Yahoo:|empty series|no data|Yahoo [\w-]+ \d{3}|Binance \d{3}|Reddit \d{3}|Reddit OAuth/i.test(msg);
    if (isUpstreamData) {
      console.warn("[trading-bridge] upstream fallback:", msg);
      return json({ error: msg, fallback: true, data: null });
    }
    return err(msg, 500);
  }
});
