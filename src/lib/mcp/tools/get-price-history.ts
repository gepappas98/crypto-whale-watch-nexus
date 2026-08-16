import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { binanceGet, toPair } from "../binance";

type Kline = [number, string, string, string, string, string, number, string, number, string, string, string];

const INTERVALS = [
  "1m", "5m", "15m", "30m", "1h", "4h", "6h", "12h", "1d", "1w",
] as const;

export default defineTool({
  name: "get_price_history",
  title: "Get price history (OHLCV)",
  description:
    "Historical candles (open/high/low/close/volume) for a crypto asset from Binance spot, oldest first. Use for charting, trend checks, or feeding your own analysis.",
  inputSchema: {
    symbol: z.string().describe("Asset or pair, e.g. 'BTC' or 'BTCUSDT'."),
    interval: z.enum(INTERVALS).optional().describe("Candle interval. Default '1h'."),
    limit: z.number().optional().describe("Number of candles, 1-500. Default 100."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ symbol, interval, limit }) => {
    const pair = toPair(symbol);
    const tf = interval ?? "1h";
    const max = Math.min(Math.max(Math.trunc(limit ?? 100) || 100, 1), 500);

    const raw = await binanceGet<Kline[]>("/api/v3/klines", { symbol: pair, interval: tf, limit: max });
    const candles = raw.map((k) => ({
      open_time: new Date(k[0]).toISOString(),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      trades: k[8],
    }));

    const payload = { pair, interval: tf, count: candles.length, candles };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
  },
});
