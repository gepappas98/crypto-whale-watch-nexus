import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { jsonFetch } from "../binance";

type FngResponse = { data?: { value: string; value_classification: string; timestamp: string }[] };
type GlobalResponse = {
  data?: {
    total_market_cap?: Record<string, number>;
    total_volume?: Record<string, number>;
    market_cap_percentage?: Record<string, number>;
    market_cap_change_percentage_24h_usd?: number;
  };
};

export default defineTool({
  name: "get_market_sentiment",
  title: "Get crypto market sentiment",
  description:
    "Overall crypto market mood: the Fear & Greed index (current plus recent history) alongside total market cap, 24h volume and BTC/ETH dominance.",
  inputSchema: {
    history_days: z.number().optional().describe("Days of Fear & Greed history to include, 1-30. Default 7."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ history_days }) => {
    const days = Math.min(Math.max(Math.trunc(history_days ?? 7) || 7, 1), 30);

    const [fng, global] = await Promise.all([
      jsonFetch<FngResponse>(`https://api.alternative.me/fng/?limit=${days}`).catch(() => ({}) as FngResponse),
      jsonFetch<GlobalResponse>("https://api.coingecko.com/api/v3/global").catch(() => ({}) as GlobalResponse),
    ]);

    const history = (fng.data ?? []).map((d) => ({
      value: Number(d.value),
      label: d.value_classification,
      date: new Date(Number(d.timestamp) * 1000).toISOString(),
    }));

    const payload = {
      fear_greed: history[0] ?? null,
      fear_greed_history: history,
      total_market_cap_usd: global.data?.total_market_cap?.usd ?? null,
      total_volume_24h_usd: global.data?.total_volume?.usd ?? null,
      market_cap_change_pct_24h: global.data?.market_cap_change_percentage_24h_usd ?? null,
      btc_dominance_pct: global.data?.market_cap_percentage?.btc ?? null,
      eth_dominance_pct: global.data?.market_cap_percentage?.eth ?? null,
    };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
  },
});
