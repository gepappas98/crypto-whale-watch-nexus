import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { jsonFetch } from "../binance";

type Meta = { universe: { name: string; maxLeverage?: number }[] };
type Ctx = {
  funding: string;
  openInterest: string;
  markPx: string;
  midPx?: string;
  prevDayPx: string;
  dayNtlVlm: string;
};

export default defineTool({
  name: "get_hyperliquid_market",
  title: "Get Hyperliquid perp market",
  description:
    "Live Hyperliquid perpetual data for an asset: mark price, 24h change and volume, funding rate, open interest and max leverage. Omit the symbol to get the busiest markets.",
  inputSchema: {
    symbol: z.string().optional().describe("Base asset, e.g. 'BTC'. Omit for a top-markets list."),
    limit: z.number().optional().describe("Markets to return when no symbol is given, 1-25. Default 10."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ symbol, limit }) => {
    // jsonFetch() caches internally now (guard module, keyed by
    // method+url+body) — metaAndAssetCtxs returns the entire Hyperliquid
    // market universe, so this matters even more than the Binance calls.
    const res = await jsonFetch<[Meta, Ctx[]]>("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    });
    const [meta, ctxs] = res;
    if (!meta?.universe?.length) throw new ToolError("Hyperliquid returned no market metadata");

    const markets = meta.universe.map((u, i) => {
      const c = ctxs[i];
      const mark = Number(c?.markPx ?? 0);
      const prev = Number(c?.prevDayPx ?? 0);
      return {
        asset: u.name,
        mark_price: mark,
        mid_price: c?.midPx ? Number(c.midPx) : null,
        change_pct_24h: prev > 0 ? Number((((mark - prev) / prev) * 100).toFixed(2)) : null,
        volume_24h_usd: Number(c?.dayNtlVlm ?? 0),
        funding_rate: Number(c?.funding ?? 0),
        open_interest: Number(c?.openInterest ?? 0),
        max_leverage: u.maxLeverage ?? null,
      };
    });

    if (symbol?.trim()) {
      const want = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(USDT|USDC|USD)$/, "");
      const found = markets.find((m) => m.asset.toUpperCase() === want);
      if (!found) throw new ToolError(`${want} is not listed on Hyperliquid`);
      return { content: [{ type: "text", text: JSON.stringify(found) }], structuredContent: found };
    }

    const max = Math.min(Math.max(Math.trunc(limit ?? 10) || 10, 1), 25);
    const top = [...markets].sort((a, b) => b.volume_24h_usd - a.volume_24h_usd).slice(0, max);
    const payload = { count: top.length, markets: top };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
  },
});
