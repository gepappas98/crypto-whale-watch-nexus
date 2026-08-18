import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { binanceGet, toPair } from "../binance";

type Kline = [number, string, string, string, string, string, ...unknown[]];

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (const v of values.slice(period)) prev = v * k + prev * (1 - k);
  return prev;
}

// Wilder's smoothed RSI: seed with the simple average of the first `period`
// changes, then smooth each subsequent change with 1/period weighting.
function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// Wilder's smoothed average (used for ATR).
function wilderSmooth(values: number[], period = 14): number | null {
  if (values.length < period) return null;
  let avg = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    avg = (avg * (period - 1) + values[i]) / period;
  }
  return avg;
}


export default defineTool({
  name: "get_technical_indicators",
  title: "Get technical indicators",
  description:
    "Computed technical analysis for an asset from live Binance candles: RSI(14), SMA(20/50), EMA(12/26), MACD, ATR(14) and a simple trend read.",
  inputSchema: {
    symbol: z.string().describe("Asset or pair, e.g. 'BTC' or 'ETHUSDT'."),
    interval: z
      .enum(["5m", "15m", "1h", "4h", "1d"])
      .optional()
      .describe("Candle interval used for the calculation. Default '1h'."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ symbol, interval }) => {
    const pair = toPair(symbol);
    const tf = interval ?? "1h";
    const raw = await binanceGet<Kline[]>("/api/v3/klines", { symbol: pair, interval: tf, limit: 200 });
    if (!raw.length) throw new ToolError(`No candle data for ${pair}`);

    const closes = raw.map((k) => Number(k[4]));
    const highs = raw.map((k) => Number(k[2]));
    const lows = raw.map((k) => Number(k[3]));

    const trs: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      trs.push(
        Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])),
      );
    }

    const ema12 = ema(closes, 12);
    const ema26 = ema(closes, 26);
    const sma20 = sma(closes, 20);
    const sma50 = sma(closes, 50);
    const price = closes[closes.length - 1];
    const rsi14 = rsi(closes, 14);

    const trend =
      sma20 !== null && sma50 !== null
        ? sma20 > sma50 && price > sma20
          ? "bullish"
          : sma20 < sma50 && price < sma20
            ? "bearish"
            : "neutral"
        : "unknown";

    const payload = {
      pair,
      interval: tf,
      price,
      rsi_14: rsi14,
      sma_20: sma20,
      sma_50: sma50,
      ema_12: ema12,
      ema_26: ema26,
      macd: ema12 !== null && ema26 !== null ? ema12 - ema26 : null,
      atr_14: wilderSmooth(trs, 14),
      trend,
    };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
  },
});
