import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { binanceGet, cached } from "../binance";

type Ticker = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
};

export default defineTool({
  name: "get_top_movers",
  title: "Get top movers",
  description:
    "Biggest 24h gainers, losers or volume leaders across Binance USDT spot markets, filtered to reasonably liquid pairs.",
  inputSchema: {
    kind: z
      .enum(["gainers", "losers", "volume"])
      .optional()
      .describe("Ranking to return. Default 'gainers'."),
    limit: z.number().optional().describe("Number of markets, 1-25. Default 10."),
    min_volume_usd: z
      .number()
      .optional()
      .describe("Minimum 24h quote volume in USD. Default 5000000."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ kind, limit, min_volume_usd }) => {
    const rank = kind ?? "gainers";
    const max = Math.min(Math.max(Math.trunc(limit ?? 10) || 10, 1), 25);
    const minVol = Number.isFinite(min_volume_usd) && (min_volume_usd as number) > 0
      ? (min_volume_usd as number)
      : 5_000_000;

    // Cached — see binance.ts's cached() docstring. This is a full-market
    // dataset fetch; without the cache, every call to this tool (or
    // search_assets, which fetches the same dataset) hit Binance fresh.
    const all = await cached("binance:ticker24hr", 8_000, () => binanceGet<Ticker[]>("/api/v3/ticker/24hr", {}));
    const rows = all
      .filter((t) => t.symbol.endsWith("USDT") && !/(UP|DOWN|BULL|BEAR)USDT$/.test(t.symbol))
      .map((t) => ({
        pair: t.symbol,
        price: Number(t.lastPrice),
        change_pct_24h: Number(t.priceChangePercent),
        quote_volume_usd: Number(t.quoteVolume),
      }))
      .filter((t) => t.quote_volume_usd >= minVol);

    rows.sort((a, b) =>
      rank === "volume"
        ? b.quote_volume_usd - a.quote_volume_usd
        : rank === "losers"
          ? a.change_pct_24h - b.change_pct_24h
          : b.change_pct_24h - a.change_pct_24h,
    );

    const payload = { kind: rank, min_volume_usd: minVol, count: Math.min(max, rows.length), markets: rows.slice(0, max) };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
  },
});
