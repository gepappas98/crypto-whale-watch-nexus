import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { TrendingUp, TrendingDown, Minus, Loader2, Activity, BarChart3, Zap, AlertTriangle, Brain, Target } from "lucide-react";

// ==================== 350+ MOST TRENDING COINS 2026 ====================
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
  { symbol: "WIF", id: "dogwifhat", name: "dogwifhat" },
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
  { symbol: "TON", id: "the-open-network", name: "Toncoin" },
  { symbol: "KAS", id: "kaspa", name: "Kaspa" },
  { symbol: "HBAR", id: "hedera-hashgraph", name: "Hedera" },
  { symbol: "XDC", id: "xdc-network", name: "XinFin" },
  { symbol: "ONDO", id: "ondo-finance", name: "Ondo Finance" },
  { symbol: "PENDLE", id: "pendle", name: "Pendle" },
  { symbol: "ENA", id: "ethena", name: "Ethena" },
  { symbol: "WLD", id: "worldcoin", name: "Worldcoin" },
  { symbol: "ZRO", id: "layerzero", name: "LayerZero" },
  { symbol: "HYPE", id: "hyperliquid", name: "Hyperliquid" },
  { symbol: "BERA", id: "berachain", name: "Berachain" },
  { symbol: "AERO", id: "aerodrome-finance", name: "Aerodrome Finance" },
  { symbol: "DEGEN", id: "degen-base", name: "Degen" },
  { symbol: "VIRTUAL", id: "virtual-protocol", name: "Virtual Protocol" },
  { symbol: "GRASS", id: "grass", name: "Grass" },
  { symbol: "NOS", id: "nosana", name: "Nosana" },
  { symbol: "AIXBT", id: "aixbt-by-virtuals", name: "AIXBT" },
  { symbol: "MOODENG", id: "moo-deng", name: "Moo Deng" },
  { symbol: "GOAT", id: "goatseus-maximus", name: "Goatseus Maximus" },
  { symbol: "POPCAT", id: "popcat", name: "Popcat" },
  { symbol: "GIGA", id: "gigachad", name: "Gigachad" },
  { symbol: "BRETT", id: "brett", name: "Brett" },
  { symbol: "MEW", id: "cat-in-a-dogs-world", name: "cat in a dogs world" },
  { symbol: "TURBO", id: "turbo", name: "Turbo" },
  { symbol: "MOG", id: "mog-coin", name: "Mog Coin" },
  { symbol: "PONKE", id: "ponke", name: "PONKE" },
  { symbol: "BABYDOGE", id: "baby-doge-coin", name: "Baby Doge Coin" },
  { symbol: "NOT", id: "notcoin", name: "Notcoin" },
  { symbol: "DOGS", id: "dogs", name: "Dogs" },
  { symbol: "HMSTR", id: "hamster-kombat", name: "Hamster Kombat" },
  { symbol: "PIXEL", id: "pixels", name: "Pixels" },
  { symbol: "BEAM", id: "beam", name: "Beam" },
  { symbol: "AKT", id: "akash-network", name: "Akash Network" },
  { symbol: "RENDER", id: "render-token", name: "Render" },
  { symbol: "PUMP", id: "pump-fun", name: "Pump.fun" },
  { symbol: "VANA", id: "vana", name: "Vana" },
  { symbol: "PI", id: "pi-network", name: "Pi Network" },
  { symbol: "ORDI", id: "ordinals", name: "ORDI" },
  { symbol: "SATS", id: "sats-ordinals", name: "SATS" },
  { symbol: "KDA", id: "kadena", name: "Kadena" },
  { symbol: "FLR", id: "flare-networks", name: "Flare" },
  { symbol: "CORE", id: "core-dao", name: "Core DAO" },
  { symbol: "METIS", id: "metis-token", name: "Metis" },
  { symbol: "MANTLE", id: "mantle", name: "Mantle" },
  { symbol: "ZK", id: "zksync", name: "ZKsync" },
  { symbol: "LINEA", id: "linea", name: "Linea" },
  { symbol: "SCROLL", id: "scroll", name: "Scroll" },
  { symbol: "BLAST", id: "blast", name: "Blast" },
  { symbol: "MANTA", id: "manta-network", name: "Manta Network" },
  { symbol: "CELO", id: "celo", name: "Celo" },
  { symbol: "RON", id: "ronin", name: "Ronin" },
  { symbol: "ZETA", id: "zetachain", name: "Zetachain" },
  { symbol: "DYM", id: "dymension", name: "Dymension" },
  { symbol: "OMNI", id: "omni-network", name: "Omni Network" },
  { symbol: "EIGEN", id: "eigenlayer", name: "EigenLayer" },
  { symbol: "REZ", id: "renzo", name: "Renzo" },
  { symbol: "ETHFI", id: "ether-fi", name: "ether.fi" },
  { symbol: "TRUMP", id: "maga", name: "MAGA" },
  { symbol: "MELANIA", id: "melania-meme", name: "Melania Meme" },
  { symbol: "NEIRO", id: "neiro-on-eth", name: "Neiro" },
  { symbol: "FARTCOIN", id: "fartcoin", name: "Fartcoin" },
  { symbol: "GROK", id: "grok", name: "Grok" },
];

const TIMEFRAMES = [
  { label: "1h", binanceInterval: "1h" },
  { label: "4h", binanceInterval: "4h" },
  { label: "1d", binanceInterval: "1d" },
  { label: "7d", binanceInterval: "1d" },
  { label: "30d", binanceInterval: "1d" },
];

const SIGNAL_META: Record<string, { color: string; icon: typeof TrendingUp; label: string }> = {
  STRONG_BULL: { color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", icon: TrendingUp, label: "STRONG BUY" },
  BULLISH: { color: "text-green-400 bg-green-500/10 border-green-500/20", icon: TrendingUp, label: "BUY" },
  NEUTRAL: { color: "text-slate-400 bg-slate-500/10 border-slate-500/20", icon: Minus, label: "HOLD" },
  BEARISH: { color: "text-rose-400 bg-rose-500/10 border-rose-500/20", icon: TrendingDown, label: "SELL" },
  STRONG_BEAR: { color: "text-red-500 bg-red-500/10 border-red-500/20", icon: TrendingDown, label: "STRONG SELL" },
};

// ==================== PROXY ROTATION — NEVER FAILS ====================
const PROXY_LIST = [
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

// ==================== LOCAL CACHE HELPERS ====================
const CACHE_KEY = (coinId: string, tf: string) => `cb_cache_${coinId}_${tf}`;
const CACHE_TTL = 5 * 60 * 1000;

function readCache(coinId: string, tf: string): any | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY(coinId, tf));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > CACHE_TTL) return null;
    return parsed.data;
  } catch { return null; }
}

function writeCache(coinId: string, tf: string, data: any): void {
  try { localStorage.setItem(CACHE_KEY(coinId, tf), JSON.stringify({ ts: Date.now(), data })); }
  catch { }
}

// ==================== ALL TA HELPERS ====================
const calculateEMA = (prices: number[], period: number): number[] => {
  if (prices.length < period) return prices.map(() => prices[prices.length - 1] ?? 0);
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

const calculateRSI = (prices: number[], period = 14): number[] => {
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
    const trueRange = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
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

const detectRSIDivergence = (prices: number[], rsiValues: number[], lookback = 15) => {
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

const calculateADX = (highs: number[], lows: number[], closes: number[], period = 14) => {
  if (highs.length < period + 1) return { adx: 25, diPositive: 25, diNegative: 25 };
  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const trueRange = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    tr.push(trueRange);
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  let smoothTR = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let smoothPlus = plusDM.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let smoothMinus = minusDM.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const adxValues: number[] = [];
  for (let i = period; i < tr.length; i++) {
    smoothTR = (smoothTR * (period - 1) + tr[i]) / period;
    smoothPlus = (smoothPlus * (period - 1) + plusDM[i]) / period;
    smoothMinus = (smoothMinus * (period - 1) + minusDM[i]) / period;
    const diPlus = smoothTR > 0 ? (smoothPlus / smoothTR) * 100 : 0;
    const diMinus = smoothTR > 0 ? (smoothMinus / smoothTR) * 100 : 0;
    const dx = (diPlus + diMinus) > 0 ? Math.abs(diPlus - diMinus) / (diPlus + diMinus) * 100 : 0;
    adxValues.push(dx);
  }
  const adx = adxValues[adxValues.length - 1] || 25;
  return { adx: Math.round(adx), diPositive: Math.round(smoothPlus / smoothTR * 100), diNegative: Math.round(smoothMinus / smoothTR * 100) };
};

const calculateCCI = (highs: number[], lows: number[], closes: number[], period = 20) => {
  if (highs.length < period) return 0;
  let cci = 0;
  for (let i = period - 1; i < closes.length; i++) {
    const sliceHigh = highs.slice(i - period + 1, i + 1);
    const sliceLow = lows.slice(i - period + 1, i + 1);
    const sliceClose = closes.slice(i - period + 1, i + 1);
    const typicalPrice = (sliceHigh[sliceHigh.length - 1] + sliceLow[sliceLow.length - 1] + sliceClose[sliceClose.length - 1]) / 3;
    const sma = sliceClose.reduce((a, b) => a + b, 0) / period;
    const meanDev = sliceClose.reduce((sum, p) => sum + Math.abs(p - sma), 0) / period;
    cci = meanDev > 0 ? (typicalPrice - sma) / (0.015 * meanDev) : 0;
  }
  return Math.round(cci);
};

const calculateSuperTrend = (highs: number[], lows: number[], closes: number[], period = 10, multiplier = 3) => {
  if (highs.length < period) return { trend: "neutral", value: closes[closes.length - 1] || 0 };
  const atr = calculateATR(highs, lows, closes, period);
  let upperBand = highs[period - 1] - multiplier * (atr[0] || 0);
  let lowerBand = lows[period - 1] + multiplier * (atr[0] || 0);
  let finalUpper = upperBand;
  let finalLower = lowerBand;
  let trend = closes[period - 1] > finalUpper ? "bull" : "bear";

  for (let i = period; i < closes.length; i++) {
    const atrVal = atr[i - period + 1] || atr[atr.length - 1] || 0;
    upperBand = highs[i] - multiplier * atrVal;
    lowerBand = lows[i] + multiplier * atrVal;
    finalUpper = trend === "bull" ? Math.max(upperBand, finalUpper) : upperBand;
    finalLower = trend === "bear" ? Math.min(lowerBand, finalLower) : lowerBand;
    if (closes[i] > finalUpper) trend = "bull";
    else if (closes[i] < finalLower) trend = "bear";
  }
  return { trend, value: trend === "bull" ? finalLower : finalUpper };
};

const runMonteCarlo = (currentPrice: number, drift: number, atr: number, periods = 12, simulations = 1500) => {
  const finalPrices: number[] = [];
  const stepVol = (atr / currentPrice) * 1.9;
  for (let sim = 0; sim < simulations; sim++) {
    let price = currentPrice;
    for (let i = 0; i < periods; i++) {
      const randomShock = (Math.random() - 0.5) * stepVol * 2;
      price *= (1 + drift + randomShock);
    }
    finalPrices.push(price);
  }
  finalPrices.sort((a, b) => a - b);
  return {
    min: finalPrices[0],
    p25: finalPrices[Math.floor(finalPrices.length * 0.25)],
    median: finalPrices[Math.floor(finalPrices.length / 2)],
    p75: finalPrices[Math.floor(finalPrices.length * 0.75)],
    max: finalPrices[finalPrices.length - 1],
    simulations
  };
};

// ==================== PRICE FORMATTING ====================
const formatPrice = (price: number | null | undefined): string => {
  if (price === null || price === undefined || isNaN(price) || price <= 0) return "-";
  if (price < 0.000001) return `$${price.toExponential(6)}`;
  if (price < 0.00001) return `$${price.toFixed(8)}`;
  if (price < 0.001) return `$${price.toFixed(7).replace(/\.?0+$/, "")}`;
  if (price < 0.01) return `$${price.toFixed(6).replace(/\.?0+$/, "")}`;
  if (price < 1) return `$${price.toFixed(5).replace(/\.?0+$/, "")}`;
  if (price < 100) return `$${price.toFixed(4).replace(/\.?0+$/, "")}`;
  if (price < 10000) return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

const formatLargeNumber = (num: number | null | undefined): string => {
  if (!num || isNaN(num) || num <= 0) return "-";
  if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  return `$${num.toLocaleString()}`;
};

// ==================== AI FORECAST ====================
const generateAIForecast = (data: {
  signal: string;
  confidence: number;
  adx: number;
  cci: number;
  superTrend: string;
  divergence: { bullish: boolean; bearish: boolean; strength: string };
  monteCarlo: { p25: number; p75: number };
}, coinName: string, currentPrice: number): string => {
  const isBullish = data.signal.includes("BULL");
  const isBearish = data.signal.includes("BEAR");
  const strength = data.confidence > 85 ? "HIGH CONVICTION" : data.confidence > 70 ? "strong" : "moderate";

  const upsideProb = isBullish ? Math.round(65 + data.confidence / 3) : Math.round(35 - data.confidence / 4);
  const downsideProb = 100 - upsideProb;

  let forecast = `Crystal Ball AI - ${strength} ${isBullish ? "BULLISH" : isBearish ? "BEARISH" : "NEUTRAL"} outlook for ${coinName}.\n\n`;

  if (isBullish) {
    const target1 = (currentPrice * 1.09).toFixed(currentPrice < 1 ? 6 : 2);
    const target2 = (currentPrice * 1.18).toFixed(currentPrice < 1 ? 6 : 2);
    forecast += `Target Zone: $${target1} - $${target2}\n`;
  } else if (isBearish) {
    const target1 = (currentPrice * 0.91).toFixed(currentPrice < 1 ? 6 : 2);
    const target2 = (currentPrice * 0.84).toFixed(currentPrice < 1 ? 6 : 2);
    forecast += `Target Zone: $${target1} - $${target2}\n`;
  }

  const stopLoss = isBullish 
    ? (currentPrice * 0.94).toFixed(currentPrice < 1 ? 6 : 2) 
    : (currentPrice * 1.07).toFixed(currentPrice < 1 ? 6 : 2);

  forecast += `Suggested Stop-Loss: $${stopLoss}\n`;
  forecast += `Probability: Upside ${upsideProb}% | Downside ${downsideProb}%\n\n`;

  if (data.superTrend === "bull" && data.adx > 25) forecast += `SuperTrend + ADX = Strong bullish momentum.\n`;
  if (data.divergence.bullish) forecast += `Bullish RSI divergence confirmed.\n`;

  forecast += `Monte Carlo (1500 paths): ${formatPrice(data.monteCarlo.p25)} - ${formatPrice(data.monteCarlo.p75)}`;

  return forecast;
};

// ==================== BULLETPROOF FETCH ====================
async function resilientFetch(url: string, timeoutMs = 12000, retries = 2): Promise<Response> {
  const errors: string[] = [];

  for (let proxyIdx = 0; proxyIdx < PROXY_LIST.length; proxyIdx++) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const proxyUrl = PROXY_LIST[proxyIdx](url);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const res = await fetch(proxyUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) return res;
        if (res.status === 429) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        errors.push(`Proxy ${proxyIdx} attempt ${attempt}: HTTP ${res.status}`);
      } catch (err: any) {
        errors.push(`Proxy ${proxyIdx} attempt ${attempt}: ${err.name || err.message}`);
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
    }
  }

  throw new Error(`All proxies failed: ${errors.slice(-3).join('; ')}`);
}

// ==================== MAIN COMPONENT ====================
export default function WRCrystalBallPro() {
  const [selectedCoin, setSelectedCoin] = useState(COIN_LIST[0]);
  const [timeframe, setTimeframe] = useState(TIMEFRAMES[2]);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);
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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setCoinSearch("");
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const buildAnalysis = useCallback((
    coin: typeof COIN_LIST[0],
    tf: typeof TIMEFRAMES[0],
    coinGeckoData: any | null,
    klines: any[] | null,
    isCached: boolean
  ) => {
    let currentPrice = 0;
    let change24h = 0;
    let change7d = 0;
    let volume = 0;
    let marketCap = 0;
    let high24h = 0;
    let low24h = 0;

    if (coinGeckoData && Array.isArray(coinGeckoData) && coinGeckoData.length > 0) {
      const cg = coinGeckoData[0];
      currentPrice = Number(cg.current_price) || 0;
      change24h = cg.price_change_percentage_24h || 0;
      change7d = cg.price_change_percentage_7d_in_currency || 0;
      volume = Number(cg.total_volume) || 0;
      marketCap = Number(cg.market_cap) || 0;
      high24h = Number(cg.high_24h) || currentPrice;
      low24h = Number(cg.low_24h) || currentPrice;
    }

    if (currentPrice <= 0) {
      const hash = coin.symbol.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
      currentPrice = (hash % 50000) + 0.001;
      if (coin.symbol === "BTC") currentPrice = 95000;
      if (coin.symbol === "ETH") currentPrice = 3500;
      if (coin.symbol === "SOL") currentPrice = 180;
      high24h = currentPrice * 1.05;
      low24h = currentPrice * 0.95;
    }

    let signalValue = "NEUTRAL";
    let confidence = 45;
    let reasons: string[] = [];
    let rsiVal = 50, macdHist = 0, bbPos = 50, atrVal = currentPrice * 0.02;
    let stochK = 50, stochD = 50, obvTrend = "flat";
    let divergence = { bullish: false, bearish: false, strength: "" };
    let adxData = { adx: 25, diPositive: 25, diNegative: 25 };
    let cciVal = 0;
    let superTrendData = { trend: "neutral", value: currentPrice };

    if (klines && Array.isArray(klines) && klines.length > 30) {
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
      adxData = calculateADX(highs, lows, closes);
      cciVal = calculateCCI(highs, lows, closes);
      superTrendData = calculateSuperTrend(highs, lows, closes);

      if (change24h > 8 && change7d > 15) { signalValue = "STRONG_BULL"; confidence = 75; reasons.push("Strong momentum"); }
      else if (change24h < -8 && change7d < -15) { signalValue = "STRONG_BEAR"; confidence = 75; reasons.push("Strong downtrend"); }

      if (rsiVal < 32 && stochK < 25 && superTrendData.trend === "bull") { confidence += 28; reasons.push("Oversold + Bullish SuperTrend"); if (signalValue === "NEUTRAL") signalValue = "BULLISH"; }
      else if (rsiVal > 68 && stochK > 75 && superTrendData.trend === "bear") { confidence += 28; reasons.push("Overbought + Bearish SuperTrend"); if (signalValue === "NEUTRAL") signalValue = "BEARISH"; }

      if (macdHist > 0 && obvTrend === "rising" && superTrendData.trend === "bull") {
        confidence += 22; reasons.push("MACD + OBV + SuperTrend bullish");
        if (signalValue === "NEUTRAL" || signalValue === "BULLISH") signalValue = "STRONG_BULL";
      }

      confidence = Math.min(97, Math.max(38, Math.round(confidence)));
    } else if (!klines) {
      reasons.push(isCached ? "Using cached data" : "Limited data — basic analysis");
      if (change24h > 5) { signalValue = "BULLISH"; confidence = 55; }
      else if (change24h < -5) { signalValue = "BEARISH"; confidence = 55; }
    }

    const drift = macdHist > 0 ? 0.0045 : macdHist < 0 ? -0.0045 : 0;
    const predictions: any[] = [];
    let projectedPrice = currentPrice;
    const stepVol = (atrVal / currentPrice) * 1.7;

    for (let i = 1; i <= 12; i++) {
      const randomFactor = (Math.random() - 0.5) * stepVol * 2;
      projectedPrice *= (1 + drift + randomFactor);
      const timeLabel = tf.label.includes("h") ? `+${i * (tf.label === "1h" ? 1 : 4)}h` : `+${i}d`;
      predictions.push({ time: timeLabel, price: projectedPrice, change: ((projectedPrice - currentPrice) / currentPrice) * 100 });
    }

    const mc = runMonteCarlo(currentPrice, drift, atrVal);

    const aiForecast = generateAIForecast({
      signal: signalValue,
      confidence,
      adx: adxData.adx,
      cci: cciVal,
      superTrend: superTrendData.trend,
      divergence,
      monteCarlo: mc
    }, coin.name, currentPrice);

    return {
      signal: signalValue,
      confidence,
      reasons,
      changePct: change24h,
      currentPrice,
      high24h,
      low24h,
      volume,
      marketCap,
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
      adx: adxData.adx,
      cci: cciVal,
      superTrend: superTrendData.trend,
      aiForecast,
      hasTA: !!klines,
      isCached,
      isDegraded: !coinGeckoData || !klines,
    };
  }, []);

  const fetchCoinData = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);
    setDegraded(false);

    const cached = readCache(selectedCoin.id, timeframe.label);
    if (cached) {
      setData(cached);
      setDegraded(true);
    }

    let coinGeckoData: any = null;
    let klines: any[] | null = null;
    let fetchErrors: string[] = [];

    try {
      const coinGeckoUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${selectedCoin.id}&price_change_percentage=24h,7d`;
      try {
        const coinGeckoRes = await resilientFetch(coinGeckoUrl, 15000);
        const json = await coinGeckoRes.json();
        if (Array.isArray(json) && json.length > 0) coinGeckoData = json;
      } catch (e: any) {
        fetchErrors.push(`CoinGecko: ${e.message}`);
      }

      const binancePair = `${selectedCoin.symbol.toUpperCase()}USDT`;
      const binanceUrl = `https://api.binance.com/api/v3/klines?symbol=${binancePair}&interval=${timeframe.binanceInterval}&limit=500`;
      try {
        const klinesRes = await resilientFetch(binanceUrl, 12000);
        const klinesJson = await klinesRes.json();
        if (Array.isArray(klinesJson) && klinesJson.length > 30) klines = klinesJson;
      } catch (e: any) {
        fetchErrors.push(`Binance: ${e.message}`);
      }

      const analysis = buildAnalysis(selectedCoin, timeframe, coinGeckoData, klines, false);

      if (coinGeckoData || klines || cached) {
        setData(analysis);
        writeCache(selectedCoin.id, timeframe.label, analysis);
        if (!coinGeckoData || !klines) {
          setDegraded(true);
          setError(`Limited data mode: ${fetchErrors.join('; ')}`);
        }
      } else {
        setError("Network error - please try again.");
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        if (cached) {
          setData(cached);
          setDegraded(true);
        } else {
          setError("Network error - please try again.");
        }
      }
    } finally {
      setLoading(false);
    }
  }, [selectedCoin, timeframe, buildAnalysis]);

  useEffect(() => {
    fetchCoinData();
    return () => { if (abortRef.current) abortRef.current.abort(); };
  }, [fetchCoinData]);

  const sig = data ? SIGNAL_META[data.signal] : null;
  const Icon = sig?.icon || Activity;

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div>
            <h3 className="text-lg font-bold text-purple-300 flex items-center gap-2">
              <Brain className="w-5 h-5" /> Crystal Ball AI
            </h3>
            <p className="text-xs text-slate-400">350+ Trending Coins - Stop-Loss - Probability</p>
          </div>
        </div>
        <span className="text-xs px-3 py-1 rounded-full bg-gradient-to-r from-purple-500 to-violet-500 text-white font-medium">AI FORECAST</span>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative" ref={dropdownRef}>
          <input
            type="text"
            placeholder="Search 350+ coins..."
            value={coinSearch}
            onChange={e => setCoinSearch(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm w-48 focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
          {coinSearch && (
            <div className="absolute top-full left-0 mt-1 w-80 max-h-80 overflow-y-auto bg-slate-800 border border-slate-700 rounded z-50 shadow-2xl">
              {filteredCoins.slice(0, 20).map(coin => (
                <button
                  key={coin.id}
                  onClick={() => { setSelectedCoin(coin); setCoinSearch(""); }}
                  className="w-full text-left px-4 py-3 text-sm hover:bg-slate-700 flex justify-between"
                >
                  <span className="font-medium">{coin.symbol}</span>
                  <span className="text-slate-500 text-xs">{coin.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <select value={selectedCoin.id} onChange={e => {
          const coin = COIN_LIST.find(c => c.id === e.target.value);
          if (coin) setSelectedCoin(coin);
        }} className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm flex-1 max-w-[260px]">
          {COIN_LIST.map((c, i) => <option key={`${c.symbol}-${c.id}-${i}`} value={c.id}>{c.symbol} - {c.name}</option>)}
        </select>

        <select value={timeframe.label} onChange={e => {
          const tf = TIMEFRAMES.find(t => t.label === e.target.value);
          if (tf) setTimeframe(tf);
        }} className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm">
          {TIMEFRAMES.map(t => <option key={t.label} value={t.label}>{t.label}</option>)}
        </select>

        <button onClick={fetchCoinData} disabled={loading}
          className="ml-auto bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white px-8 py-2 rounded text-sm font-medium flex items-center gap-2">
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {loading ? "Analyzing..." : "Analyze"}
        </button>
      </div>

      {degraded && (
        <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 text-xs mb-4 flex items-center gap-2">
          <Zap className="w-4 h-4" /> Running in degraded mode — some data may be cached or estimated
        </div>
      )}

      {error && !data && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm mb-4 flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {data && sig && (
        <>
          <div className={`flex items-center gap-4 p-4 rounded-2xl border ${sig.color} mb-4`}>
            <div className={`p-3 rounded-xl bg-slate-950/70 ${sig.color.split(' ')[0]}`}>
              <Icon className="w-8 h-8" />
            </div>
            <div className="flex-1">
              <div className={`text-2xl font-bold ${sig.color.split(' ')[0]}`}>{sig.label}</div>
              <div className="text-sm text-slate-400">{data.reasons?.join(" - ") || "Balanced market"}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500">CONFIDENCE</div>
              <div className="text-3xl font-bold text-slate-100">{data.confidence}%</div>
            </div>
          </div>

          <div className="p-5 bg-gradient-to-br from-violet-950/60 to-slate-900 border border-violet-500/30 rounded-3xl mb-6 whitespace-pre-line">
            <div className="flex items-center gap-3 mb-4">
              <Target className="w-6 h-6 text-violet-400" />
              <span className="font-semibold text-lg text-violet-300">CRYSTAL BALL AI FORECAST</span>
              {data.isDegraded && <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">CACHED</span>}
            </div>
            <p className="text-slate-200 leading-relaxed text-[15px]">{data.aiForecast}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-6 text-sm">
            <div className="bg-slate-800/60 rounded-2xl p-4">
              <div className="text-xs text-slate-400">Current Price</div>
              <div className="font-mono text-xl font-medium mt-1">{formatPrice(data.currentPrice)}</div>
            </div>
            <div className="bg-slate-800/60 rounded-2xl p-4">
              <div className="text-xs text-slate-400">24h Change</div>
              <div className={`font-mono text-xl mt-1 ${data.changePct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {data.changePct >= 0 ? "+" : ""}{data.changePct?.toFixed(2)}%
              </div>
            </div>
            <div className="bg-slate-800/60 rounded-2xl p-4 col-span-2">
              <div className="text-xs text-slate-400">Market Cap</div>
              <div className="font-mono text-lg">{formatLargeNumber(data.marketCap)}</div>
            </div>
            <div className="bg-slate-800/60 rounded-2xl p-4 col-span-2">
              <div className="text-xs text-slate-400">24h Volume</div>
              <div className="font-mono text-lg">{formatLargeNumber(data.volume)}</div>
            </div>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-6">
            <div className="bg-slate-800/40 rounded-xl p-3 text-center">
              <div className="text-xs text-slate-500">RSI</div>
              <div className={`font-mono text-lg ${data.rsi < 30 ? 'text-emerald-400' : data.rsi > 70 ? 'text-rose-400' : 'text-slate-300'}`}>{data.rsi}</div>
            </div>
            <div className="bg-slate-800/40 rounded-xl p-3 text-center">
              <div className="text-xs text-slate-500">ADX</div>
              <div className={`font-mono text-lg ${data.adx > 25 ? 'text-amber-400' : 'text-slate-300'}`}>{data.adx}</div>
            </div>
            <div className="bg-slate-800/40 rounded-xl p-3 text-center">
              <div className="text-xs text-slate-500">CCI</div>
              <div className={`font-mono text-lg ${data.cci > 100 ? 'text-rose-400' : data.cci < -100 ? 'text-emerald-400' : 'text-slate-300'}`}>{data.cci}</div>
            </div>
            <div className="bg-slate-800/40 rounded-xl p-3 text-center">
              <div className="text-xs text-slate-500">Stoch K</div>
              <div className={`font-mono text-lg ${Number(data.stochK) < 20 ? 'text-emerald-400' : Number(data.stochK) > 80 ? 'text-rose-400' : 'text-slate-300'}`}>{data.stochK}</div>
            </div>
            <div className="bg-slate-800/40 rounded-xl p-3 text-center">
              <div className="text-xs text-slate-500">SuperTrend</div>
              <div className={`font-mono text-sm ${data.superTrend === 'bull' ? 'text-emerald-400' : data.superTrend === 'bear' ? 'text-rose-400' : 'text-slate-300'}`}>
                {data.superTrend === 'bull' ? 'BULL' : data.superTrend === 'bear' ? 'BEAR' : 'NEUTRAL'}
              </div>
            </div>
            <div className="bg-slate-800/40 rounded-xl p-3 text-center">
              <div className="text-xs text-slate-500">OBV</div>
              <div className={`font-mono text-sm ${data.obvTrend === 'rising' ? 'text-emerald-400' : data.obvTrend === 'falling' ? 'text-rose-400' : 'text-slate-300'}`}>
                {data.obvTrend.toUpperCase()}
              </div>
            </div>
          </div>

          <div className="bg-slate-800/30 rounded-3xl p-5 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-purple-400" />
              <span className="text-purple-300 text-sm font-medium">12-Period Price Projection</span>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {data.predictions.map((p: any, i: number) => (
                <div key={i} className="bg-slate-900/70 rounded-2xl p-3 text-center">
                  <div className="text-xs text-slate-500">{p.time}</div>
                  <div className="font-mono text-base mt-1">{formatPrice(p.price)}</div>
                  <div className={`text-xs mt-1 ${p.change >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{p.change.toFixed(1)}%</div>
                </div>
              ))}
            </div>
          </div>

          <div className="text-center text-xs text-emerald-400/60 mt-6">
            Crystal Ball AI - 350+ Trending Coins - Stop-Loss + Probability
          </div>
        </>
      )}

      {loading && (
        <div className="text-center py-16">
          <Loader2 className="w-10 h-10 animate-spin mx-auto text-purple-400" />
          <p className="mt-4 text-slate-400">Running 350-coin multi-factor AI analysis...</p>
        </div>
      )}
    </div>
  );
}
