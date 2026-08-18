import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { jsonFetch } from "../binance";

function base(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(USDT|USDC|USD|BUSD)$/, "") || "BTC";
}

// Each of these returns the venue's last-trade price, not its bid/ask —
// there's no order-book depth involved here (get_orderbook_pressure is the
// tool for that, on a single venue). The description and response `note`
// are worded around that: this is a cross-venue price-spread signal, not
// an executable arbitrage calculation (no fees, slippage, depth, or
// withdrawal/transfer time factored in).

async function binance(b: string) {
  const r = await jsonFetch<{ price: string }>(`https://api.binance.com/api/v3/ticker/price?symbol=${b}USDT`);
  return Number(r.price);
}
async function okx(b: string) {
  const r = await jsonFetch<{ data?: { last: string }[] }>(
    `https://www.okx.com/api/v5/market/ticker?instId=${b}-USDT`,
  );
  return Number(r.data?.[0]?.last);
}
async function bybit(b: string) {
  const r = await jsonFetch<{ result?: { list?: { lastPrice: string }[] } }>(
    `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${b}USDT`,
  );
  return Number(r.result?.list?.[0]?.lastPrice);
}
async function kraken(b: string) {
  const r = await jsonFetch<{ result?: Record<string, { c: string[] }> }>(
    `https://api.kraken.com/0/public/Ticker?pair=${b}USD`,
  );
  const first = Object.values(r.result ?? {})[0];
  return Number(first?.c?.[0]);
}
async function hyperliquid(b: string) {
  const r = await jsonFetch<Record<string, string>>("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "allMids" }),
  });
  return Number(r?.[b]);
}

const SOURCES: Record<string, (b: string) => Promise<number>> = {
  binance,
  okx,
  bybit,
  kraken,
  hyperliquid,
};

export default defineTool({
  name: "compare_exchange_prices",
  title: "Compare prices across exchanges",
  description:
    "Live price of an asset on Binance, OKX, Bybit, Kraken and Hyperliquid side by side, with the cheapest/priciest venues and the cross-exchange spread in percent (arbitrage lead, not a verified opportunity — see the response's own note field).",
  inputSchema: {
    symbol: z.string().describe("Base asset, e.g. 'BTC', 'ETH', 'SOL'."),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async ({ symbol }) => {
    const b = base(symbol);
    const entries = await Promise.all(
      Object.entries(SOURCES).map(async ([name, fn]) => {
        try {
          const price = await fn(b);
          return Number.isFinite(price) && price > 0 ? { exchange: name, price } : null;
        } catch {
          return null;
        }
      }),
    );
    const prices = entries.filter((e): e is { exchange: string; price: number } => e !== null);
    if (!prices.length) throw new ToolError(`No exchange returned a price for ${b}`);

    const cheapest = prices.reduce((a, c) => (c.price < a.price ? c : a));
    const priciest = prices.reduce((a, c) => (c.price > a.price ? c : a));
    const spreadPct = ((priciest.price - cheapest.price) / cheapest.price) * 100;

    const payload = {
      asset: b,
      prices,
      cheapest,
      most_expensive: priciest,
      spread_pct: Number(spreadPct.toFixed(4)),
      note: "Spread ignores fees, slippage and withdrawal times — treat as a lead, not a verified arbitrage.",
    };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
  },
});
