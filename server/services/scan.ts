/* ══ WHALE RADAR — Scan Service ═══════════════════════════════════════════════
 *  Server-side proxy for CoinGecko. Eliminates CORS/rate-limit issues.
 *  Features: in-memory cache (10s), fetchWithTimeout (8s), retry (4x), fallback mock.
 * ═══════════════════════════════════════════════════════════════════════════ */

interface CoinGeckoRaw {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_24h: number | null;
  total_volume: number;
  market_cap: number;
  circulating_supply: number | null;
  total_supply: number | null;
  market_cap_rank: number | null;
}

export interface ScanCoin {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change_24h: number;
  volume: number;
  mcap: number;
  vmcap: number;
  rank: number;
  circulating_supply: number | null;
  total_supply: number | null;
}

export interface ScanResult {
  success: boolean;
  data: ScanCoin[];
  source: 'live' | 'cached' | 'fallback';
  ts: string;
  error?: string;
}

// ── In-memory cache ──────────────────────────────────────────────────────────
let cachedData: ScanCoin[] | null = null;
let cacheTs = 0;
const CACHE_TTL_MS = 10_000; // 10s

// ── Fetch with timeout ───────────────────────────────────────────────────────
async function fetchWithTimeout(url: string, headers: Record<string, string>, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Retry with exponential backoff + jitter ──────────────────────────────────
function jitter(ms: number): number {
  return ms * (0.8 + Math.random() * 0.4);
}

async function fetchWithRetry(url: string, headers: Record<string, string>, maxRetries = 4): Promise<CoinGeckoRaw[]> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, headers);
      if (res.status === 429) {
        // Rate limited — wait longer
        const delay = jitter(2000 * Math.pow(2, attempt));
        console.warn(`[scan] 429 rate limited, retry in ${Math.round(delay)}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as CoinGeckoRaw[];
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxRetries - 1) {
        const delay = jitter(1000 * Math.pow(2, attempt));
        console.warn(`[scan] attempt ${attempt + 1} failed: ${lastError.message}, retry in ${Math.round(delay)}ms`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError ?? new Error('All retries exhausted');
}

// ── Transform CoinGecko → ScanCoin ──────────────────────────────────────────
function transform(raw: CoinGeckoRaw[]): ScanCoin[] {
  return raw.map((c, i) => {
    const vol = c.total_volume || 0;
    const mcap = c.market_cap || 1;
    return {
      id: c.id,
      symbol: (c.symbol || '').toUpperCase(),
      name: c.name,
      price: c.current_price,
      change_24h: c.price_change_percentage_24h ?? 0,
      volume: vol,
      mcap,
      vmcap: (vol / mcap) * 100,
      rank: c.market_cap_rank ?? (i + 1),
      circulating_supply: c.circulating_supply,
      total_supply: c.total_supply,
    };
  });
}

// ── Fallback mock data ───────────────────────────────────────────────────────
function generateFallbackData(): ScanCoin[] {
  const tokens = [
    { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', price: 67500, vol: 28e9, mcap: 1.33e12 },
    { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', price: 3450, vol: 14e9, mcap: 415e9 },
    { id: 'solana', symbol: 'SOL', name: 'Solana', price: 148, vol: 2.8e9, mcap: 65e9 },
    { id: 'binancecoin', symbol: 'BNB', name: 'BNB', price: 595, vol: 1.2e9, mcap: 91e9 },
    { id: 'ripple', symbol: 'XRP', name: 'XRP', price: 0.52, vol: 1.1e9, mcap: 28e9 },
    { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin', price: 0.125, vol: 680e6, mcap: 18e9 },
    { id: 'cardano', symbol: 'ADA', name: 'Cardano', price: 0.45, vol: 320e6, mcap: 16e9 },
    { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche', price: 35, vol: 450e6, mcap: 13e9 },
    { id: 'chainlink', symbol: 'LINK', name: 'Chainlink', price: 14.5, vol: 380e6, mcap: 8.5e9 },
    { id: 'polkadot', symbol: 'DOT', name: 'Polkadot', price: 6.8, vol: 210e6, mcap: 9.2e9 },
    { id: 'shiba-inu', symbol: 'SHIB', name: 'Shiba Inu', price: 0.0000175, vol: 350e6, mcap: 10.3e9 },
    { id: 'polygon', symbol: 'MATIC', name: 'Polygon', price: 0.72, vol: 280e6, mcap: 7.1e9 },
    { id: 'uniswap', symbol: 'UNI', name: 'Uniswap', price: 7.5, vol: 120e6, mcap: 5.7e9 },
    { id: 'litecoin', symbol: 'LTC', name: 'Litecoin', price: 72, vol: 310e6, mcap: 5.4e9 },
    { id: 'bonk', symbol: 'BONK', name: 'Bonk', price: 0.0000225, vol: 410e6, mcap: 1.5e9 },
    { id: 'pepe', symbol: 'PEPE', name: 'Pepe', price: 0.0000105, vol: 890e6, mcap: 4.4e9 },
    { id: 'render-token', symbol: 'RNDR', name: 'Render', price: 8.2, vol: 190e6, mcap: 3.2e9 },
    { id: 'jupiter', symbol: 'JUP', name: 'Jupiter', price: 1.05, vol: 150e6, mcap: 1.4e9 },
    { id: 'wif', symbol: 'WIF', name: 'dogwifhat', price: 2.8, vol: 520e6, mcap: 2.8e9 },
    { id: 'floki', symbol: 'FLOKI', name: 'FLOKI', price: 0.000175, vol: 280e6, mcap: 1.7e9 },
  ];
  // Add slight randomness to simulate market movement
  return tokens.map((t, i) => {
    const drift = 1 + (Math.random() - 0.5) * 0.04; // ±2%
    const vol = t.vol * drift;
    const mcap = t.mcap * drift;
    return {
      id: t.id,
      symbol: t.symbol,
      name: t.name,
      price: t.price * drift,
      change_24h: (Math.random() - 0.45) * 15, // -6.75% to +8.25%
      volume: vol,
      mcap,
      vmcap: (vol / mcap) * 100,
      rank: i + 1,
      circulating_supply: null,
      total_supply: null,
    };
  });
}

// ── Main scan function ───────────────────────────────────────────────────────
export async function performScan(apiKey?: string): Promise<ScanResult> {
  const now = Date.now();

  // Return cache if fresh
  if (cachedData && now - cacheTs < CACHE_TTL_MS) {
    return {
      success: true,
      data: cachedData,
      source: 'cached',
      ts: new Date().toISOString(),
    };
  }

  // Detect key type: demo keys start with "CG-", pro keys are UUIDs/other
  const isCgDemoKey = apiKey && apiKey.startsWith('CG-');
  const isCgProKey  = apiKey && !apiKey.startsWith('CG-');

  const cgBase = isCgProKey
    ? 'https://pro-api.coingecko.com/api/v3'
    : 'https://api.coingecko.com/api/v3';

  const url = `${cgBase}/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h&include_platform=false`;

  const headers: Record<string, string> = {};
  if (isCgProKey)  headers['x-cg-pro-api-key']  = apiKey!;
  if (isCgDemoKey) headers['x-cg-demo-api-key'] = apiKey!;

  try {
    const raw = await fetchWithRetry(url, headers, 2);
    const data = transform(raw);
    cachedData = data;
    cacheTs = Date.now();
    return {
      success: true,
      data,
      source: 'live',
      ts: new Date().toISOString(),
    };
  } catch (err) {
    const errMsg = (err as Error).message;
    console.error('[scan] All retries failed:', errMsg);

    // Return cached data if available (even if stale)
    if (cachedData) {
      return {
        success: true,
        data: cachedData,
        source: 'cached',
        ts: new Date().toISOString(),
        error: `API failed (${errMsg}), serving stale cache`,
      };
    }

    // Last resort: fallback mock data
    const fallback = generateFallbackData();
    return {
      success: true,
      data: fallback,
      source: 'fallback',
      ts: new Date().toISOString(),
      error: `API failed (${errMsg}), serving simulated data`,
    };
  }
}
