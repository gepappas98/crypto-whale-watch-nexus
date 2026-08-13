import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { binanceGet, toPair } from "../binance";

type Ticker = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  quoteVolume: string;
  volume: string;
};

export default defineTool({
  name: "get_market_snapshot",
  title: "Get market snapshot",
  description:
    "Live 24h price snapshot for a crypto asset (price, % change, high/low, volume) sourced from Binance spot markets.",
  inputSchema: {
    symbol: z.string().describe("Asset or pair, e.g. 'BTC', 'SOL' or 'BTCUSDT'. Defaults to USDT quote."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ symbol }) => {
    const pair = toPair(symbol);
    const t = await binanceGet<Ticker>("/api/v3/ticker/24hr", { symbol: pair });
    const snapshot = {
      pair: t.symbol,
      price: Number(t.lastPrice),
      change_24h_pct: Number(t.priceChangePercent),
      high_24h: Number(t.highPrice),
      low_24h: Number(t.lowPrice),
      volume_24h_base: Number(t.volume),
      volume_24h_usd: Number(t.quoteVolume),
      as_of: new Date().toISOString(),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(snapshot) }],
      structuredContent: snapshot,
    };
  },
});
