import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { binanceGet, toPair } from "../binance";

type AggTrade = { p: string; q: string; T: number; m: boolean };

export default defineTool({
  name: "get_trade_flow",
  title: "Get buy/sell trade flow",
  description:
    "Aggressive buy vs sell volume for an asset over the most recent trades: notional split, delta, average trade size and the resulting flow bias.",
  inputSchema: {
    symbol: z.string().describe("Asset or pair, e.g. 'BTC' or 'SOLUSDT'."),
    trades: z.number().optional().describe("How many recent trades to analyse, 100-1000. Default 1000."),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async ({ symbol, trades }) => {
    const pair = toPair(symbol);
    const n = Math.min(Math.max(Math.trunc(trades ?? 1000) || 1000, 100), 1000);
    const raw = await binanceGet<AggTrade[]>("/api/v3/aggTrades", { symbol: pair, limit: n });
    if (!raw.length) throw new ToolError(`No recent trades for ${pair}`);

    let buyUsd = 0;
    let sellUsd = 0;
    for (const t of raw) {
      const usd = Number(t.p) * Number(t.q);
      if (t.m) sellUsd += usd;
      else buyUsd += usd;
    }
    const total = buyUsd + sellUsd;
    const delta = buyUsd - sellUsd;
    const buyPct = total > 0 ? (buyUsd / total) * 100 : 0;

    const payload = {
      pair,
      trades_analysed: raw.length,
      window_start: new Date(raw[0].T).toISOString(),
      window_end: new Date(raw[raw.length - 1].T).toISOString(),
      buy_volume_usd: Math.round(buyUsd),
      sell_volume_usd: Math.round(sellUsd),
      delta_usd: Math.round(delta),
      buy_share_pct: Number(buyPct.toFixed(2)),
      avg_trade_usd: Math.round(total / raw.length),
      bias: buyPct > 55 ? "buyers in control" : buyPct < 45 ? "sellers in control" : "balanced",
    };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
  },
});
