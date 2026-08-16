import { defineMcp } from "@lovable.dev/mcp-js";
import getMarketSnapshot from "./tools/get-market-snapshot";
import getWhaleTrades from "./tools/get-whale-trades";
import getOrderbookPressure from "./tools/get-orderbook-pressure";
import listCouncilDecisions from "./tools/list-council-decisions";
import getPriceHistory from "./tools/get-price-history";
import getTechnicalIndicators from "./tools/get-technical-indicators";
import getTopMovers from "./tools/get-top-movers";
import getFundingAndOi from "./tools/get-funding-and-oi";
import compareExchangePrices from "./tools/compare-exchange-prices";
import getTradeFlow from "./tools/get-trade-flow";
import getHyperliquidMarket from "./tools/get-hyperliquid-market";
import getHyperliquidWallet from "./tools/get-hyperliquid-wallet";
import getMarketSentiment from "./tools/get-market-sentiment";
import searchAssets from "./tools/search-assets";

export default defineMcp({
  name: "crypto-whale-tracker-pro",
  title: "CRYPTO Whale Tracker Pro",
  version: "0.2.0",
  instructions:
    "Live crypto market intelligence from Whale Radar. Price & discovery: `search_assets`, `get_market_snapshot`, `get_price_history`, `get_top_movers`, `compare_exchange_prices`. Flow & microstructure: `get_whale_trades`, `get_trade_flow`, `get_orderbook_pressure`. Derivatives: `get_funding_and_open_interest`, `get_hyperliquid_market`, `get_hyperliquid_wallet`. Analysis: `get_technical_indicators`, `get_market_sentiment`, `list_council_decisions` (this app's AI trading-council verdicts). All data is public and read-only — nothing here places trades.",
  tools: [
    searchAssets,
    getMarketSnapshot,
    getPriceHistory,
    getTopMovers,
    compareExchangePrices,
    getWhaleTrades,
    getTradeFlow,
    getOrderbookPressure,
    getFundingAndOi,
    getHyperliquidMarket,
    getHyperliquidWallet,
    getTechnicalIndicators,
    getMarketSentiment,
    listCouncilDecisions,
  ],
});
