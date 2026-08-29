/* ══ Hyperliquid candle backtest (visual engine data layer) ═══════════════
 *  Fetches real HL candle snapshots and runs a simple long/flat rule so the
 *  Trading Hub / Nexus UI can chart equity before live capital. Not a full
 *  portfolio simulator — honest about limitations in the result meta.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { fetchWithLatency } from "./circuitBreaker";

export interface HlCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface HlBacktestConfig {
  coin: string;
  interval: "15m" | "1h" | "4h" | "1d";
  lookbackBars: number;
  /** SMA fast / slow cross as the default demo rule. */
  fastSma: number;
  slowSma: number;
}

export interface HlBacktestTrade {
  entryTs: number;
  exitTs: number;
  entry: number;
  exit: number;
  pnlPct: number;
}

export interface HlBacktestResult {
  candles: HlCandle[];
  equity: { t: number; equity: number }[];
  trades: HlBacktestTrade[];
  winRate: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  meta: {
    source: "hyperliquid";
    rule: string;
    barCount: number;
    note: string;
  };
}

const INTERVAL_MS: Record<HlBacktestConfig["interval"], number> = {
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

export async function fetchHlCandles(
  coin: string,
  interval: HlBacktestConfig["interval"],
  lookbackBars: number,
): Promise<HlCandle[]> {
  const end = Date.now();
  const start = end - lookbackBars * INTERVAL_MS[interval];
  const body = {
    type: "candleSnapshot",
    req: { coin, interval, startTime: start, endTime: end },
  };
  const res = await fetchWithLatency("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Hyperliquid candles HTTP ${res.status}`);
  const raw = (await res.json()) as Array<{
    t: number;
    o: string;
    h: string;
    l: string;
    c: string;
    v: string;
  }>;
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => ({
    t: c.t,
    o: Number(c.o),
    h: Number(c.h),
    l: Number(c.l),
    c: Number(c.c),
    v: Number(c.v),
  }));
}

function sma(values: number[], period: number, i: number): number | null {
  if (i + 1 < period) return null;
  let s = 0;
  for (let j = i - period + 1; j <= i; j++) s += values[j];
  return s / period;
}

export async function runHlSmaBacktest(
  cfg: HlBacktestConfig,
): Promise<HlBacktestResult> {
  const candles = await fetchHlCandles(cfg.coin, cfg.interval, cfg.lookbackBars);
  const closes = candles.map((c) => c.c);
  const trades: HlBacktestTrade[] = [];
  const equityCurve: { t: number; equity: number }[] = [];

  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  let position: { entry: number; entryTs: number } | null = null;

  for (let i = 0; i < candles.length; i++) {
    const fast = sma(closes, cfg.fastSma, i);
    const slow = sma(closes, cfg.slowSma, i);
    if (fast == null || slow == null) {
      equityCurve.push({ t: candles[i].t, equity });
      continue;
    }

    if (!position && fast > slow) {
      position = { entry: closes[i], entryTs: candles[i].t };
    } else if (position && fast < slow) {
      const pnl = (closes[i] - position.entry) / position.entry;
      trades.push({
        entryTs: position.entryTs,
        exitTs: candles[i].t,
        entry: position.entry,
        exit: closes[i],
        pnlPct: pnl * 100,
      });
      equity *= 1 + pnl;
      position = null;
    }

    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, (peak - equity) / peak);
    equityCurve.push({ t: candles[i].t, equity });
  }

  const wins = trades.filter((t) => t.pnlPct > 0).length;
  return {
    candles,
    equity: equityCurve,
    trades,
    winRate: trades.length ? wins / trades.length : 0,
    totalReturnPct: (equity - 1) * 100,
    maxDrawdownPct: maxDd * 100,
    meta: {
      source: "hyperliquid",
      rule: `SMA(${cfg.fastSma})/${cfg.slowSma} cross long/flat`,
      barCount: candles.length,
      note: "Research tool only — no fees, funding, or partial fills modelled.",
    },
  };
}
