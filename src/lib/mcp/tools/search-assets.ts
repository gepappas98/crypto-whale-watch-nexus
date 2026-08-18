import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { binanceGet } from "../binance";

type Ticker = { symbol: string; lastPrice: string; priceChangePercent: string; quoteVolume: string };

export default defineTool({
  name: "search_assets",
  title: "Search tradable assets",
  description:
    "Find which assets this tracker can query: searches Binance USDT spot markets by name fragment and returns matching pairs with price, 24h change and volume. Use before other tools when unsure of a ticker.",
  inputSchema: {
    query: z.string().describe("Name fragment, e.g. 'sol', 'pepe', 'eth'."),
    limit: z.number().optional().describe("Max results, 1-25. Default 10."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ query, limit }) => {
    const q = query.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const max = Math.min(Math.max(Math.trunc(limit ?? 10) || 10, 1), 25);

    // binanceGet() caches internally per exact URL now (guard module) —
    // same dataset get_top_movers fetches, so a call to either tool within
    // the cache TTL reuses the other's upstream fetch too.
    const all = await binanceGet<Ticker[]>("/api/v3/ticker/24hr", {});
    const matches = all
      .filter((t) => t.symbol.endsWith("USDT") && t.symbol.replace(/USDT$/, "").includes(q))
      .map((t) => ({
        pair: t.symbol,
        asset: t.symbol.replace(/USDT$/, ""),
        price: Number(t.lastPrice),
        change_pct_24h: Number(t.priceChangePercent),
        quote_volume_usd: Number(t.quoteVolume),
      }))
      .sort((a, b) => b.quote_volume_usd - a.quote_volume_usd)
      .slice(0, max);

    const payload = { query: q, count: matches.length, results: matches };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
  },
});
