import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseAnon } from "../supabase";

export default defineTool({
  name: "list_council_decisions",
  title: "List AI council decisions",
  description:
    "Recent verdicts from this app's multi-agent AI trading council (bull/bear/quant/risk/trader/PM — quant only runs at 'deep' depth), newest first. Optionally filter by asset symbol.",
  inputSchema: {
    symbol: z.string().optional().describe("Filter by asset symbol, e.g. 'BTC'."),
    limit: z.number().optional().describe("Max decisions to return, 1-25. Default 10."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ symbol, limit }) => {
    const max = Math.min(Math.max(Math.trunc(limit ?? 10) || 10, 1), 25);
    let query = supabaseAnon()
      .from("council_decisions")
      .select("id,symbol,depth,final_verdict,conviction,price_at,reflection,created_at")
      .order("created_at", { ascending: false })
      .limit(max);

    if (symbol?.trim()) {
      // Was `.ilike("symbol", `%${symbol}%`)` — a substring wildcard match,
      // so filtering by "BTC" could also return "SBTC", "BTCX", or any
      // other symbol merely containing "BTC". Case-insensitive exact match
      // (ilike with no % wildcards) is what "filter by asset symbol" as
      // documented in this tool's inputSchema actually means.
      query = query.ilike("symbol", symbol.trim());
    }

    const { data, error } = await query;
    if (error) throw new ToolError(error.message);

    const payload = { count: data?.length ?? 0, decisions: data ?? [] };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
