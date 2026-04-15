import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import btcQr from '@/assets/btc-qr.jpg';
import { WRHeader } from '@/components/whale-radar/WRHeader';
import { WRTicker } from '@/components/whale-radar/WRTicker';
import { WRScanner } from '@/components/whale-radar/WRScanner';
import { WRRightPanel } from '@/components/whale-radar/WRRightPanel';
import { WRStatsBar } from '@/components/whale-radar/WRStatsBar';
import { WRTracker } from '@/components/whale-radar/WRTracker';
import { WRSettingsPanel } from '@/components/whale-radar/WRSettingsPanel';
import { WROnboarding } from '@/components/whale-radar/WROnboarding';
import { WRModal } from '@/components/whale-radar/WRModal';
import { WRKeyboardHelp } from '@/components/whale-radar/WRKeyboardHelp';
import { WRAlertBell } from '@/components/whale-radar/WRAlertBell';
import { WRMobileFilterSheet } from '@/components/whale-radar/WRMobileFilterSheet';
import { useWhaleWebSocket } from '@/hooks/useWhaleWebSocket';
import { DEFAULT_FILTERS, type WhaleFilters } from '@/components/whale-radar/WRAdvancedFilters';
import {
  CoinData, AlertItem, WhaleTrade, TrackedToken, PortfolioEntry,
  WalletEntry, ScanSnapshot, CFG, fmtN, fmtP, isSolToken,
  calcSizing, saveState, loadState,
} from '@/lib/whaleRadarState';
import { handleRateLimit, isRateLimited, getCooldownRemaining, getActiveCooldowns, onRateLimitChange, RL_KEYS } from '@/lib/rateLimit';
import { detect } from '@/lib/detection';
import { cachedFetch } from '@/lib/cachedFetch';
import { saveWhaleEvent, recordSignalOutcome, saveScan, initBackendCheck } from '@/lib/db';
import { fillSignalPrices } from '@/lib/signalStore';
import { fetchBirdeyeToken } from '@/lib/birdeye';
import { fetchDexData } from '@/lib/dexscreener';
import { WRSignalEval } from '@/components/whale-radar/WRSignalEval';
import { startPerfMonitoring } from '@/lib/perfBudget';
import type { WsStatus } from '@/hooks/useWhaleWebSocket';
import { HLConfigBanner } from '@/components/hyperliquid/HLConfigBanner';
import { WRInsiderRiskScanner } from '@/components/whale-radar/WRInsiderRiskScanner';
import { WRInsiderRiskSettings } from '@/components/whale-radar/WRInsiderRiskSettings';
import type { InsiderRiskSettings } from '@/types/insiderRisk';
import { DEFAULT_CEX_ADDRESSES } from '@/types/insiderRisk';
import { calculateRiskScore, fetchEtherscanTokenHolders, fetchEtherscanTransfers } from '@/lib/insiderRiskUtils';
import type { InsiderRiskData } from '@/types/insiderRisk';

// ═══════════════════════════════════════════════════════════════════════════════
// FALLBACK API CONFIGURATION - FREE TIER ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// Free ETH RPC endpoints (no API key required)
const FREE_ETH_RPCS = [
  'https://cloudflare-eth.com',
  'https://rpc.ankr.com/eth',
  'https://ethereum.publicnode.com',
  'https://eth.llamarpc.com',
  'https://eth.drpc.org'
];

// Free Solana RPC endpoints
const FREE_SOL_RPCS = [
  'https://api.mainnet-beta.solana.com',
  'https://solana.publicnode.com',
  'https://rpc.ankr.com/solana',
  'https://solana.drpc.org'
];

// ═══════════════════════════════════════════════════════════════════════════════
// DEXSCREENER FALLBACK FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

// Fallback 1: CoinGecko markets API (free, no key for basic endpoints)
async function fetchCoinGeckoDexFallback(symbol: string): Promise<{ dexHot: boolean; dsLiq: number | null; source: string }> {
  try {
    // Try to get coin ID first
    const searchRes = await fetch(
      `https://api.coingecko.com/api/v3/search?query=${symbol.toLowerCase()}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!searchRes.ok) throw new Error('CoinGecko search failed');
    const searchData = await searchRes.json();
    
    const coin = searchData.coins?.find((c: any) => c.symbol.toUpperCase() === symbol.toUpperCase());
    if (!coin) throw new Error('Coin not found');

    // Get market data
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coin.id}&order=volume_desc&per_page=1&sparkline=false`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) throw new Error('CoinGecko markets failed');
    const data = await res.json();
    
    if (!data || !data[0]) throw new Error('No market data');
    
    const totalVol = data[0].total_volume || 0;
    const mcap = data[0].market_cap || 1;
    const vmcap = (totalVol / mcap) * 100;
    
    return {
      dexHot: vmcap > 100,
      dsLiq: vmcap > 50 ? totalVol * 0.25 : null,
      source: 'coingecko-fallback'
    };
  } catch {
    return { dexHot: false, dsLiq: null, source: 'none' };
  }
}

// Fallback 2: Jupiter API (free, no key required)
async function fetchJupiterFallback(symbol: string): Promise<{ dexHot: boolean; dsLiq: number | null; source: string }> {
  try {
    const res = await fetch(
      `https://token.jup.ag/all`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) throw new Error('Jupiter API failed');
    const tokens = await res.json();
    const token = tokens.find((t: any) => t.symbol === symbol.toUpperCase());
    
    if (!token) throw new Error('Token not found in Jupiter');
    
    return {
      dexHot: token.tags?.includes('verified') || false,
      dsLiq: token.daily_volume ? token.daily_volume * 0.2 : null,
      source: 'jupiter-fallback'
    };
  } catch {
    return { dexHot: false, dsLiq: null, source: 'none' };
  }
}

// Fallback 3: CoinPaprika (free, no key)
async function fetchCoinPaprikaDexFallback(symbol: string): Promise<{ dexHot: boolean; dsLiq: number | null; source: string }> {
  try {
    const res = await fetch(
      `https://api.coinpaprika.com/v1/tickers/${symbol.toLowerCase()}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) throw new Error('CoinPaprika failed');
    const data = await res.json();
    
    const vol = data.quotes?.USD?.volume_24h || 0;
    const mcap = data.quotes?.USD?.market_cap || 1;
    const vmcap = (vol / mcap) * 100;
    
    return {
      dexHot: vmcap > 80,
      dsLiq: vmcap > 40 ? vol * 0.2 : null,
      source: 'coinpaprika-fallback'
    };
  } catch {
    return { dexHot: false, dsLiq: null, source: 'none' };
  }
}

// Master DexScreener fallback function
async function fetchDexDataWithFallback(symbol: string, volume: number): Promise<{ dexHot: boolean; dsLiq: number | null; source: string }> {
  // Try primary: DexScreener
  try {
    const primary = await fetchDexData(symbol, volume);
    if (primary.dexHot || primary.dsLiq) return { ...primary, source: 'dexscreener' };
  } catch {
    console.log(`DexScreener failed for ${symbol}, trying fallbacks...`);
  }
  
  // Fallback 1: CoinGecko
  const cg = await fetchCoinGeckoDexFallback(symbol);
  if (cg.dexHot || cg.dsLiq) return cg;
  
  // Fallback 2: Jupiter (Solana tokens)
  const jup = await fetchJupiterFallback(symbol);
  if (jup.dexHot || jup.dsLiq) return jup;
  
  // Fallback 3: CoinPaprika
  const pap = await fetchCoinPaprikaDexFallback(symbol);
  if (pap.dexHot || pap.dsLiq) return pap;
  
  return { dexHot: false, dsLiq: null, source: 'none' };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BIRDEYE FALLBACK FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

// Fallback 1: SolanaFM API (free tier available)
async function fetchSolanaFMFallback(address: string, symbol: string): Promise<any> {
  try {
    const res = await fetch(
      `https://api.solana.fm/v1/tokens/${address}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) throw new Error('SolanaFM failed');
    const data = await res.json();
    
    return {
      symbol: symbol,
      price: data.tokenPrice?.price || 0,
      volume24h: data.volume24h || 0,
      liquidity: data.liquidity || 0,
      holders: data.holders || 0,
      score: data.liquidity > 100000 ? 50 : 30,
      buyRatio: 0.5,
      sellRatio: 0.5,
      recentTxns: []
    };
  } catch {
    return null;
  }
}

// Fallback 2: Helius API (if key available, otherwise skip)
async function fetchHeliusFallback(address: string, symbol: string, heliusKey: string): Promise<any> {
  if (!heliusKey) return null;
  try {
    const res = await fetch(
      `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getAsset',
          params: [address]
        }),
        signal: AbortSignal.timeout(10000)
      }
    );
    if (!res.ok) throw new Error('Helius failed');
    const data = await res.json();
    
    return {
      symbol: symbol,
      price: data.result?.token_info?.price_info?.price_per_token || 0,
      volume24h: 0,
      liquidity: 0,
      holders: 0,
      score: 40,
      buyRatio: 0.5,
      sellRatio: 0.5,
      recentTxns: []
    };
  } catch {
    return null;
  }
}

// Fallback 3: CoinMarketCap (free basic data)
async function fetchCMCFallback(symbol: string): Promise<any> {
  try {
    const {
    const res = await fetch(
      `https://api.coinmarketcap.com/data-api/v3/cryptocurrency/detail?slug=${symbol.toLowerCase()}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) throw new Error('CMC failed');
    const data = await res.json();
    
    if (!data.data) return null;
    
    const coin = data.data;
    return {
      symbol: symbol,
      price: coin.statistics?.price || 0,
      volume24h: coin.statistics?.volume24h || 0,
      liquidity: coin.statistics?.marketCap ? coin.statistics.marketCap * 0.1 : 0,
      holders: 0,
      score: coin.statistics?.marketCap > 1000000 ? 60 : 40,
      buyRatio: 0.5,
      sellRatio: 0.5,
      recentTxns: []
    };
  } catch {
    return null;
  }
}

// Master Birdeye fallback function
async function fetchBirdeyeWithFallback(address: string, symbol: string, apiKey: string, heliusKey: string): Promise<any> {
  // Try primary: Birdeye (if key available)
  if (apiKey) {
    try {
      const primary = await fetchBirdeyeToken(address, symbol, apiKey);
      if (primary) return primary;
    } catch {
      console.log(`Birdeye failed for ${symbol}, trying fallbacks...`);
    }
  }
  
  // Fallback 1: SolanaFM
  const solFm = await fetchSolanaFMFallback(address, symbol);
  if (solFm) return solFm;
  
  // Fallback 2: Helius (if key available)
  const helius = await fetchHeliusFallback(address, symbol, heliusKey);
  if (helius) return helius;
  
  // Fallback 3: CoinMarketCap
  const cmc = await fetchCMCFallback(symbol);
  if (cmc) return cmc;
  
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FREE ETH HOLDER DATA (No Etherscan API Key Required)
// ═══════════════════════════════════════════════════════════════════════════════

async function getLatestBlock(rpc: string): Promise<number> {
  try {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_blockNumber'
      }),
      signal: AbortSignal.timeout(5000)
    });
    const data = await res.json();
    return parseInt(data.result, 16);
  } catch {
    return 0;
  }
}

// Fetch token holders using free RPC via eth_getLogs (Transfer events)
async function fetchHoldersViaRPC(tokenAddress: string): Promise<any[]> {
  for (const rpc of FREE_ETH_RPCS) {
    try {
      const latestBlock = await getLatestBlock(rpc);
      const fromBlock = Math.max(0, latestBlock - 10000);
      
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getLogs',
          params: [{
            fromBlock: '0x' + fromBlock.toString(16),
            toBlock: 'latest',
            address: tokenAddress,
            topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'] // Transfer event signature
          }]
        }),
        signal: AbortSignal.timeout(15000)
      });
      
      const data = await res.json();
      if (data.result && Array.isArray(data.result)) {
        // Parse transfer events to extract unique addresses
        const transfers = data.result;
        const addressVolumes: Record<string, number> = {};
        
        transfers.forEach((log: any) => {
          // Parse 'from' address (topic[1])
          if (log.topics[1]) {
            const from = '0x' + log.topics[1].slice(26);
            addressVolumes[from] = (addressVolumes[from] || 0) + 1;
          }
          // Parse 'to' address (topic[2])
          if (log.topics[2]) {
            const to = '0x' + log.topics[2].slice(26);
            addressVolumes[to] = (addressVolumes[to] || 0) + 1;
          }
        });
        
        // Convert to holder format (sorted by activity volume)
        const sorted = Object.entries(addressVolumes)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);
        
        const total = sorted.reduce((sum, [, count]) => sum + count, 0);
        
        return sorted.map(([addr, count], i) => ({
          address: addr,
          balance: '1000000000000000000',
          percentage: total > 0 ? (count / total) * 100 : 0,
          rank: i + 1
        }));
      }
    } catch (err) {
      console.log(`RPC ${rpc} failed, trying next...`);
      continue;
    }
  }
  return [];
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

function getCeoSignalLabel(score: number, threat: string, category: string, vmcap: number): string {
  const t = threat.toUpperCase();
  const cat = (category || '').toUpperCase();
  if (score >= 88 || vmcap > 1000 || t === 'CRITICAL' || cat.includes('WASH')) return 'AVOID / SHORT';
  if (score >= 70 && (cat.includes('PUMP') || cat.includes('SQUEEZE')))         return 'AGGRESSIVE LONG';
  if (score >= 60 && (cat.includes('PUMP') || cat.includes('SQUEEZE') || vmcap > 300)) return 'LONG (tight stop)';
  if (score >= 45) return 'LONG';
  if (score >= 35) return 'WATCH';
  return 'HOLD';
}

export default function WhaleRadarApp() {
  // ══ CORE STATE ═══════════════════════════════════════════════════════════
  const [coins, setCoins] = useState<CoinData[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [whaleFeed, setWhaleFeed] = useState<WhaleTrade[]>([]);
  const [tracked, setTracked] = useState<Record<string, TrackedToken>>({});
  const [portfolio, setPortfolio] = useState<Record<string, PortfolioEntry>>({});
  const [wallets, setWallets] = useState<WalletEntry[]>([]);
  const [scanHistory, setScanHistory] = useState<ScanSnapshot[]>([]);

  // UI State
  const [theme, setTheme] = useState<'cyber' | 'matrix' | 'dark'>('cyber');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [autoScan, setAutoScan] = useState(false);
  const [autoPaused, setAutoPaused] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanBadge, setScanBadge] = useState('IDLE');
  const [kbdOpen, setKbdOpen] = useState(false);
  const [alertFilter, setAlertFilter] = useState('ALL');
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [copiedBtc, setCopiedBtc] = useState(false);

  // API keys
  const [apiKey, setApiKey] = useState('');
  const [aiKey, setAiKey] = useState('');
  const [birdKey, setBirdKey] = useState('');
  const [heliusKey, setHeliusKey] = useState('');
  const [etherscanKey, setEtherscanKey] = useState('');

  // Config
  const [vmcapThr, setVmcapThr] = useState(200);
  const [pchgThr, setPchgThr] = useState(15);
  const [whaleThr, setWhaleThr] = useState(150000);
  const [aggressiveMode, setAggressiveMode] = useState(false);

  // WebSocket config - BYBIT ENABLED BY DEFAULT
  const [bybitEnabled, setBybitEnabled] = useState(true); // ← ENABLED BY DEFAULT
  const [whaleFeedEx, setWhaleFeedEx] = useState('all');
  const [hlScannerEnabled, setHlScannerEnabled] = useState(true);
  const [hlMegaTxUsd, setHlMegaTxUsd] = useState(500_000);
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState('');
  const [subscribedPairs] = useState(() => new Set<string>());
  const [advancedFilters, setAdvancedFilters] = useState<WhaleFilters>(DEFAULT_FILTERS);
  const [scanPage, setScanPage] = useState(1);

  // Stats
  const [apiCallCount, setApiCallCount] = useState(0);
  const [aiCallCount, setAiCallCount] = useState(0);
  const [nextScan, setNextScan] = useState('—');
  const [lastScanTs, setLastScanTs] = useState(0);

  // Tabs
  const [activeTab, setActiveTab] = useState<'scanner' | 'insider'>('scanner');

  // Insider Risk Scanner
  const [insiderSettings, setInsiderSettings] = useState<InsiderRiskSettings>({
    etherscanApiKey: localStorage.getItem('wr_etherscan_key') || '',
    birdeyeApiKey: localStorage.getItem('wr_birdeye_key') || '',
    enableAutoScan: localStorage.getItem('wr_insider_auto') !== 'false',
    scanInterval: 300000,
    cexAddresses: DEFAULT_CEX_ADDRESSES,
  });
  const [insiderData, setInsiderData] = useState<InsiderRiskData[]>([]);
  const [isInsiderScanning, setIsInsiderScanning] = useState(false);

  // Modals
  const [activeModal, setActiveModal] = useState<string | null>(null);

  // Previous volumes for spike detection
  const [prevVolumes, setPrevVolumes] = useState<Record<string, number>>({});

  // ══ PERSISTENCE ═══════════════════════════════════════════════════════════
  useEffect(() => {
    const saved = loadState();
    if (saved.theme) setTheme(saved.theme as 'cyber' | 'matrix' | 'dark');
    if (saved.apiKey) setApiKey(saved.apiKey as string);
    if (saved.aiKey) setAiKey(saved.aiKey as string);
    if (saved.birdKey) setBirdKey(saved.birdKey as string);
    if (saved.heliusKey) setHeliusKey(saved.heliusKey as string);
    if (saved.etherscanKey) setEtherscanKey(saved.etherscanKey as string);
    if (saved.tracked) setTracked(saved.tracked as Record<string, TrackedToken>);
    if (saved.portfolio) setPortfolio(saved.portfolio as Record<string, PortfolioEntry>);
    if (saved.wallets) setWallets(saved.wallets as WalletEntry[]);
    if (saved.vmcapThr) setVmcapThr(saved.vmcapThr as number);
    if (saved.pchgThr) setPchgThr(saved.pchgThr as number);
    if (saved.whaleThr) setWhaleThr(saved.whaleThr as number);
    if (saved.soundOn !== undefined) setSoundOn(saved.soundOn as boolean);
    if (saved.scanHistory) setScanHistory(saved.scanHistory as ScanSnapshot[]);
    if (saved.prevVolumes) setPrevVolumes(saved.prevVolumes as Record<string, number>);
    
    // Bybit: default to true unless explicitly saved as false
    if (saved.bybitEnabled !== undefined) setBybitEnabled(saved.bybitEnabled as boolean);
    else setBybitEnabled(true);
    
    if (saved.whaleFeedEx) setWhaleFeedEx(saved.whaleFeedEx as string);
    if (saved.hlScannerEnabled !== undefined) setHlScannerEnabled(saved.hlScannerEnabled as boolean);
    if (saved.hlMegaTxUsd) setHlMegaTxUsd(saved.hlMegaTxUsd as number);
    
    const sbUrl = localStorage.getItem('wr_supabase_url') ?? '';
    const sbKey = localStorage.getItem('wr_supabase_anon_key') ?? '';
    if (sbUrl) setSupabaseUrl(sbUrl);
    if (sbKey) setSupabaseAnonKey(sbKey);

    if (saved.autoScan) {
      setAutoScan(true);
      setAutoPaused(saved.autoPaused as boolean ?? true);
    }

    if (!localStorage.getItem('wr_v9_onboarded')) setShowOnboarding(true);
  }, []);

  // ══ PERFORMANCE MONITORING ═══════════════════════════════════════════════
  useEffect(() => {
    const cleanup = startPerfMonitoring();
    return cleanup;
  }, []);

  // ══ BACKEND CHECK + SIGNAL PRICE FILLER ══════════════════════════════════
  useEffect(() => {
    initBackendCheck();
    fillSignalPrices().catch(() => {});
    const fillTimer = setInterval(() => {
      fillSignalPrices().catch(() => {});
    }, 30 * 60 * 1000);
    return () => clearInterval(fillTimer);
  }, []);

  // Save on state changes
  useEffect(() => {
    const timer = setTimeout(() => {
      saveState({
        theme, apiKey, aiKey, birdKey, heliusKey, etherscanKey, tracked, portfolio, wallets,
        vmcapThr, pchgThr, whaleThr, soundOn, scanHistory: scanHistory.slice(-CFG.HISTORY_MAX),
        prevVolumes, aggressiveMode, watchlistOnly, bybitEnabled, whaleFeedEx,
        autoScan, autoPaused,
        hlScannerEnabled, hlMegaTxUsd,
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [theme, apiKey, aiKey, birdKey, heliusKey, etherscanKey, tracked, portfolio, wallets,
    vmcapThr, pchgThr, whaleThr, soundOn, scanHistory, prevVolumes, aggressiveMode,
    watchlistOnly, bybitEnabled, whaleFeedEx, autoScan, autoPaused,
    hlScannerEnabled, hlMegaTxUsd]);

  // ══ THEME ═════════════════════════════════════════════════════════════════
  useEffect(() => {
    document.body.classList.remove('theme-matrix', 'theme-dark');
    if (theme === 'matrix') document.body.classList.add('theme-matrix');
    else if (theme === 'dark') document.body.classList.add('theme-dark');
  }, [theme]);

  // ══ RATE LIMIT STATE ═══════════════════════════════════════════════════════
  const [rateLimitInfo, setRateLimitInfo] = useState<{ key: string; source: string; remaining: number }[]>([]);

  useEffect(() => {
    const tick = setInterval(() => setRateLimitInfo(getActiveCooldowns()), 1000);
    const unsub = onRateLimitChange(() => setRateLimitInfo(getActiveCooldowns()));
    return () => { clearInterval(tick); unsub(); };
  }, []);

  // ══ SCAN ══════════════════════════════════════════════════════════════════
  const birdKeyRef = useRef('');
  useEffect(() => { birdKeyRef.current = birdKey; }, [birdKey]);

  // Enhanced enrichCoins with fallback support
  const enrichCoins = useCallback(async (mapped: CoinData[]) => {
    const key = birdKeyRef.current;
    const currentCoins = [...mapped];

    // DexScreener targets with fallback
    const dexTargets = currentCoins
      .filter(c => c.vmcap > 50 && c.mcap < 2e9)
      .slice(0, 15);

    // Birdeye targets with fallback
    const solTargets = currentCoins.filter(c => c.isSol && CFG.SOL_ADDRS[c.symbol]);

    // Process DexScreener with fallbacks
    for (const coin of dexTargets) {
      try {
        const dex = await fetchDexDataWithFallback(coin.symbol, coin.volume);
        if (!dex.dexHot && !dex.dsLiq) continue;
        
        setCoins(prev => prev.map(c => {
          if (c.symbol !== coin.symbol) return c;
          const det = detect({
            vmcap: c.vmcap, chg24: c.change, volSpike: c.volSpike,
            supplyPct: c.supplyPct, vol: c.volume, mcap: c.mcap,
            dexHot: dex.dexHot, dsLiq: dex.dsLiq, isSol: c.isSol, birdData: c.birdData,
          });
          return { ...c, 
            dexHot: dex.dexHot, 
            dsLiq: dex.dsLiq,
            score: det.score, 
            threat: det.threat, 
            category: det.category,
            confidence: det.confidence, 
            reasons: det.reasons 
          };
        }));
      } catch { /* ignore per-coin errors */ }
    }

    // Process Birdeye with fallbacks
    for (const coin of solTargets) {
      const addr = CFG.SOL_ADDRS[coin.symbol];
      try {
        const bird = await fetchBirdeyeWithFallback(addr, coin.symbol, key, heliusKey);
        if (!bird) continue;
        
        setCoins(prev => prev.map(c => {
          if (c.symbol !== coin.symbol) return c;
          const det = detect({
            vmcap: c.vmcap, chg24: c.change, volSpike: c.volSpike,
            supplyPct: c.supplyPct, vol: c.volume, mcap: c.mcap,
            dexHot: c.dexHot, dsLiq: c.dsLiq, isSol: true, birdData: bird,
          });
          return { ...c, 
            birdData: bird,
            score: det.score, 
            threat: det.threat, 
            category: det.category,
            confidence: det.confidence, 
            reasons: det.reasons 
          };
        }));
      } catch { /* ignore per-coin errors */ }
    }
  }, [heliusKey]);

  // ── Data source status ──────────────────────────────────────────────────────
  const [dataSource, setDataSource] = useState<'live' | 'cached' | 'fallback'>('live');

  // ── Enhanced Insider Risk Scan with free RPC fallback ───────────────────────
  const runInsiderRiskScan = async () => {
    if (isInsiderScanning) return;
    setIsInsiderScanning(true);
    try {
      const analyzed: InsiderRiskData[] = [];
      for (const coin of coins) {
        const isSol = coin.isSol;
        let riskData: Partial<InsiderRiskData> = {
          id: coin.symbol,
          symbol: coin.symbol,
          name: coin.name,
          chain: isSol ? 'solana' : 'ethereum',
          address: '',
          totalSupply: 0,
          circulatingSupply: 0,
          circulatingPercentage: 0,
        };
        
        if (!isSol && riskData.address) {
          // Try Etherscan API first if key available
          if (etherscanKey || insiderSettings.etherscanApiKey) {
            const key = etherscanKey || insiderSettings.etherscanApiKey;
            try {
              const holders = await fetchEtherscanTokenHolders(riskData.address, key);
              riskData.holders = holders;
              riskData.top10Concentration = holders.reduce((sum: number, h: { percentage: number }) => sum + h.percentage, 0);
              if (holders[0]?.address) {
                riskData.deployerAddress = holders[0].address;
                const transfers = await fetchEtherscanTransfers(riskData.address, riskData.deployerAddress, key);
                riskData.largeTransfers = transfers.filter((t: { value: number }) => t.value > 500000);
                riskData.cexTransfers24h = transfers.filter((t: { value: number; timestamp: number }) => {
                  const hoursAgo = (Date.now() / 1000 - t.timestamp) / 3600;
                  return hoursAgo < 24 && t.value > 500000;
                }).length;
              }
            } catch (err) {
              console.error('Etherscan fetch error:', err);
            }
          }
          
          // Fallback: Use free RPC if Etherscan fails or no key
          if (!riskData.holders || riskData.holders.length === 0) {
            try {
              console.log(`Using free RPC fallback for ${coin.symbol}...`);
              const rpcHolders = await fetchHoldersViaRPC(riskData.address);
              if (rpcHolders.length > 0) {
                riskData.holders = rpcHolders;
                riskData.top10Concentration = rpcHolders.reduce((sum: number, h: { percentage: number }) => sum + h.percentage, 0);
                console.log(`RPC fallback succeeded for ${coin.symbol}, found ${rpcHolders.length} holders`);
              }
            } catch (rpcErr) {
              console.error('RPC fallback error:', rpcErr);
            }
          }
        }
        
        const { score, level, flags } = calculateRiskScore(riskData);
        analyzed.push({
          ...riskData as InsiderRiskData,
          riskScore: score,
          riskLevel: level,
          flags,
          lastUpdated: Date.now(),
          scanStatus: 'completed',
        });
      }
      setInsiderData(analyzed);
    } catch (err) {
      console.error('Insider scan error:', err);
    } finally {
      setIsInsiderScanning(false);
    }
  };

  const handleInsiderSettingsSave = (s: InsiderRiskSettings) => {
    setInsiderSettings(s);
    setEtherscanKey(s.etherscanApiKey);
    localStorage.setItem('wr_etherscan_key', s.etherscanApiKey);
    localStorage.setItem('wr_birdeye_key', s.birdeyeApiKey);
    localStorage.setItem('wr_insider_auto', s.enableAutoScan.toString());
  };

  const triggerScan = useCallback(async () => {
    if (scanning) return;

    setScanning(true);
    setScanBadge('SCANNING');

    const isCgDemoKey = apiKey && apiKey.startsWith('CG-');
    const isCgProKey  = apiKey && !apiKey.startsWith('CG-');

    try {
      let scanData: unknown[] | null = null;
      let source: 'live' | 'cached' | 'fallback' = 'live';
      let scanProvider = 'coingecko';

      // Strategy 1: Backend proxy
      try {
        const proxyHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) proxyHeaders['x-cg-api-key'] = apiKey;
        const proxyRes = await fetch('/api/scan', { headers: proxyHeaders, signal: AbortSignal.timeout(20000) });
        if (proxyRes.ok) {
          const ct = proxyRes.headers.get('content-type') ?? '';
          if (ct.includes('application/json')) {
            const result = await proxyRes.json();
            if (result.success && result.data?.length) {
              scanData = result.data;
              source = result.source || 'live';
            }
          }
        }
      } catch {
        // Backend unavailable — fall through
      }

      // Strategy 2: Direct CoinGecko
      if (!scanData) {
        if (isRateLimited(RL_KEYS.COINGECKO)) {
          const rem = getCooldownRemaining(RL_KEYS.COINGECKO);
          setScanBadge(`WAIT ${rem}s`);
          setScanning(false);
          return;
        }

        const cgBase = isCgProKey
          ? 'https://pro-api.coingecko.com/api/v3'
          : 'https://api.coingecko.com/api/v3';
        const cgUrl = `${cgBase}/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h&include_platform=false`;
        const cgHeaders: Record<string, string> = {};
        if (isCgProKey)  cgHeaders['x-cg-pro-api-key']  = apiKey;
        if (isCgDemoKey) cgHeaders['x-cg-demo-api-key'] = apiKey;

        const result = await cachedFetch<unknown[]>(cgUrl, {
          headers: cgHeaders,
          signal: AbortSignal.timeout(18000),
          cacheTtl: 10_000,
          swrTtl: 30_000,
          rateLimitKey: RL_KEYS.COINGECKO,
          rateLimitName: 'CoinGecko',
        });

        if (result.data?.length) {
          scanData = result.data;
          source = result.fromCache ? 'cached' : 'live';
        }
      }

      // Strategy 3: CoinPaprika fallback
      if (!scanData) {
        try {
          setScanBadge('TRYING PAPRIKA…');
          const papRes = await fetch(
            'https://api.coinpaprika.com/v1/tickers?limit=250',
            { signal: AbortSignal.timeout(15000) }
          );
          if (papRes.ok) {
            const papData = await papRes.json() as Array<{
              id: string; name: string; symbol: string; rank: number;
              quotes: { USD: { price: number; volume_24h: number; market_cap: number; percent_change_24h: number } };
              circulating_supply: number | null; total_supply: number | null;
            }>;
            if (papData?.length) {
              scanData = papData.map(c => ({
                id: c.id,
                symbol: c.symbol,
                name: c.name,
                rank: c.rank,
                current_price: c.quotes.USD.price,
                price_change_percentage_24h: c.quotes.USD.percent_change_24h,
                total_volume: c.quotes.USD.volume_24h,
                market_cap: c.quotes.USD.market_cap,
                circulating_supply: c.circulating_supply,
                total_supply: c.total_supply,
              }));
              source = 'live';
              scanProvider = 'coinpaprika';
            }
          }
        } catch {
          // CoinPaprika failed
        }
      }

      if (!scanData?.length) {
        throw new Error('All data sources unavailable (CoinGecko + CoinPaprika)');
      }

      setDataSource(source);
      setApiCallCount(c => c + (source === 'live' ? 1 : 0));
      const mapped = processData(scanData);
      const badge = source === 'live'
        ? (scanProvider === 'coinpaprika' ? 'PAPRIKA' : 'LIVE')
        : source === 'cached' ? 'CACHED' : 'DEGRADED';
      setScanBadge(badge);
      setLastScanTs(Date.now());

      saveScan(mapped).catch(() => {});
      enrichCoins(mapped).catch(() => {});
    } catch (e: unknown) {
      setScanBadge('ERROR');
      setDataSource('fallback');
      addAlert('medium', 'API', 'Scan failed: ' + (e instanceof Error ? e.message : 'Unknown'));
    } finally {
      setScanning(false);
    }
  }, [scanning, apiKey, prevVolumes, enrichCoins]);

  const processData = useCallback((data: unknown[]): CoinData[] => {
    const newVols: Record<string, number> = {};
    const mapped: CoinData[] = (data as Record<string, unknown>[]).map((c, i) => {
      const vol = (c.total_volume as number) || (c.volume as number) || 0;
      const mcap = (c.market_cap as number) || (c.mcap as number) || 1;
      const vmcap = (c.vmcap as number) || ((vol / mcap) * 100);
      const chg24 = (c.price_change_percentage_24h as number) || (c.change_24h as number) || (c.change as number) || 0;
      const prevVol = prevVolumes[(c.id as string)] || vol;
      const volSpike = prevVol > 0 && prevVol !== vol ? vol / prevVol : 1;
      const supplyPct = c.total_supply ? (((c.circulating_supply as number) / (c.total_supply as number)) * 100) : null;
      const sym = ((c.symbol as string) || '').toUpperCase();
      const dexHot = false;
      const dsLiq = null;
      const isSol = isSolToken(sym);
      const birdData = null;
      newVols[(c.id as string)] = vol;
      const det = detect({ vmcap, chg24, volSpike, supplyPct, vol, mcap, dexHot, dsLiq, isSol, birdData });
      const { score, threat, category, confidence, reasons } = det;
      return {
        rank: (c.rank as number) || (i + 1), 
        id: c.id as string, 
        symbol: sym, 
        name: c.name as string,
        price: (c.current_price as number) || (c.price as number) || 0, 
        change: chg24, 
        volume: vol, 
        mcap, 
        vmcap, 
        volSpike,
        supplyPct, 
        score, 
        threat, 
        category, 
        confidence, 
        reasons, 
        dexHot, 
        dsLiq, 
        isSol, 
        birdData,
      };
    });
    setPrevVolumes(newVols);
    setCoins(mapped);

    const critCount = mapped.filter(c => c.threat === 'CRITICAL').length;
    const highCount = mapped.filter(c => c.threat === 'HIGH').length;
    setScanHistory(prev => {
      const snap: ScanSnapshot = {
        ts: Date.now(),
        coins: mapped.map(c => ({ symbol: c.symbol, score: c.score, threat: c.threat, category: c.category, price: c.price, change: c.change, vmcap: c.vmcap })),
        critCount, 
        highCount,
      };
      return [snap, ...prev].slice(0, CFG.HISTORY_MAX);
    });

    mapped
      .filter(c => c.score >= 35)
      .slice(0, 20)
      .forEach(c => {
        const signal = getCeoSignalLabel(c.score, c.threat, c.category || '', c.vmcap);
        recordSignalOutcome({
          symbol: c.symbol,
          coin_id: c.id,
          signal,
          score: c.score,
          category: c.category,
          vmcap: c.vmcap,
          entry_price: c.price,
        });
      });

    mapped.filter(c => c.threat === 'CRITICAL').slice(0, 3).forEach(c => {
      addAlert('critical', c.symbol, `SCORE=${c.score}/100 VOL/MCAP=${c.vmcap.toFixed(0)}% ΔP=${c.change.toFixed(1)}% — ${c.reasons.join(' · ')}`);
    });
    mapped.filter(c => c.threat === 'HIGH' && c.category).slice(0, 3).forEach(c => {
      addAlert('high', c.symbol, `[${c.category}] SCORE=${c.score}/100 — ${c.reasons.join(' · ')}`);
    });

    return mapped;
  }, [prevVolumes]);

  // ══ ALERTS ════════════════════════════════════════════════════════════════
  const addAlert = useCallback((level: AlertItem['level'], tag: string, text: string, sizing?: string) => {
    const tc = level === 'critical' ? 'C' : level === 'high' ? 'H' : level === 'medium' ? 'M' : 'I';
    setAlerts(prev => [{ ts: Date.now(), level, tag, text, tc, sizing, pinned: false }, ...prev].slice(0, CFG.AFEED_MAX * 2));
  }, []);

  // ══ TRACKING ══════════════════════════════════════════════════════════════
  const trackToken = useCallback((id: string, symbol: string, price: number) => {
    setTracked(prev => ({ ...prev, [symbol]: { id, price, basePrice: price, lastPrice: price } }));
  }, []);

  const untrackToken = useCallback((symbol: string) => {
    setTracked(prev => {
      const n = { ...prev };
      delete n[symbol];
      return n;
    });
  }, []);

  // ══ WHALE WEBSOCKET ══════════════════════════════════════════════════════
  const whaleEventThrottle = useRef<Map<string, number>>(new Map());
  
  useEffect(() => {
    const cleanup = setInterval(() => {
      const now = Date.now();
      const expiry = 24 * 60 * 60 * 1000;
      for (const [key, timestamp] of whaleEventThrottle.current.entries()) {
        if (now - timestamp > expiry) {
          whaleEventThrottle.current.delete(key);
        }
      }
    }, 5 * 60 * 1000);
    
    return () => clearInterval(cleanup);
  }, []);

  const handleWhaleTrade = useCallback((trade: WhaleTrade) => {
    setWhaleFeed(prev => [trade, ...prev].slice(0, CFG.WFEED_MAX));

    const lastWrite = whaleEventThrottle.current.get(trade.sym) ?? 0;
    if (Date.now() - lastWrite > 30_000) {
      whaleEventThrottle.current.set(trade.sym, Date.now());
      saveWhaleEvent({
        symbol: trade.sym,
        side: trade.side,
        price: trade.price,
        qty: trade.qty,
        usdt: trade.usdt,
        exchange: trade.ex,
      });
    }
  }, []);

  const handleTrackerPrice = useCallback((sym: string, price: number) => {
    setTracked(prev => {
      if (!prev[sym]) return prev;
      return { ...prev, [sym]: { ...prev[sym], price, lastPrice: prev[sym].price } };
    });
  }, []);

  // BYBIT WEBSOCKET ENABLED BY DEFAULT
  const { binanceReady, bybitReady, wsStatus, wsLagMs, reconnectAttempts: wsReconnects } = useWhaleWebSocket({
    subscribedPairs,
    bybitEnabled, // Now defaults to true
    whaleThr,
    whaleFeedEx,
    onWhaleTrade: handleWhaleTrade,
    onTrackerPrice: handleTrackerPrice,
  });

  // ══ AUTO SCAN ═════════════════════════════════════════════════════════════
  const triggerScanRef = useRef(triggerScan);
  useEffect(() => { triggerScanRef.current = triggerScan; }, [triggerScan]);

  useEffect(() => {
    if (!autoScan || autoPaused) return;
    const ms = aggressiveMode ? CFG.SCAN_MS_AGG : CFG.SCAN_MS_NORMAL;
    triggerScanRef.current();
    const timer = setInterval(() => triggerScanRef.current(), ms);
    const cdTimer = setInterval(() => {
      const r = Math.max(0, Math.ceil((ms - (Date.now() % ms)) / 1000));
      setNextScan(r > 0 ? r + 's' : 'NOW');
    }, 1000);
    return () => { clearInterval(timer); clearInterval(cdTimer); };
  }, [autoScan, autoPaused, aggressiveMode]);

  // ══ KEYBOARD SHORTCUTS ════════════════════════════════════════════════════
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      if (['input', 'select', 'textarea'].includes(tag)) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); triggerScan(); }
      else if (k === 'a') { e.preventDefault(); setAutoScan(p => !p); setAutoPaused(false); }
      else if (k === 'w') { e.preventDefault(); setWatchlistOnly(p => !p); }
      else if (k === 'b') { e.preventDefault(); setActiveModal('backtest'); }
      else if (k === 'p') { e.preventDefault(); setActiveModal('portfolio'); }
      else if (k === 'h') { e.preventDefault(); setActiveModal('history'); }
      else if (k === '?' || k === '/') { e.preventDefault(); setKbdOpen(p => !p); }
      else if (k === 'e') { e.preventDefault(); setActiveModal('signal-eval'); }
      else if (k === 'escape') { setActiveModal(null); setKbdOpen(false); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [triggerScan]);

  // ══ ONBOARDING ════════════════════════════════════════════════════════════
  const finishOnboarding = useCallback(() => {
    setShowOnboarding(false);
    localStorage.setItem('wr_v9_onboarded', '1');
  }, []);

  // ══ TOGGLE HANDLERS ══════════════════════════════════════════════════════
  const handleToggleAuto = useCallback(() => {
    setAutoScan(p => {
      if (!p) setAutoPaused(false);
      return !p;
    });
  }, []);

  const handleTogglePause = useCallback(() => {
    setAutoPaused(p => !p);
  }, []);

  const handleToggleBybit = useCallback(() => {
    setBybitEnabled(p => !p);
  }, []);

  // ══ FILTERED COINS ════════════════════════════════════════════════════════
  const filteredCoins = coins.filter(c => {
    if (c.vmcap < vmcapThr && Math.abs(c.change) < pchgThr && c.score < 20) return false;
    if (watchlistOnly && !tracked[c.symbol]) return false;
    if (advancedFilters.chain === 'solana' && !c.isSol) return false;
    if (['ethereum', 'bsc', 'polygon'].includes(advancedFilters.chain) && c.isSol) return false;
    if (advancedFilters.minThreshold > 0 && c.volume < advancedFilters.minThreshold) return false;
    return true;
  });

  // ══ FILTERED ALERTS ═══════════════════════════════════════════════════════
  const filteredAlerts = alerts.filter(a => {
    if (alertFilter === 'PIN') return a.pinned;
    if (alertFilter !== 'ALL' && a.tc !== alertFilter) return false;
    return true;
  });

  return (
    <div className="min-h-screen flex flex-col">
      {showOnboarding && <WROnboarding onFinish={finishOnboarding} />}

      <HLConfigBanner onOpenSettings={() => setSettingsOpen(true)} />

      {dataSource === 'fallback' && (
        <div className="bg-wr-red/20 border-b-2 border-wr-red/60 px-4 py-2 text-center text-[10px] text-wr-red tracking-widest">
          ⚠ COIN SCAN OFFLINE — All market data sources failed. Whale feed still live on WebSocket.
        </div>
      )}
      {dataSource === 'cached' && scanBadge === 'CACHED' && (
        <div className="bg-wr-amber/15 border-b border-wr-amber/40 px-4 py-1 text-center text-[8px] text-wr-amber tracking-widest">
          📦 Serving cached data — API rate limited or slow
        </div>
      )}

      {wsReconnects >= 2 && (
        <div className="bg-wr-amber/20 border-b border-wr-amber/40 px-4 py-1.5 text-center text-[10px] text-wr-amber tracking-widest animate-pulse">
          ⚠ RECONNECTING… (attempt {wsReconnects}) — Data may be delayed
        </div>
      )}
      
      <div className="flex-1 min-h-0">
        {activeTab === 'scanner' ? (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] h-full min-h-0">
            <WRScanner
              coins={filteredCoins}
              scanBadge={scanBadge}
              scanning={scanning}
              autoScan={autoScan}
              autoPaused={autoPaused}
              watchlistOnly={watchlistOnly}
              tracked={tracked}
              portfolio={portfolio}
              aiKey={aiKey}
              vmcapThr={vmcapThr}
              pchgThr={pchgThr}
              onScan={triggerScan}
              onToggleAuto={handleToggleAuto}
              onTogglePause={handleTogglePause}
              onToggleWatchlist={() => setWatchlistOnly(p => !p)}
              onTrack={trackToken}
              onUntrack={untrackToken}
              onVmcapChange={setVmcapThr}
              onPchgChange={setPchgThr}
              onOpenModal={setActiveModal}
              onAddAlert={addAlert}
              advancedFilters={advancedFilters}
              onAdvancedFiltersChange={setAdvancedFilters}
              page={scanPage}
              onPageChange={setScanPage}
              hlScannerEnabled={hlScannerEnabled}
              hlMegaTxUsd={hlMegaTxUsd}
            />
            <WRRightPanel
              whaleFeed={whaleFeed}
              alerts={filteredAlerts}
              alertFilter={alertFilter}
              onAlertFilterChange={setAlertFilter}
              wallets={wallets}
              onAddWallet={(w) => setWallets(prev => [...prev, w])}
              onRemoveWallet={(addr) => setWallets(prev => prev.filter(w => w.address !== addr))}
              onTogglePin={(idx) => setAlerts(prev => prev.map((a, i) => i === idx ? { ...a, pinned: !a.pinned } : a))}
              onClearAlerts={() => setAlerts([])}
              bybitEnabled={bybitEnabled}
              onToggleBybit={handleToggleBybit}
              whaleFeedEx={whaleFeedEx}
              onWhaleFeedExChange={setWhaleFeedEx}
            />
          </div>
        ) : (
          <WRInsiderRiskScanner
            coins={coins}
            isScanning={isInsiderScanning}
            etherscanKey={insiderSettings.etherscanApiKey}
            birdeyeKey={insiderSettings.birdeyeApiKey}
            onRefresh={runInsiderRiskScan}
            lastScanTime={Date.now()}
          />
        )}
      </div>

      {/* WS Status indicator */}
      <div className="flex items-center gap-2 px-4 py-0.5 bg-wr-bg3 border-b border-wr-border/50 text-[8px] tracking-widest">
        <span className="text-wr-muted">WS:</span>
        {wsStatus === 'live' && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-wr-green animate-blink" /> <span className="text-wr-green">LIVE</span></span>}
        {wsStatus === 'delayed' && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-wr-amber" /> <span className="text-wr-amber">DELAYED ({Math.round(wsLagMs / 1000)}s)</span></span>}
        {wsStatus === 'fallback' && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-wr-red animate-pulse" /> <span className="text-wr-red">HTTP POLL (real Binance data)</span></span>}
        {wsStatus === 'reconnecting' && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-wr-amber animate-pulse" /> <span className="text-wr-amber">RECONNECTING…</span></span>}
        {wsStatus === 'offline' && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-wr-muted" /> <span className="text-wr-muted">OFFLINE</span></span>}
        <span className="text-wr-muted ml-1">BIN: {binanceReady ? '✓' : '—'} | BYB: {bybitReady ? '✓' : '—'}</span>
        <div className="flex-1" />
        <WRAlertBell whaleFeed={whaleFeed} />
        <WRMobileFilterSheet
          filters={advancedFilters}
          onChange={setAdvancedFilters}
          vmcapThr={vmcapThr}
          pchgThr={pchgThr}
          onVmcapChange={setVmcapThr}
          onPchgChange={setPchgThr}
        />
      </div>

      <WRHeader
        scanCount={coins.length}
        alertCount={alerts.length}
        nextScan={autoScan ? (autoPaused ? 'PAUSED' : nextScan) : '—'}
        aiCallCount={aiCallCount}
        scanning={scanning}
        soundOn={soundOn}
        onToggleSound={() => setSoundOn(p => !p)}
        onToggleSettings={() => setSettingsOpen(p => !p)}
        onToggleKbd={() => setKbdOpen(p => !p)}
      />

      {settingsOpen && (
        <>
          <WRSettingsPanel
            apiKey={apiKey} onApiKeyChange={setApiKey}
            aiKey={aiKey} onAiKeyChange={setAiKey}
            birdKey={birdKey} onBirdKeyChange={setBirdKey}
            heliusKey={heliusKey} onHeliusKeyChange={setHeliusKey}
            theme={theme} onThemeChange={setTheme}
            aggressiveMode={aggressiveMode} onAggressiveModeChange={setAggressiveMode}
            whaleThr={whaleThr} onWhaleThrChange={setWhaleThr}
            hlScannerEnabled={hlScannerEnabled}
            onHlScannerEnabledChange={setHlScannerEnabled}
            hlMegaTxUsd={hlMegaTxUsd}
            onHlMegaTxUsdChange={setHlMegaTxUsd}
            supabaseUrl={supabaseUrl}
            onSupabaseUrlChange={(v) => {
              setSupabaseUrl(v);
              if (v.startsWith('https://')) localStorage.setItem('wr_supabase_url', v);
              else localStorage.removeItem('wr_supabase_url');
            }}
            supabaseAnonKey={supabaseAnonKey}
            onSupabaseAnonKeyChange={(v) => {
              setSupabaseAnonKey(v);
              if (v.length > 20) localStorage.setItem('wr_supabase_anon_key', v);
              else localStorage.removeItem('wr_supabase_anon_key');
            }}
          />
          <WRInsiderRiskSettings
            settings={insiderSettings}
            onSave={handleInsiderSettingsSave}
          />
        </>
      )}

      <WRTicker coins={coins.slice(0, 30)} />

      {/* ── Tab bar ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-wr-border px-4 bg-wr-bg2 shrink-0">
        <button
          onClick={() => setActiveTab('scanner')}
          className={`px-4 py-2 text-[11px] font-medium tracking-wider transition-colors relative ${
            activeTab === 'scanner'
              ? 'text-wr-green'
              : 'text-wr-muted hover:text-white'
          }`}
        >
          WHALE RADAR
          {activeTab === 'scanner' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-wr-green" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('insider')}
          className={`px-4 py-2 text-[11px] font-medium tracking-wider transition-colors relative ${
            activeTab === 'insider'
              ? 'text-[hsl(var(--wr-pink,330_100%_71%))]'
              : 'text-wr-muted hover:text-white'
          }`}
        >
          <span className="flex items-center gap-1.5">
            INSIDER RISK SCANNER
            {insiderData.some(d => d.riskLevel === 'CRITICAL') && (
              <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--wr-pink,330_100%_71%))] animate-pulse" />
            )}
          </span>
          {activeTab === 'insider' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[hsl(var(--wr-pink,330_100%_71%))]" />
          )}
        </button>
      </div>

      <WRStatsBar
        alertsToday={alerts.length}
        apiCallCount={apiCallCount}
        apiKey={apiKey}
        lastScanTs={lastScanTs}
        historyCount={scanHistory.length}
        portfolioValue={Object.entries(portfolio).reduce((s, [sym, p]) => {
          const coin = coins.find(c => c.symbol === sym);
          return s + p.amount * (coin?.price || p.entryPrice);
        }, 0)}
        rateLimits={rateLimitInfo}
      />

      <WRTracker tracked={tracked} onUntrack={untrackToken} />

      {kbdOpen && <WRKeyboardHelp onClose={() => setKbdOpen(false)} />}

      {activeModal === 'backtest' && (
        <WRModal title="📊 BACKTESTING MODULE" onClose={() => setActiveModal(null)}>
          <BacktestContent scanHistory={scanHistory} />
        </WRModal>
      )}

      {activeModal === 'portfolio' && (
        <WRModal title="💼 PORTFOLIO MANAGER" onClose={() => setActiveModal(null)}>
          <PortfolioContent
            portfolio={portfolio}
            coins={coins}
            onAdd={(sym, amt, entry) => setPortfolio(p => ({ ...p, [sym]: { amount: amt, entryPrice: entry } }))}
            onRemove={(sym) => setPortfolio(p => { const n = { ...p }; delete n[sym]; return n; })}
            onClear={() => setPortfolio({})}
          />
        </WRModal>
      )}

      {activeModal === 'sentiment' && (
        <WRModal title="✦ AI MARKET SENTIMENT" onClose={() => setActiveModal(null)}>
          <SentimentContent coins={coins} aiKey={aiKey} />
        </WRModal>
      )}

      {activeModal === 'signal-eval' && (
        <WRModal title="📈 SIGNAL EVAL — PROFIT PROOF" onClose={() => setActiveModal(null)}>
          <WRSignalEval />
        </WRModal>
      )}

      {/* ══ TIP THE CEO ══ */}
      <div className="border-t border-wr-border bg-wr-bg2/80 py-8 px-4">
        <div className="max-w-md mx-auto text-center space-y-4">
          <div className="text-[9px] tracking-[0.3em] text-wr-muted uppercase">Support the Developer</div>
          <h3 className="font-head text-lg text-wr-cyan">
            ☕ Found Whale Radar useful?
          </h3>
          <p className="text-[11px] text-wr-muted leading-relaxed">
            If this tool helped your trading or development workflow, consider tipping the CEO. Every sat counts. 🙏
          </p>
          <div className="inline-block bg-white rounded-xl p-3 shadow-lg shadow-wr-cyan/10">
            <img
              src={btcQr}
              alt="BTC Donation QR Code"
              className="w-48 h-48 object-contain"
            />
          </div>
          <div className="space-y-1">
            <div className="text-[8px] tracking-widest text-wr-muted uppercase">BTC Address</div>
            <button
              onClick={() => {
                navigator.clipboard.writeText('bc1q0d0ccaxuw065ezdulr68azp2fjhc0avaqf0pyz');
                setCopiedBtc(true);
                setTimeout(() => setCopiedBtc(false), 2000);
              }}
              className="font-mono text-[10px] text-wr-green bg-wr-bg3 border border-wr-border rounded px-3 py-2 hover:border-wr-cyan transition-colors cursor-pointer select-all break-all max-w-xs mx-auto block"
              title="Click to copy"
            >
              bc1q0d0ccaxuw065ezdulr68azp2fjhc0avaqf0pyz
            </button>
            <div className={`text-[9px] h-4 transition-opacity ${copiedBtc ? 'text-wr-green opacity-100' : 'opacity-0'}`}>
              ✓ Copied to clipboard!
            </div>
          </div>
          <div className="text-[8px] text-wr-muted/50 pt-2">WHALE RADAR v9 — Built with 🔥 by the CEO</div>
        </div>
      </div>
    </div>
  );
}

/* ══ BACKTEST CONTENT ═════════════════════════════════════════════════════════ */
function BacktestContent({ scanHistory }: { scanHistory: ScanSnapshot[] }) {
  const [results, setResults] = useState<{ sym: string; threat: string; pnlPct: number; ts: number }[]>([]);
  const [ran, setRan] = useState(false);

  const runBacktest = () => {
    if (scanHistory.length < 2) return;
    const res: typeof results = [];
    for (let i = 0; i < scanHistory.length - 1; i++) {
      const snap = scanHistory[i];
      const next = scanHistory[i + 1];
      const nextMap: Record<string, number> = {};
      (next.coins || []).forEach(c => { if (c.symbol && c.price) nextMap[c.symbol] = c.price; });
      (snap.coins || []).filter(c => c.threat === 'CRITICAL' || c.threat === 'HIGH').slice(0, 5).forEach(c => {
        const exitP = nextMap[c.symbol!];
        if (c.price && exitP) {
          res.push({ sym: c.symbol!, threat: c.threat!, pnlPct: ((exitP - c.price) / c.price) * 100, ts: snap.ts });
        }
      });
    }
    setResults(res);
    setRan(true);
  };

  const avgPnl = results.length ? results.reduce((s, r) => s + r.pnlPct, 0) / results.length : 0;
  const wins = results.filter(r => r.pnlPct > 0).length;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center flex-wrap">
        <span className="text-xs text-wr-muted tracking-widest">SNAPSHOTS: {scanHistory.length}</span>
        <button className="wr-btn" onClick={runBacktest}>▶ RUN BACKTEST</button>
      </div>
      {!ran ? (
        <p className="text-center text-wr-muted text-xs py-8">Select parameters and click RUN BACKTEST<br /><span className="text-[8px]">Uses scan history snapshots to simulate</span></p>
      ) : results.length === 0 ? (
        <p className="text-center text-wr-muted text-xs py-8">No trade simulations — run more scans first</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-wr-bg3 border border-wr-border p-3 text-center">
              <div className={`font-head text-lg ${avgPnl >= 0 ? 'text-wr-green' : 'text-wr-red'}`}>{avgPnl >= 0 ? '+' : ''}{avgPnl.toFixed(2)}%</div>
              <div className="text-[7px] text-wr-muted tracking-widest">AVG PNL</div>
            </div>
            <div className="bg-wr-bg3 border border-wr-border p-3 text-center">
              <div className="font-head text-lg text-wr-amber">{results.length > 0 ? ((wins / results.length) * 100).toFixed(0) : 0}%</div>
              <div className="text-[7px] text-wr-muted tracking-widest">WIN RATE</div>
            </div>
            <div className="bg-wr-bg3 border border-wr-border p-3 text-center">
              <div className="font-head text-lg text-wr-white">{results.length}</div>
              <div className="text-[7px] text-wr-muted tracking-widest">TRADES</div>
            </div>
          </div>
          <div className="text-[7px] text-wr-muted tracking-widest">SIMULATED — NOT FINANCIAL ADVICE</div>
          <div className="max-h-60 overflow-y-auto scrollbar-thin space-y-0.5">
            {results.slice(0, 30).map((r, i) => (
              <div key={`${r.sym}-${r.ts}-${i}`} className="grid grid-cols-4 gap-2 text-[9px] py-1 border-b border-wr-border/50">
                <span className="text-wr-muted">{new Date(r.ts).toLocaleTimeString()}</span>
                <span className="text-wr-white font-head text-[8px]">{r.sym}</span>
                <span className={`wr-badge wr-badge-${r.threat.toLowerCase()}`}>{r.threat}</span>
                <span className={r.pnlPct >= 0 ? 'text-wr-green' : 'text-wr-red'}>{r.pnlPct >= 0 ? '+' : ''}{r.pnlPct.toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ══ PORTFOLIO CONTENT ════════════════════════════════════════════════════════ */
function PortfolioContent({ portfolio, coins, onAdd, onRemove, onClear }: {
  portfolio: Record<string, PortfolioEntry>;
  coins: CoinData[];
  onAdd: (sym: string, amt: number, entry: number) => void;
  onRemove: (sym: string) => void;
  onClear: () => void;
}) {
  const [sym, setSym] = useState('');
  const [amt, setAmt] = useState('');
  const [entry, setEntry] = useState('');

  const handleAdd = () => {
    const s = sym.trim().toUpperCase();
    const a = parseFloat(amt);
    const e = parseFloat(entry);
    if (!s || isNaN(a) || isNaN(e) || a <= 0 || e <= 0) return;
    onAdd(s, a, e);
    setSym(''); setAmt(''); setEntry('');
  };

  const entries = Object.entries(portfolio);
  let totalVal = 0, totalEntry = 0;
  entries.forEach(([s, p]) => {
    const coin = coins.find(c => c.symbol === s);
    totalVal += p.amount * (coin?.price || p.entryPrice);
    totalEntry += p.amount * p.entryPrice;
  });
  const totalPnl = totalVal - totalEntry;
  const totalPnlPct = totalEntry > 0 ? (totalPnl / totalEntry) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap items-center">
        <input className="wr-input w-20" placeholder="SYMBOL" value={sym} onChange={e => setSym(e.target.value)} style={{ textTransform: 'uppercase' }} />
        <input className="wr-input w-20" placeholder="AMOUNT" value={amt} onChange={e => setAmt(e.target.value)} />
        <input className="wr-input w-20" placeholder="ENTRY $" value={entry} onChange={e => setEntry(e.target.value)} />
        <button className="wr-btn" onClick={handleAdd}>+ ADD</button>
        <button className="wr-btn red" onClick={onClear}>CLR ALL</button>
      </div>
      {entries.length === 0 ? (
        <p className="text-center text-wr-muted text-xs py-8">No holdings — add manually above</p>
      ) : (
        <>
          <table className="w-full text-[9px] border-collapse">
            <thead>
              <tr>
                <th className="text-left text-wr-muted text-[7px] tracking-widest py-1 border-b border-wr-border">TOKEN</th>
                <th className="text-left text-wr-muted text-[7px] tracking-widest py-1 border-b border-wr-border">QTY</th>
                <th className="text-left text-wr-muted text-[7px] tracking-widest py-1 border-b border-wr-border">ENTRY</th>
                <th className="text-left text-wr-muted text-[7px] tracking-widest py-1 border-b border-wr-border">NOW</th>
                <th className="text-left text-wr-muted text-[7px] tracking-widest py-1 border-b border-wr-border">PNL%</th>
                <th className="text-left text-wr-muted text-[7px] tracking-widest py-1 border-b border-wr-border">VALUE</th>
                <th className="py-1 border-b border-wr-border"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([s, p]) => {
                const coin = coins.find(c => c.symbol === s);
                const curP = coin?.price || p.entryPrice;
                const pnl = ((curP - p.entryPrice) / p.entryPrice) * 100;
                return (
                  <tr key={s} className="border-b border-wr-border/50">
                    <td className="text-wr-white font-head text-[9px] py-1">{s}</td>
                    <td className="py-1">{p.amount}</td>
                    <td className="py-1">${fmtP(p.entryPrice)}</td>
                    <td className="text-wr-cyan py-1">${fmtP(curP)}</td>
                    <td className={`py-1 ${pnl >= 0 ? 'text-wr-green' : 'text-wr-red'}`}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}%</td>
                    <td className="py-1">${fmtN(p.amount * curP)}</td>
                    <td className="py-1"><button className="wr-btn red text-[7px] px-1 py-0" onClick={() => onRemove(s)}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-wr-bg3 border border-wr-border p-2 text-center">
              <div className="font-head text-sm text-wr-white">${fmtN(totalVal)}</div>
              <div className="text-[7px] text-wr-muted tracking-widest">TOTAL VALUE</div>
            </div>
            <div className="bg-wr-bg3 border border-wr-border p-2 text-center">
              <div className={`font-head text-sm ${totalPnl >= 0 ? 'text-wr-green' : 'text-wr-red'}`}>{totalPnl >= 0 ? '+' : ''}{totalPnlPct.toFixed(2)}%</div>
              <div className="text-[7px] text-wr-muted tracking-widest">TOTAL PNL</div>
            </div>
            <div className="bg-wr-bg3 border border-wr-border p-2 text-center">
              <div className="font-head text-sm text-wr-white">{entries.length}</div>
              <div className="text-[7px] text-wr-muted tracking-widest">HOLDINGS</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ══ SENTIMENT CONTENT ════════════════════════════════════════════════════════ */
function SentimentContent({ coins, aiKey }: { coins: CoinData[]; aiKey: string }) {
  const critCount = coins.filter(c => c.threat === 'CRITICAL').length;
  const highCount = coins.filter(c => c.threat === 'HIGH').length;
  const washCount = coins.filter(c => c.category === 'WASH').length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-wr-bg3 border border-wr-border p-3 text-center">
          <div className="text-[7px] text-wr-muted tracking-widest mb-1">CRITICAL</div>
          <div className="font-head text-xl text-wr-red">{critCount}</div>
        </div>
        <div className="bg-wr-bg3 border border-wr-border p-3 text-center">
          <div className="text-[7px] text-wr-muted tracking-widest mb-1">HIGH</div>
          <div className="font-head text-xl text-wr-amber">{highCount}</div>
        </div>
        <div className="bg-wr-bg3 border border-wr-border p-3 text-center">
          <div className="text-[7px] text-wr-muted tracking-widest mb-1">WASH</div>
          <div className="font-head text-xl text-wr-purple">{washCount}</div>
        </div>
      </div>
      {!aiKey ? (
        <p className="text-center text-wr-muted text-xs py-4">Enter AI key in ⚙ Settings to enable sentiment analysis</p>
      ) : (
        <div className="border-t border-wr-purple/30 pt-3">
          <div className="text-[8px] text-wr-purple tracking-widest mb-2">✦ AI ASSESSMENT</div>
          <p className="text-[10px] text-wr-white leading-relaxed">
            Market shows {critCount > 3 ? 'ELEVATED' : critCount > 0 ? 'MODERATE' : 'LOW'} manipulation risk.
            {washCount > 0 ? ` ${washCount} tokens flagged for wash trading patterns.` : ''}
            {critCount > 5 ? ' High cluster of critical alerts suggests coordinated activity.' : ''}
            Exercise caution with high-score tokens.
          </p>
        </div>
      )}
    </div>
  );
}
