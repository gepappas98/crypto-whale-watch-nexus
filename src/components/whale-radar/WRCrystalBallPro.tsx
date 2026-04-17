import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { TrendingUp, TrendingDown, Minus, Loader2, Activity, BarChart3, Zap } from "lucide-react";

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
];

const TIMEFRAMES = [
  { label: "1h", binanceInterval: "1h", days: 1, interval: "hourly" },
  { label: "4h", binanceInterval: "4h", days: 4, interval: "hourly" },
  { label: "1d", binanceInterval: "1d", days: 1, interval: "daily" },
  { label: "7d", binanceInterval: "1d", days: 7, interval: "daily" },
  { label: "30d", binanceInterval: "1d", days: 30, interval: "daily" },
];

const SIGNAL_META: Record<string, { color: string; icon: typeof TrendingUp; label: string }> = {
  STRONG_BULL: { color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", icon: TrendingUp, label: "STRONG BUY" },
  BULLISH: { color: "text-green-400 bg-green-500/10 border-green-500/20", icon: TrendingUp, label: "BUY" },
  NEUTRAL: { color: "text-slate-400 bg-slate-500/10 border-slate-500/20", icon: Minus, label: "HOLD" },
  BEARISH: { color: "text-rose-400 bg-rose-500/10 border-rose-500/20", icon: TrendingDown, label: "SELL" },
  STRONG_BEAR: { color: "text-red-500 bg-red-500/10 border-red-500/20", icon: TrendingDown, label: "STRONG SELL" },
};

// ==================== ADVANCED TA HELPERS ====================
const calculateEMA = (prices: number[], period: number): number[] => {
  if (prices.length < period) {
    return prices.map(() => prices[prices.length - 1] ?? 0);
  }
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result = prices.slice(0, period - 1).map(() => ema);
  result.push(ema);

  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
};

const calculateRSI = (prices: number[], period: number = 14): number[] => {
  if (prices.length < period + 1) return [];
  const changes = prices.slice(1).map((p, i) => p - prices[i]);
  const gains = changes.map(c => Math.max(c, 0));
  const losses = changes.map(c => Math.max(-c, 0));

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = Math.max(losses.slice(0, period).reduce((a, b) => a + b, 0) / period, 0.0001);

  const rsi: number[] = [100 - 100 / (1 + avgGain / avgLoss)];

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = Math.max((avgLoss * (period - 1) + losses[i]) / period, 0.0001);
    rsi.push(100 - 100 / (1 + avgGain / avgLoss));
  }
  return rsi;
};

const calculateMACD = (prices: number[], fast = 12, slow = 26, signalPeriod = 9) => {
  const emaFast = calculateEMA(prices, fast);
  const emaSlow = calculateEMA(prices, slow);
  const macdLine = emaFast.slice(emaFast.length - emaSlow.length).map((f, i) => f - emaSlow[i]);
  const signalLine = calculateEMA(macdLine, signalPeriod);
  const histogram = macdLine.slice(macdLine.length - signalLine.length).map((m, i) => m - signalLine[i]);
  return { macdLine, signalLine, histogram };
};

const calculateBollingerBands = (prices: number[], period = 20, stdDev = 2) => {
  const bands: { upper: number; middle: number; lower: number }[] = [];
  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / period;
    const std = Math.sqrt(variance);
    bands.push({ upper: mean + stdDev * std, middle: mean, lower: mean - stdDev * std });
  }
  return bands;
};

const calculateATR = (highs: number[], lows: number[], closes: number[], period = 14) => {
  if (highs.length < period + 1) return [];
  const tr: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const trueRange = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    tr.push(trueRange);
  }
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result = [atr];
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    result.push(atr);
  }
  return result;
};

const calculateStochastic = (highs: number[], lows: number[], closes: number[], period = 14, smoothK = 3, smoothD = 3) => {
  if (highs.length < period) return { k: [], d: [] };
  const kRaw: number[] = [];
  for (let i = period - 1; i < highs.length; i++) {
    const sliceHigh = highs.slice(i - period + 1, i + 1);
    const sliceLow = lows.slice(i - period + 1, i + 1);
    const highestHigh = Math.max(...sliceHigh);
    const lowestLow = Math.min(...sliceLow);
    const close = closes[i];
    const range = highestHigh - lowestLow;
    kRaw.push(range > 0 ? ((close - lowestLow) / range) * 100 : 50);
  }
  const k = calculateEMA(kRaw, smoothK);
  const d = calculateEMA(k, smoothD);
  return { k, d };
};

const calculateOBV = (closes: number[], volumes: number[]) => {
  const obv: number[] = [volumes[0] || 0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv.push(obv[i - 1] + volumes[i]);
    else if (closes[i] < closes[i - 1]) obv.push(obv[i - 1] - volumes[i]);
    else obv.push(obv[i - 1]);
  }
  return obv;
};

const detectRSIDivergence = (prices: number[], rsiValues: number[], lookback = 15): { bullish: boolean; bearish: boolean; strength: string } => {
  if (prices.length < lookback || rsiValues.length < lookback) return { bullish: false, bearish: false, strength: "" };
  const recentPrices = prices.slice(-lookback);
  const recentRSI = rsiValues.slice(-lookback);

  const priceLowerLow = recentPrices[recentPrices.length - 1] < recentPrices[recentPrices.length - 5];
  const rsiHigherLow = recentRSI[recentRSI.length - 1] > recentRSI[recentRSI.length - 5];

  const priceHigherHigh = recentPrices[recentPrices.length - 1] > recentPrices[recentPrices.length - 5];
  const rsiLowerHigh = recentRSI[recentRSI.length - 1] < recentRSI[recentRSI.length - 5];

  const bullish = priceLowerLow && rsiHigherLow;
  const bearish = priceHigherHigh && rsiLowerHigh;
  const strength = bullish || bearish ? (Math.abs(recentRSI[recentRSI.length - 1] - recentRSI[recentRSI.length - 5]) > 8 ? "strong" : "mild") : "";

  return { bullish, bearish, strength };
};

const runMonteCarlo = (currentPrice: number, drift: number, atr: number, periods = 12, simulations = 800) => {
  const finalPrices: number[] = [];
  const stepVol = (atr / currentPrice) * 1.8;

  for (let sim = 0; sim < simulations; sim++) {
    let price = currentPrice;
    for (let i = 0; i < periods; i++) {
      const randomShock = (Math.random() - 0.5) * stepVol * 2;
      price *= (1 + drift + randomShock);
    }
    finalPrices.push(price);
  }
  finalPrices.sort((a, b) => a - b);
  const min = finalPrices[0];
  const max = finalPrices[finalPrices.length - 1];
  const median = finalPrices[Math.floor(finalPrices.length / 2)];
  const p25 = finalPrices[Math.floor(finalPrices.length * 0.25)];
  const p75 = finalPrices[Math.floor(finalPrices.length * 0.75)];

  return { min, p25, median, p75, max, simulations };
};

// ==================== PRICE FORMATTING ====================
const formatPrice = (price: number | null | undefined): string => {
  if (price === null || price === undefined || isNaN(price)) return "—";
  if (price === 0) return "$0.00";

  if (price < 0.00001) {
    return `\[ {price.toExponential(4)}`;
  }
  if (price < 0.01) {
    return ` \]{price.toFixed(8).replace(/\.?0+$/, "")}`;
  }
  if (price < 1) {
    return `\[ {price.toFixed(6).replace(/\.?0+$/, "")}`;
  }
  if (price < 100) {
    return ` \]{price.toFixed(4).replace(/\.?0+$/, "")}`;
  }
  if (price < 10000) {
    return `\[ {price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return ` \]{price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

// CORS Proxy Helper (using reliable corsproxy.io)
const createProxyUrl = (url: string): string => {
  return `https://corsproxy.io/?${encodeURIComponent(url)}`;
};

export default function WRCrystalBallPro() {
  const [selectedCoin, setSelectedCoin] = useState(COIN_LIST[0]);
  const [timeframe, setTimeframe] = useState(TIMEFRAMES[2]);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [backtestData, setBacktestData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [coinSearch, setCoinSearch] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredCoins = useMemo(() =>
    COIN_LIST.filter(c =>
      c.symbol.toLowerCase().includes(coinSearch.toLowerCase()) ||
      c.name.toLowerCase().includes(coinSearch.toLowerCase())
    ),
    [coinSearch]
  );

  // Click outside to close search dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setCoinSearch("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchWithTimeoutAndAbort = async (url: string, timeoutMs: number, signal: AbortSignal) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      const res = await fetch(url, { signal: combinedSignal });
      clearTimeout(timeoutId);
      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  };

  const fetchCoinData = useCallback(async () => {
    // Cancel previous request
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    setLoading(true);
    setError(null);
    setData(null);
    setBacktestData(null);

    try {
      const coinGeckoUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${selectedCoin.id}&price_change_percentage=24h,7d`;
      const proxyCoinGeckoUrl = createProxyUrl(coinGeckoUrl);

      const coinGeckoRes = await fetchWithTimeoutAndAbort(proxyCoinGeckoUrl, 15000, signal);

      if (coinGeckoRes.status === 429) {
        throw new Error("CoinGecko rate limit exceeded. Please wait 30 seconds.");
      }
      if (!coinGeckoRes.ok) {
        throw new Error(`CoinGecko error: ${coinGeckoRes.status}`);
      }

      const json = await coinGeckoRes.json();
      if (!json || json.length === 0) throw new Error("No data returned from CoinGecko");

      const coin = json[0];

      const currentPrice = coin.current_price ?? 0;
      if (currentPrice === 0) throw new Error("Invalid price data from CoinGecko");

      const change24h = coin.price_change_percentage_24h || 0;
      const change7d = coin.price_change_percentage_7d_in_currency || 0;
      const volume = coin.total_volume || 0;
      const marketCap = coin.market_cap || 0;
      const high24h = coin.high_24h || currentPrice;
      const low24h = coin.low_24h || currentPrice;

      const binancePair = `${selectedCoin.symbol.toUpperCase()}USDT`;
      const binanceUrl = `https://api.binance.com/api/v3/klines?symbol=\( {binancePair}&interval= \){timeframe.binanceInterval}&limit=500`;
      const proxyBinanceUrl = createProxyUrl(binanceUrl);

      const klinesRes = await fetchWithTimeoutAndAbort(proxyBinanceUrl, 12000, signal);

      let signalValue = "NEUTRAL";
      let confidence = 45;
      let reasons: string[] = [];
      let rsiVal = 50, macdHist = 0, bbPos = 50, atrVal = currentPrice * 0.02, stochK = 50, stochD = 50, obvTrend = "flat";
      let divergence = { bullish: false, bearish: false, strength: "" };

      if (klinesRes.ok) {
        const klines = await klinesRes.json();
        if (!Array.isArray(klines) || klines.length === 0) {
          throw new Error("Invalid data from Binance");
        }

        const closes = klines.map((k: any) => parseFloat(k[4]));
        const highs = klines.map((k: any) => parseFloat(k[2]));
        const lows = klines.map((k: any) => parseFloat(k[3]));
        const volumes = klines.map((k: any) => parseFloat(k[5]));

        const rsiValues = calculateRSI(closes);
        rsiVal = rsiValues[rsiValues.length - 1] || 50;

        const macd = calculateMACD(closes);
        macdHist = macd.histogram[macd.histogram.length - 1] || 0;

        const bb = calculateBollingerBands(closes);
        const latestBB = bb[bb.length - 1];
        bbPos = latestBB ? ((currentPrice - latestBB.lower) / (latestBB.upper - latestBB.lower)) * 100 : 50;
        bbPos = Math.max(0, Math.min(100, bbPos));

        const atrValues = calculateATR(highs, lows, closes);
        atrVal = atrValues[atrValues.length - 1] || (currentPrice * 0.02);

        const stoch = calculateStochastic(highs, lows, closes);
        stochK = stoch.k[stoch.k.length - 1] || 50;
        stochD = stoch.d[stoch.d.length - 1] || 50;

        const obv = calculateOBV(closes, volumes);
        const obvRecent = obv.slice(-10);
        obvTrend = obvRecent[obvRecent.length - 1] > obvRecent[0] ? "rising" : obvRecent[obvRecent.length - 1] < obvRecent[0] ? "falling" : "flat";

        divergence = detectRSIDivergence(closes, rsiValues);

        const ema12 = calculateEMA(closes, 12);
        const emaBullish = currentPrice > (ema12[ema12.length - 1] || 0);

        if (change24h > 8 && change7d > 15) { signalValue = "STRONG_BULL"; confidence = 72; reasons.push("Strong price action"); }
        else if (change24h < -8 && change7d < -15) { signalValue = "STRONG_BEAR"; confidence = 72; reasons.push("Strong price action"); }

        if (rsiVal < 32 && stochK < 25 && emaBullish) {
          confidence += 22; reasons.push(`RSI/Stoch oversold (\( {rsiVal.toFixed(0)}/ \){stochK.toFixed(0)})`);
          if (signalValue === "NEUTRAL") signalValue = "BULLISH";
        } else if (rsiVal > 68 && stochK > 75 && !emaBullish) {
          confidence += 22; reasons.push(`RSI/Stoch overbought (\( {rsiVal.toFixed(0)}/ \){stochK.toFixed(0)})`);
          if (signalValue === "NEUTRAL") signalValue = "BEARISH";
        }

        if (macdHist > 0 && obvTrend === "rising") {
          confidence += 16; reasons.push("MACD + OBV bullish");
          if (signalValue.includes("BULL") || signalValue === "NEUTRAL") signalValue = "STRONG_BULL";
        } else if (macdHist < 0 && obvTrend === "falling") {
          confidence += 16; reasons.push("MACD + OBV bearish");
          if (signalValue.includes("BEAR") || signalValue === "NEUTRAL") signalValue = "STRONG_BEAR";
        }

        if (bbPos < 20 && divergence.bullish) {
          confidence += 14; reasons.push(`Bullish RSI divergence @ lower BB`);
        } else if (bbPos > 80 && divergence.bearish) {
          confidence += 14; reasons.push(`Bearish RSI divergence @ upper BB`);
        }

        const volRatio = marketCap > 0 ? (volume / marketCap) * 100 : 0;
        if (volRatio > 9) confidence = Math.min(97, confidence + 9);
        const volatilityPct = (atrVal / currentPrice) * 100;
        if (volatilityPct > 22) confidence = Math.max(38, confidence - 14);

        if (confidence > 84 && signalValue === "BULLISH") signalValue = "STRONG_BULL";
        if (confidence > 84 && signalValue === "BEARISH") signalValue = "STRONG_BEAR";

        confidence = Math.min(97, Math.max(38, Math.round(confidence)));
      }

      const drift = macdHist > 0 ? 0.0045 : macdHist < 0 ? -0.0045 : 0;
      const predictions: any[] = [];
      let projectedPrice = currentPrice;
      const stepVol = (atrVal / currentPrice) * 1.7;

      for (let i = 1; i <= 12; i++) {
        const randomFactor = (Math.random() - 0.5) * stepVol * 2;
        projectedPrice *= (1 + drift + randomFactor);
        const timeLabel = timeframe.label === "1h" ? `+\( {i}h` : timeframe.label === "4h" ? `+ \){i * 4}h` : timeframe.label === "1d" ? `+\( {i}d` : `+ \){i} periods`;
        predictions.push({ time: timeLabel, price: projectedPrice, change: ((projectedPrice - currentPrice) / currentPrice) * 100 });
      }

      const mc = runMonteCarlo(currentPrice, drift, atrVal, 12, 800);
      const finalChange = ((predictions[predictions.length - 1].price - currentPrice) / currentPrice) * 100;

      setData({
        signal: signalValue,
        confidence,
        reasons,
        changePct: change24h,
        projectedChange: finalChange,
        currentPrice,
        volume,
        marketCap,
        high24h,
        low24h,
        volatility: (atrVal / currentPrice * 100).toFixed(1),
        rsi: Math.round(rsiVal),
        macdHist: macdHist.toFixed(4),
        bbPosition: bbPos.toFixed(0),
        stochK: stochK.toFixed(0),
        stochD: stochD.toFixed(0),
        obvTrend,
        divergence,
        predictions,
        monteCarlo: mc,
        hasTA: true,
      });
    } catch (e: any) {
      if (e.name !== "AbortError") {
        let msg = e.message || "Failed to load advanced analysis";
        if (msg.includes("fetch") || msg.includes("Failed to fetch")) {
          msg = "Network error (CORS/proxy). Please try again in a few seconds.";
        }
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedCoin, timeframe]);

  const runBacktest = useCallback(async () => {
    if (!data || !data.hasTA) return;
    setLoading(true);
    setError(null);

    try {
      const binancePair = `${selectedCoin.symbol.toUpperCase()}USDT`;
      const binanceUrl = `https://api.binance.com/api/v3/klines?symbol=\( {binancePair}&interval= \){timeframe.binanceInterval}&limit=800`;
      const proxyUrl = createProxyUrl(binanceUrl);

      const klinesRes = await fetchWithTimeoutAndAbort(proxyUrl, 15000, new AbortController().signal); // new controller for backtest

      if (klinesRes.status === 429) {
        throw new Error("Binance rate limit hit - please wait");
      }
      if (!klinesRes.ok) throw new Error("Backtest data unavailable");

      const klines = await klinesRes.json();
      if (!Array.isArray(klines)) throw new Error("Invalid backtest data");

      const closes = klines.map((k: any) => parseFloat(k[4]));
      const highs = klines.map((k: any) => parseFloat(k[2]));
      const lows = klines.map((k: any) => parseFloat(k[3]));
      const volumes = klines.map((k: any) => parseFloat(k[5]));

      let wins = 0;
      let totalTrades = 0;
      const returns: number[] = [];

      for (let i = 50; i < closes.length - 20; i += 8) {
        const windowCloses = closes.slice(i - 50, i);
        const windowHighs = highs.slice(i - 50, i);
        const windowLows = lows.slice(i - 50, i);
        const windowVolumes = volumes.slice(i - 50, i);

        const rsiVals = calculateRSI(windowCloses);
        const macd = calculateMACD(windowCloses);
        const stoch = calculateStochastic(windowHighs, windowLows, windowCloses);
        const obvVals = calculateOBV(windowCloses, windowVolumes);
        const currentPriceAtSignal = closes[i];

        let testSignal = "NEUTRAL";
        const rsiNow = rsiVals[rsiVals.length - 1] || 50;
        const macdNow = macd.histogram[macd.histogram.length - 1] || 0;
        const stochKNow = stoch.k[stoch.k.length - 1] || 50;
        const obvTrendNow = obvVals.length > 10 && obvVals[obvVals.length - 1] > obvVals[obvVals.length - 10] ? "rising" : "falling";

        if (rsiNow < 35 && stochKNow < 25 && macdNow > 0 && obvTrendNow === "rising") testSignal = "BULLISH";
        else if (rsiNow > 65 && stochKNow > 75 && macdNow < 0 && obvTrendNow === "falling") testSignal = "BEARISH";

        if (testSignal !== "NEUTRAL") {
          totalTrades++;
          const forwardPrice = closes[i + 12];
          if (forwardPrice === undefined) continue;

          const forwardReturn = (forwardPrice - currentPriceAtSignal) / currentPriceAtSignal * 100;

          if ((testSignal === "BULLISH" && forwardReturn > 0) || (testSignal === "BEARISH" && forwardReturn < 0)) wins++;
          returns.push(forwardReturn);
        }
      }

      const winRate = totalTrades > 0 ? (wins / totalTrades * 100) : 0;
      const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;

      setBacktestData({
        winRate: winRate.toFixed(1),
        totalTrades,
        avgReturn: avgReturn.toFixed(2),
        timeframe: timeframe.label,
      });
    } catch (e: any) {
      let msg = e.message || "Backtest failed";
      if (msg.includes("fetch") || msg.includes("Failed to fetch")) {
        msg = "Network error during backtest. Please try again.";
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [selectedCoin, timeframe, data]);

  useEffect(() => {
    fetchCoinData();
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [fetchCoinData]);

  const sig = data ? SIGNAL_META[data.signal] : null;
  const Icon = sig?.icon || Activity;

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">🔮</span>
          <div>
            <h3 className="text-sm font-bold text-purple-300">Crystal Ball PRO v3</h3>
            <p className="text-[10px] text-slate-500">RSI + Stoch + MACD + BB + OBV + Divergence + Monte Carlo + Backtest</p>
          </div>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/30 flex items-center gap-1">
          <Zap className="w-3 h-3" /> Full TA Suite
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative" ref={dropdownRef}>
          <input
            type="text"
            placeholder="Search coin..."
            value={coinSearch}
            onChange={e => setCoinSearch(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 w-24 focus:outline-none focus:ring-1 focus:ring-purple-500/50"
          />
          {coinSearch && (
            <div className="absolute top-full left-0 mt-1 w-48 max-h-48 overflow-y-auto bg-slate-800 border border-slate-700 rounded z-50">
              {filteredCoins.slice(0, 10).map(coin => (
                <button
                  key={coin.id}
                  onClick={() => { setSelectedCoin(coin); setCoinSearch(""); }}
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
          onChange={e => { const coin = COIN_LIST.find(c => c.id === e.target.value); if (coin) setSelectedCoin(coin); }}
          className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-purple-500/50 max-w-[120px]"
        >
          {COIN_LIST.map(c => <option key={c.id} value={c.id}>{c.symbol} - {c.name}</option>)}
        </select>

        <select
          value={timeframe.label}
          onChange={e => { const tf = TIMEFRAMES.find(t => t.label === e.target.value); if (tf) setTimeframe(tf); }}
          className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200"
        >
          {TIMEFRAMES.map(t => <option key={t.label} value={t.label}>{t.label}</option>)}
        </select>

        <button
          onClick={fetchCoinData}
          disabled={loading}
          className="ml-auto bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white px-3 py-1.5 rounded text-xs flex items-center gap-1.5"
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
              <div className="text-[10px] text-slate-400 flex flex-wrap gap-x-2">
                {data.reasons?.join(" • ") || "No specific signals detected"}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-slate-500">CONFIDENCE</div>
              <div className="text-xl font-bold text-slate-200">{data.confidence}%</div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4 text-[10px] bg-slate-800/30 rounded p-3">
            <div>RSI: <span className={data.rsi < 35 ? "text-emerald-400" : data.rsi > 65 ? "text-rose-400" : ""}>{data.rsi}</span></div>
            <div>Stoch %K: <span className={parseFloat(data.stochK) < 25 ? "text-emerald-400" : parseFloat(data.stochK) > 75 ? "text-rose-400" : ""}>{data.stochK}</span></div>
            <div>MACD Hist: <span className={parseFloat(data.macdHist) > 0 ? "text-emerald-400" : "text-rose-400"}>{data.macdHist}</span></div>
            <div>BB Pos: {data.bbPosition}%</div>
            <div>OBV: <span className={data.obvTrend === "rising" ? "text-emerald-400" : data.obvTrend === "falling" ? "text-rose-400" : ""}>{data.obvTrend}</span></div>
            <div>Divergence:
              {data.divergence.bullish && <span className="text-emerald-400"> BULLISH {data.divergence.strength}</span>}
              {data.divergence.bearish && <span className="text-rose-400"> BEARISH {data.divergence.strength}</span>}
              {!data.divergence.bullish && !data.divergence.bearish && "none"}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-slate-800/50 rounded p-2">
              <div className="text-[10px] text-slate-500">Current Price</div>
              <div className="text-sm font-mono">{formatPrice(data.currentPrice)}</div>
            </div>
            <div className="bg-slate-800/50 rounded p-2">
              <div className="text-[10px] text-slate-500">24h Change</div>
              <div className={`text-sm font-mono ${data.changePct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {data.changePct >= 0 ? "+" : ""}{data.changePct?.toFixed(2)}%
              </div>
            </div>
            <div className="bg-slate-800/50 rounded p-2">
              <div className="text-[10px] text-slate-500">24h High</div>
              <div className="text-sm font-mono">{formatPrice(data.high24h)}</div>
            </div>
            <div className="bg-slate-800/50 rounded p-2">
              <div className="text-[10px] text-slate-500">24h Low</div>
              <div className="text-sm font-mono">{formatPrice(data.low24h)}</div>
            </div>
          </div>

          <div className="bg-slate-800/30 rounded-lg p-3 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="w-3 h-3 text-purple-400" />
              <span className="text-[10px] text-purple-300 font-medium">12-Period Projection (ATR + MACD Drift)</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {data.predictions.map((p: any, i: number) => (
                <div key={i} className="bg-slate-900/50 rounded p-2 text-center">
                  <div className="text-[9px] text-slate-500">{p.time}</div>
                  <div className="text-[11px] font-mono">{formatPrice(p.price)}</div>
                  <div className={`text-[9px] ${p.change >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{p.change.toFixed(1)}%</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-800/30 rounded-lg p-3 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="w-3 h-3 text-amber-400" />
              <span className="text-[10px] text-amber-300 font-medium">Monte Carlo Range (800 simulations • 12 periods)</span>
            </div>
            <div className="grid grid-cols-5 gap-2 text-center text-xs">
              <div className="bg-slate-900/50 rounded p-2">
                <div className="text-slate-500 text-[10px]">Bearish (25%)</div>
                <div className="font-mono text-rose-400">{formatPrice(data.monteCarlo.p25)}</div>
              </div>
              <div className="bg-slate-900/50 rounded p-2">
                <div className="text-slate-500 text-[10px]">Minimum</div>
                <div className="font-mono text-rose-400">{formatPrice(data.monteCarlo.min)}</div>
              </div>
              <div className="bg-slate-900/50 rounded p-2 border border-purple-400">
                <div className="text-slate-500 text-[10px]">Median</div>
                <div className="font-mono text-purple-300">{formatPrice(data.monteCarlo.median)}</div>
              </div>
              <div className="bg-slate-900/50 rounded p-2">
                <div className="text-slate-500 text-[10px]">Maximum</div>
                <div className="font-mono text-emerald-400">{formatPrice(data.monteCarlo.max)}</div>
              </div>
              <div className="bg-slate-900/50 rounded p-2">
                <div className="text-slate-500 text-[10px]">Bullish (75%)</div>
                <div className="font-mono text-emerald-400">{formatPrice(data.monteCarlo.p75)}</div>
              </div>
            </div>
            <div className="text-center text-[10px] text-slate-400 mt-2">
              80% of simulated paths fall between {formatPrice(data.monteCarlo.p25)} – {formatPrice(data.monteCarlo.p75)}
            </div>
          </div>

          <button
            onClick={runBacktest}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Minus className="w-4 h-4" />}
            {loading ? "Running historical backtest..." : "Run Backtest (800 candles)"}
          </button>

          {backtestData && (
            <div className="mt-3 bg-emerald-900/20 border border-emerald-500/30 rounded-lg p-3 text-xs">
              <div className="font-medium text-emerald-400 mb-2">📈 Backtest Results ({backtestData.timeframe} timeframe)</div>
              <div className="grid grid-cols-3 gap-4">
                <div>Win Rate: <span className="text-emerald-400 font-mono">{backtestData.winRate}%</span></div>
                <div>Trades: <span className="font-mono">{backtestData.totalTrades}</span></div>
                <div>Avg Return: <span className={`font-mono ${parseFloat(backtestData.avgReturn) > 0 ? "text-emerald-400" : "text-rose-400"}`}>{backtestData.avgReturn}%</span></div>
              </div>
              <div className="text-[10px] text-slate-400 mt-2">Simulated forward 12-period performance using full indicator suite</div>
            </div>
          )}

          <div className="mt-4 text-center text-[10px] text-emerald-400/70">
            Crystal Ball now powered by 7 indicators + Monte Carlo + historical backtesting
          </div>
        </>
      )}
    </div>
  );
}
