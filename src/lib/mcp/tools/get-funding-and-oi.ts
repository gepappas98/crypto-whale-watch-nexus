import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { binanceFuturesGet, toPair } from "../binance";

type PremiumIndex = { symbol: string; markPrice: string; indexPrice: string; lastFundingRate: string; nextFundingTime: number };
type OpenInterest = { symbol: string; openInterest: string; time: number };
type LongShort = { longShortRatio: string; longAccount: string; shortAccount: string; timestamp: number };

export default defineTool({
  name: "get_funding_and_open_interest",
  title: "Get funding rate & open interest",
  description:
    "Perpetual futures positioning for an asset: current funding rate, mark vs index price, open interest, and the top-trader long/short account ratio from Binance futures.",
  inputSchema: {
    symbol: z.string().describe("Asset or perpetual pair, e.g. 'BTC' or 'BTCUSDT'."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ symbol }) => {
    const pair = toPair(symbol);

    const [premium, oi, ratios] = await Promise.all([
      binanceFuturesGet<PremiumIndex>("/fapi/v1/premiumIndex", { symbol: pair }),
      binanceFuturesGet<OpenInterest>("/fapi/v1/openInterest", { symbol: pair }),
      binanceFuturesGet<LongShort[]>("/futures/data/topLongShortAccountRatio", {
        symbol: pair,
        period: "1h",
        limit: 1,
      }).catch(() => [] as LongShort[]),
    ]);

    const fundingRate = Number(premium.lastFundingRate);
    const payload = {
      pair,
      mark_price: Number(premium.markPrice),
      index_price: Number(premium.indexPrice),
      funding_rate: fundingRate,
      funding_rate_pct: fundingRate * 100,
      funding_bias: fundingRate > 0 ? "longs pay shorts" : fundingRate < 0 ? "shorts pay longs" : "flat",
      next_funding_time: new Date(premium.nextFundingTime).toISOString(),
      open_interest: Number(oi.openInterest),
      open_interest_usd: Number(oi.openInterest) * Number(premium.markPrice),
      top_trader_long_short_ratio: ratios[0] ? Number(ratios[0].longShortRatio) : null,
    };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
  },
});
