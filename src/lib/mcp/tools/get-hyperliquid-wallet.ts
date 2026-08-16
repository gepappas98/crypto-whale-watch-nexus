import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { jsonFetch } from "../binance";

type ClearingHouse = {
  marginSummary?: { accountValue: string; totalNtlPos: string; totalRawUsd: string };
  crossMaintenanceMarginUsed?: string;
  withdrawable?: string;
  assetPositions?: {
    position: {
      coin: string;
      szi: string;
      entryPx?: string;
      positionValue?: string;
      unrealizedPnl?: string;
      liquidationPx?: string | null;
      leverage?: { type: string; value: number };
    };
  }[];
};

export default defineTool({
  name: "get_hyperliquid_wallet",
  title: "Get Hyperliquid wallet positions",
  description:
    "Public on-chain snapshot of a Hyperliquid wallet: account value, withdrawable balance and every open perp position with size, entry, leverage, liquidation price and unrealised PnL. Useful for whale-wallet tracking.",
  inputSchema: {
    address: z.string().describe("Hyperliquid/EVM wallet address, e.g. '0xabc...'."),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async ({ address }) => {
    const addr = address.trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(addr)) throw new ToolError("address must be a 0x-prefixed 40-hex-character wallet address");

    const state = await jsonFetch<ClearingHouse>("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "clearinghouseState", user: addr }),
    });

    const positions = (state.assetPositions ?? []).map(({ position: p }) => {
      const size = Number(p.szi);
      return {
        asset: p.coin,
        side: size >= 0 ? "long" : "short",
        size: Math.abs(size),
        entry_price: p.entryPx ? Number(p.entryPx) : null,
        position_value_usd: p.positionValue ? Number(p.positionValue) : null,
        unrealized_pnl_usd: p.unrealizedPnl ? Number(p.unrealizedPnl) : null,
        liquidation_price: p.liquidationPx ? Number(p.liquidationPx) : null,
        leverage: p.leverage?.value ?? null,
      };
    });

    const payload = {
      address: addr,
      account_value_usd: Number(state.marginSummary?.accountValue ?? 0),
      total_notional_position_usd: Number(state.marginSummary?.totalNtlPos ?? 0),
      withdrawable_usd: Number(state.withdrawable ?? 0),
      open_positions: positions.length,
      positions,
    };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
  },
});
