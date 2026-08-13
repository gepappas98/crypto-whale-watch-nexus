import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { binanceGet, toPair } from "../binance";

type AggTrade = { a: number; p: string; q: string; T: number; m: boolean };

export default defineTool({
  name: "get_whale_trades",
  title: "Get whale trades",
  description:
    "Recent large ('whale') trades for an asset: aggregated Binance trades filtered by a minimum USD notional, newest first.",
  inputSchema: {
    symbol: z.string().describe("Asset or pair, e.g. 'BTC' or 'BTCUSDT'."),
    min_usd: z.number().optional().describe("Minimum trade size in USD. Default 100000."),
    limit: z.number().optional().describe("Max trades to return, 1-50. Default 20."),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async ({ symbol, min_usd, limit }) => {
    const pair = toPair(symbol);
    const minUsd = Number.isFinite(min_usd) && (min_usd as number) > 0 ? (min_usd as number) : 100_000;
    const max = Math.min(Math.max(Math.trunc(limit ?? 20) || 20, 1), 50);

    const raw = await binanceGet<AggTrade[]>("/api/v3/aggTrades", { symbol: pair, limit: 1000 });
    const trades = raw
      .map((t) => {
        const price = Number(t.p);
        const qty = Number(t.q);
        return {
          trade_id: String(t.a),
          asset: pair,
          price,
          quantity: qty,
          amount_usd: Math.round(price * qty),
          transaction_type: t.m ? "sell" : "buy",
          timestamp: new Date(t.T).toISOString(),
        };
      })
      .filter((t) => t.amount_usd >= minUsd)
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
      .slice(0, max);

    const payload = { pair, min_usd: minUsd, count: trades.length, trades };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
