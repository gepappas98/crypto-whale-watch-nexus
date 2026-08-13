import { defineMcp } from "@lovable.dev/mcp-js";
import getMarketSnapshot from "./tools/get-market-snapshot";
import getWhaleTrades from "./tools/get-whale-trades";
import getOrderbookPressure from "./tools/get-orderbook-pressure";
import listCouncilDecisions from "./tools/list-council-decisions";

export default defineMcp({
  name: "crypto-whale-tracker-pro",
  title: "CRYPTO Whale Tracker Pro",
  version: "0.1.0",
  instructions:
    "Live crypto market intelligence from Whale Radar. Use `get_market_snapshot` for 24h price stats, `get_whale_trades` for recent large-notional trades, `get_orderbook_pressure` for bid/ask imbalance, and `list_council_decisions` for the app's AI trading-council verdicts. All data is public and read-only.",
  tools: [getMarketSnapshot, getWhaleTrades, getOrderbookPressure, listCouncilDecisions],
});
