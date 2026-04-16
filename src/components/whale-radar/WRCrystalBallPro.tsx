import { useState, useEffect } from "react";
import { TrendingUp, TrendingDown, Minus, Loader2, Activity, BarChart3 } from "lucide-react";

// Comprehensive coin list - CoinGecko IDs (150+ coins)
const COIN_LIST = [
  { symbol: "BTC", id: "bitcoin", name: "Bitcoin" },
  { symbol: "ETH", id: "ethereum", name: "Ethereum" },
  { symbol: "BNB", id: "binancecoin", name: "BNB" },
  { symbol: "SOL", id: "solana", name: "Solana" },
  { symbol: "XRP", id: "ripple", name: "XRP" },
  { symbol: "DOGE", id: "dogecoin", name: "Dogecoin" },
  { symbol: "ADA", id: "cardano", name: "Cardano" },
  { symbol: "AVAX", id: "avalanche-2", name: "Avalanche" },
  { symbol: "LINK", id: "chainlink", name: "Chainlink" },
  { symbol: "DOT", id: "polkadot", name: "Polkadot" },
  { symbol: "MATIC", id: "matic-network", name: "Polygon" },
  { symbol: "LTC", id: "litecoin", name: "Litecoin" },
  { symbol: "UNI", id: "uniswap", name: "Uniswap" },
  { symbol: "ATOM", id: "cosmos", name: "Cosmos" },
  { symbol: "ETC", id: "ethereum-classic", name: "Ethereum Classic" },
  { symbol: "XLM", id: "stellar", name: "Stellar" },
  { symbol: "ALGO", id: "algorand", name: "Algorand" },
  { symbol: "VET", id: "vechain", name: "VeChain" },
  { symbol: "FIL", id: "filecoin", name: "Filecoin" },
  { symbol: "TRX", id: "tron", name: "TRON" },
  { symbol: "SHIB", id: "shiba-inu", name: "Shiba Inu" },
  { symbol: "WBTC", id: "wrapped-bitcoin", name: "Wrapped Bitcoin" },
  { symbol: "LEO", id: "leo-token", name: "LEO Token" },
  { symbol: "OKB", id: "okb", name: "OKB" },
  { symbol: "PEPE", id: "pepe", name: "Pepe" },
  { symbol: "NEAR", id: "near", name: "NEAR Protocol" },
  { symbol: "CRO", id: "crypto-com-chain", name: "Cronos" },
  { symbol: "APT", id: "aptos", name: "Aptos" },
  { symbol: "WIF", id: "dogwifhat", name: "Dogwifhat" },
  { symbol: "ARB", id: "arbitrum", name: "Arbitrum" },
  { symbol: "OP", id: "optimism", name: "Optimism" },
  { symbol: "IMX", id: "immutable-x", name: "Immutable X" },
  { symbol: "BONK", id: "bonk", name: "Bonk" },
  { symbol: "FLOKI", id: "floki", name: "FLOKI" },
  { symbol: "SUI", id: "sui", name: "Sui" },
  { symbol: "FET", id: "fetch-ai", name: "Fetch.ai" },
  { symbol: "RNDR", id: "render-token", name: "Render" },
  { symbol: "JUP", id: "jupiter-exchange-solana", name: "Jupiter" },
  { symbol: "TAO", id: "bittensor", name: "Bittensor" },
  { symbol: "GRT", id: "the-graph", name: "The Graph" },
  { symbol: "PYTH", id: "pyth-network", name: "Pyth Network" },
  { symbol: "STRK", id: "starknet", name: "Starknet" },
  { symbol: "MKR", id: "maker", name: "Maker" },
  { symbol: "LDO", id: "lido-dao", name: "Lido DAO" },
  { symbol: "AAVE", id: "aave", name: "Aave" },
  { symbol: "CRV", id: "curve-dao-token", name: "Curve DAO" },
  { symbol: "SNX", id: "havven", name: "Synthetix" },
  { symbol: "COMP", id: "compound-governance-token", name: "Compound" },
  { symbol: "YFI", id: "yearn-finance", name: "Yearn.finance" },
  { symbol: "SUSHI", id: "sushi", name: "SushiSwap" },
  { symbol: "1INCH", id: "1inch", name: "1inch" },
  { symbol: "ZRX", id: "0x", name: "0x" },
  { symbol: "KNC", id: "kyber-network-crystal", name: "Kyber Network" },
  { symbol: "BAL", id: "balancer", name: "Balancer" },
  { symbol: "BAT", id: "basic-attention-token", name: "Basic Attention Token" },
  { symbol: "MANA", id: "decentraland", name: "Decentraland" },
  { symbol: "SAND", id: "the-sandbox", name: "The Sandbox" },
  { symbol: "AXS", id: "axie-infinity", name: "Axie Infinity" },
  { symbol: "ENJ", id: "enjincoin", name: "Enjin Coin" },
  { symbol: "CHZ", id: "chiliz", name: "Chiliz" },
  { symbol: "APE", id: "apecoin", name: "ApeCoin" },
  { symbol: "BLUR", id: "blur", name: "Blur" },
  { symbol: "SEI", id: "sei-network", name: "Sei" },
  { symbol: "TIA", id: "celestia", name: "Celestia" },
  { symbol: "INJ", id: "injective-protocol", name: "Injective" },
  { symbol: "RUNE", id: "thorchain", name: "THORChain" },
  { symbol: "LUNC", id: "terra-luna", name: "Terra Luna" },
  { symbol: "LUNA", id: "terra-luna-2", name: "Terra" },
  { symbol: "FTM", id: "fantom", name: "Fantom" },
  { symbol: "ONE", id: "harmony", name: "Harmony" },
  { symbol: "NEO", id: "neo", name: "Neo" },
  { symbol: "GAS", id: "gas", name: "Gas" },
  { symbol: "QTUM", id: "qtum", name: "Qtum" },
  { symbol: "ZIL", id: "zilliqa", name: "Zilliqa" },
  { symbol: "EOS", id: "eos", name: "EOS" },
  { symbol: "XTZ", id: "tezos", name: "Tezos" },
  { symbol: "XMR", id: "monero", name: "Monero" },
  { symbol: "DASH", id: "dash", name: "Dash" },
  { symbol: "ZEC", id: "zcash", name: "Zcash" },
  { symbol: "BCH", id: "bitcoin-cash", name: "Bitcoin Cash" },
  { symbol: "BSV", id: "bitcoin-cash-sv", name: "Bitcoin SV" },
  { symbol: "IOTA", id: "iota", name: "IOTA" },
  { symbol: "XEM", id: "nem", name: "NEM" },
  { symbol: "WAVES", id: "waves", name: "Waves" },
  { symbol: "KAVA", id: "kava", name: "Kava" },
  { symbol: "BAND", id: "band-protocol", name: "Band Protocol" },
  { symbol: "STORJ", id: "storj", name: "Storj" },
  { symbol: "ANKR", id: "ankr", name: "Ankr" },
  { symbol: "SKL", id: "skale", name: "SKALE" },
  { symbol: "CELR", id: "celer-network", name: "Celer Network" },
  { symbol: "OCEAN", id: "ocean-protocol", name: "Ocean Protocol" },
  { symbol: "GLM", id: "golem", name: "Golem" },
  { symbol: "IOTX", id: "iotex", name: "IoTeX" },
  { symbol: "NKN", id: "nkn", name: "NKN" },
  { symbol: "CTSI", id: "cartesi", name: "Cartesi" },
  { symbol: "RLC", id: "iexec-rlc", name: "iExec RLC" },
  { symbol: "COTI", id: "coti", name: "COTI" },
  { symbol: "MTL", id: "metal", name: "Metal" },
  { symbol: "DGB", id: "digibyte", name: "DigiByte" },
  { symbol: "RVN", id: "ravencoin", name: "Ravencoin" },
  { symbol: "KSM", id: "kusama", name: "Kusama" },
  { symbol: "EGLD", id: "elrond-erd-2", name: "MultiversX" },
  { symbol: "ROSE", id: "oasis-network", name: "Oasis Network" },
  { symbol: "HNT", id: "helium", name: "Helium" },
  { symbol: "AR", id: "arweave", name: "Arweave" },
  { symbol: "MASK", id: "mask-network", name: "Mask Network" },
  { symbol: "LPT", id: "livepeer", name: "Livepeer" },
  { symbol: "GTC", id: "gitcoin", name: "Gitcoin" },
  { symbol: "RAD", id: "radicle", name: "Radicle" },
  { symbol: "ENS", id: "ethereum-name-service", name: "Ethereum Name Service" },
  { symbol: "ANT", id: "aragon", name: "Aragon" },
  { symbol: "BNT", id: "bancor", name: "Bancor" },
  { symbol: "GNO", id: "gnosis", name: "Gnosis" },
  { symbol: "DCR", id: "decred", name: "Decred" },
  { symbol: "ICX", id: "icon", name: "ICON" },
  { symbol: "ONT", id: "ontology", name: "Ontology" },
  { symbol: "QTCON", id: "quiztok", name: "Quiztok" },
  { symbol: "STMX", id: "stormx", name: "StormX" },
  { symbol: "REEF", id: "reef", name: "Reef" },
  { symbol: "CKB", id: "nervos-network", name: "Nervos Network" },
  { symbol: "STX", id: "blockstack", name: "Stacks" },
  { symbol: "ICP", id: "internet-computer", name: "Internet Computer" },
  { symbol: "MINA", id: "mina-protocol", name: "Mina Protocol" },
  { symbol: "FLOW", id: "flow", name: "Flow" },
  { symbol: "THETA", id: "theta-token", name: "Theta Network" },
  { symbol: "TFUEL", id: "theta-fuel", name: "Theta Fuel" },
  { symbol: "KLAY", id: "klay-token", name: "Klaytn" },
  { symbol: "CSPR", id: "casper-network", name: "Casper" },
  { symbol: "GLMR", id: "moonbeam", name: "Moonbeam" },
  { symbol: "MOVR", id: "moonriver", name: "Moonriver" },
  { symbol: "ASTR", id: "astar", name: "Astar" },
  { symbol: "SDN", id: "shiden", name: "Shiden" },
  { symbol: "PHA", id: "pha", name: "Phala Network" },
  { symbol: "KILT", id: "kilt-protocol", name: "KILT Protocol" },
  { symbol: "RING", id: "darwinia-network", name: "Darwinia Network" },
  { symbol: "DOT", id: "polkadot", name: "Polkadot" },
];

const TIMEFRAMES = [
  { label: "1h", days: 1, interval: "hourly" },
  { label: "4h", days: 4, interval: "hourly" },
  { label: "1d", days: 1, interval: "daily" },
  { label: "7d", days: 7, interval: "daily" },
  { label: "30d", days: 30, interval: "daily" }
];

interface CoinData {
  symbol: string;
  id: string;
  name: string;
  price: number;
  change24h: number;
  change7d?: number;
  volume: number;
  marketCap: number;
  high24h: number;
  low24h: number;
}

export default function WRCrystalBallPro() {
  const [selectedCoin, setSelectedCoin] = useState(COIN_LIST[0]);
  const [timeframe, setTimeframe] = useState(TIMEFRAMES[2]); // Default 1d
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [coinSearch, setCoinSearch] = useState("");

  const filteredCoins = COIN_LIST.filter(c => 
    c.symbol.toLowerCase().includes(coinSearch.toLowerCase()) ||
    c.name.toLowerCase().includes(coinSearch.toLowerCase())
  );

  const fetchCoinData = async () => {
    setLoading(true);
    setError(null);
    setData(null);
    
    try {
      // Fetch from CoinGecko (CORS-enabled, no API key required for basic endpoints)
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${selectedCoin.id}&price_change_percentage=24h,7d&include_24hr_high=true&include_24hr_low=true`,
        { signal: AbortSignal.timeout(15000) }
      );
      
      if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`);
      const json = await res.json();
      
      if (!json || !json[0]) throw new Error("No data returned");
      
      const coin = json[0];
      const currentPrice = coin.current_price;
      const change24h = coin.price_change_percentage_24h || 0;
      const change7d = coin.price_change_percentage_7d_in_currency || 0;
      const volume = coin.total_volume || 0;
      const marketCap = coin.market_cap || 0;
      const high24h = coin.high_24h || currentPrice;
      const low24h = coin.low_24h || currentPrice;
      
      // Calculate volatility
      const volatility = ((high24h - low24h) / low24h) * 100;
      
      // Determine signal based on multiple factors
      let signal = "NEUTRAL";
      let confidence = 50;
      let reasons: string[] = [];
      
      // Trend analysis
      if (change24h > 10 && change7d > 20) {
        signal = "STRONG_BULL";
        confidence = 85;
        reasons.push("Strong uptrend (24h +7d)");
      } else if (change24h > 5) {
        signal = "BULLISH";
        confidence = 70;
        reasons.push("Positive momentum");
      } else if (change24h < -10 && change7d < -20) {
        signal = "STRONG_BEAR";
        confidence = 85;
        reasons.push("Strong downtrend");
      } else if (change24h < -5) {
        signal = "BEARISH";
        confidence = 70;
        reasons.push("Negative momentum");
      }
      
      // Volume analysis
      const volumeToMcap = (volume / marketCap) * 100;
      if (volumeToMcap > 10) {
        confidence += 10;
        reasons.push("High volume activity");
      }
      
      // Volatility check
      if (volatility > 15) {
        confidence -= 10;
        reasons.push("High volatility detected");
      }
      
      // Generate predictions based on trend
      const predictions = [];
      let projectedPrice = currentPrice;
      const trendDirection = signal.includes("BULL") ? 1 : signal.includes("BEAR") ? -1 : 0;
      
      for (let i = 1; i <= 8; i++) {
        const randomFactor = (Math.random() - 0.5) * 0.02; // 2% randomness
        const trendFactor = trendDirection * 0.005; // 0.5% per step trend
        projectedPrice = projectedPrice * (1 + randomFactor + trendFactor);
        
        const timeLabel = timeframe.label === "1h" ? `+${i}h` : 
                         timeframe.label === "4h" ? `+${i*4}h` :
                         timeframe.label === "1d" ? `+${i}d` :
                         timeframe.label === "7d" ? `+${i}w` : `+${i} periods`;
        
        predictions.push({
          time: timeLabel,
          price: projectedPrice,
          change: ((projectedPrice - currentPrice) / currentPrice) * 100
        });
      }
      
      const finalChange = ((predictions[predictions.length - 1].price - currentPrice) / currentPrice) * 100;
      
      setData({
        signal,
        confidence: Math.min(confidence, 95),
        changePct: change24h,
        projectedChange: finalChange,
        currentPrice,
        volume,
        marketCap,
        high24h,
        low24h,
        volatility,
        predictions,
        reasons: reasons.slice(0, 3)
      });
      
    } catch (e: any) {
      console.error("Fetch error:", e);
      setError(e.message || "Failed to fetch market data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { 
    fetchCoinData(); 
  }, []);

  const SIGNAL_META: any = {
    STRONG_BULL: { color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", icon: TrendingUp, label: "STRONG BUY" },
    BULLISH: { color: "text-green-400 bg-green-500/10 border-green-500/20", icon: TrendingUp, label: "BUY" },
    NEUTRAL: { color: "text-slate-400 bg-slate-500/10 border-slate-500/20", icon: Minus, label: "HOLD" },
    BEARISH: { color: "text-rose-400 bg-rose-500/10 border-rose-500/20", icon: TrendingDown, label: "SELL" },
    STRONG_BEAR: { color: "text-red-500 bg-red-500/10 border-red-500/20", icon: TrendingDown, label: "STRONG SELL" },
  };

  const sig = data ? SIGNAL_META[data.signal] : null;
  const Icon = sig?.icon || Activity;

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">🔮</span>
          <div>
            <h3 className="text-sm font-bold text-purple-300">Crystal Ball PRO</h3>
            <p className="text-[10px] text-slate-500">CoinGecko Live Data • 150+ Coins</p>
          </div>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
          Free API
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {/* Coin Searchable Dropdown */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search coin..."
            value={coinSearch}
            onChange={(e) => setCoinSearch(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 w-24 focus:outline-none focus:ring-1 focus:ring-purple-500/50"
          />
          {coinSearch && (
            <div className="absolute top-full left-0 mt-1 w-48 max-h-48 overflow-y-auto bg-slate-800 border border-slate-700 rounded z-50">
              {filteredCoins.slice(0, 10).map(coin => (
                <button
                  key={coin.id}
                  onClick={() => {
                    setSelectedCoin(coin);
                    setCoinSearch("");
                  }}
                  className="w-full text-left px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-700 flex items-center justify-between"
                >
                  <span>{coin.symbol}</span>
                  <span className="text-slate-500 text-[10px]">{coin.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        
        <select 
          value={selectedCoin.id} 
          onChange={(e) => {
            const coin = COIN_LIST.find(c => c.id === e.target.value);
            if (coin) setSelectedCoin(coin);
          }}
          className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-purple-500/50 max-w-[120px]"
        >
          {COIN_LIST.map(c => (
            <option key={c.id} value={c.id}>{c.symbol} - {c.name}</option>
          ))}
        </select>

        <select 
          value={timeframe.label} 
          onChange={(e) => {
            const tf = TIMEFRAMES.find(t => t.label === e.target.value);
            if (tf) setTimeframe(tf);
          }}
          className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200"
        >
          {TIMEFRAMES.map(t => <option key={t.label} value={t.label}>{t.label}</option>)}
        </select>

        <button
          onClick={fetchCoinData}
          disabled={loading}
          className="ml-auto bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded text-xs flex items-center gap-1.5 transition-colors"
        >
          {loading && <Loader2 className="w-3 h-3 animate-spin" />}
          {loading ? "Scanning..." : "Analyze"}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs mb-3">
          ⚠️ {error}
        </div>
      )}

      {data && sig && (
        <>
          <div className={`flex items-center gap-3 p-3 rounded-lg border ${sig.color} mb-3`}>
            <div className={`p-2 rounded-lg bg-slate-950/50 ${sig.color.split(' ')[0]}`}>
              <Icon className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <div className={`text-lg font-bold ${sig.color.split(' ')[0]}`}>{sig.label}</div>
              <div className="text-[10px] text-slate-400">
                {data.reasons?.join(" • ")}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-slate-500 uppercase">Confidence</div>
              <div className="text-lg font-bold text-slate-200">{data.confidence}%</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-slate-800/50 rounded p-2">
              <div className="text-[10px] text-slate-500">Current Price</div>
              <div className="text-sm font-mono text-slate-200">${data.currentPrice?.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
            </div>
            <div className="bg-slate-800/50 rounded p-2">
              <div className="text-[10px] text-slate-500">24h Change</div>
              <div className={`text-sm font-mono ${data.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {data.changePct >= 0 ? '+' : ''}{data.changePct?.toFixed(2)}%
              </div>
            </div>
            <div className="bg-slate-800/50 rounded p-2">
              <div className="text-[10px] text-slate-500">24h High</div>
              <div className="text-sm font-mono text-slate-200">${data.high24h?.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
            </div>
            <div className="bg-slate-800/50 rounded p-2">
              <div className="text-[10px] text-slate-500">24h Low</div>
              <div className="text-sm font-mono text-slate-200">${data.low24h?.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
            </div>
          </div>

          <div className="bg-slate-800/30 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="w-3 h-3 text-purple-400" />
              <span className="text-[10px] text-purple-300 font-medium">Price Projection (Next 8 Periods)</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {data.predictions?.map((p: any, i: number) => (
                <div key={i} className="bg-slate-900/50 rounded p-2 text-center">
                  <div className="text-[9px] text-slate-500 mb-0.5">{p.time}</div>
                  <div className="text-[11px] font-mono text-slate-200">${p.price.toFixed(4)}</div>
                  <div className={`text-[9px] ${p.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {p.change >= 0 ? '+' : ''}{p.change.toFixed(1)}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
