import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { binanceGet, toPair } from "../binance";

type Depth = { bids: [string, string][]; asks: [string, string][] };

export default defineTool({
  name: "get_orderbook_pressure",
  title: "Get order book pressure",
  description:
    "Live order book imbalance for an asset: total bid vs ask liquidity near the spread and the resulting buy/sell pressure bias.",
  inputSchema: {
    symbol: z.string().describe("Asset or pair, e.g. 'ETH' or 'ETHUSDT'."),
    depth: z.number().optional().describe("Number of book levels per side, 5-100. Default 50."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ symbol, depth }) => {
    const pair = toPair(symbol);
    const levels = Math.min(Math.max(Math.trunc(depth ?? 50) || 50, 5), 100);
    const book = await binanceGet<Depth>("/api/v3/depth", { symbol: pair, limit: 100 });

    const sum = (rows: [string, string][]) =>
      rows.slice(0, levels).reduce((acc, [p, q]) => acc + Number(p) * Number(q), 0);

    const bidUsd = sum(book.bids);
    const askUsd = sum(book.asks);
    const total = bidUsd + askUsd;
    const imbalance = total > 0 ? (bidUsd - askUsd) / total : 0;

    const payload = {
      pair,
      levels,
      bid_liquidity_usd: Math.round(bidUsd),
      ask_liquidity_usd: Math.round(askUsd),
      imbalance: Number(imbalance.toFixed(4)),
      bias: imbalance > 0.1 ? "buy_pressure" : imbalance < -0.1 ? "sell_pressure" : "balanced",
      best_bid: Number(book.bids[0]?.[0] ?? 0),
      best_ask: Number(book.asks[0]?.[0] ?? 0),
      as_of: new Date().toISOString(),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
