/* ══ WHALE RADAR — Scan Service ═══════════════════════════════════════════════
 *  Server-side proxy for CoinGecko. Eliminates CORS/rate-limit issues.
 *  Features: in-memory cache (10s), fetchWithTimeout (8s), retry (4×).
 *  NO mock / fallback data — errors surface to the client as failures.
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
  /** Present when the request includes include_platform=true — chain slug
   *  (e.g. "ethereum", "solana") -> contract address. Empty object for
   *  native L1 coins (BTC, ETH, SOL itself, etc.) that aren't a token on
   *  another chain. */
  platforms?: Record<string, string> | null;
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
  platforms?: Record<string, string> | null;
}

export interface ScanResult {
  success: boolean;
  data: ScanCoin[];
  source: 'live' | 'cached';
  ts: string;
  error?: string;
}

// ── In-memory cache ──────────────────────────────────────────────────────────
let cachedData: ScanCoin[] | null = null;
let cacheTs = 0;
const CACHE_TTL_MS = 10_000; // 10s

// ── Fetch with timeout (bug #12: chains external abort signal) ──────────────
async function fetchWithTimeout(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 8000,
  externalSignal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExtAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onExtAbort);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExtAbort);
  }
}

// ── Retry with exponential backoff + jitter (bug #8: 429 counts as attempt) ─
function jitter(ms: number): number {
  return ms * (0.8 + Math.random() * 0.4);
}

async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  maxRetries = 4,
  externalSignal?: AbortSignal
): Promise<CoinGeckoRaw[]> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (externalSignal?.aborted) throw new Error('Aborted');
    try {
      const res = await fetchWithTimeout(url, headers, 8000, externalSignal);
      if (res.status === 429) {
        // Rate limited — wait before the next attempt (the wait counts as the attempt)
        const delay = jitter(2000 * Math.pow(2, attempt));
        console.warn(`[scan] 429 on attempt ${attempt + 1}, waiting ${Math.round(delay)}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as CoinGeckoRaw[];
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
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
function transformOne(c: CoinGeckoRaw, i: number): ScanCoin | null {
  const vol = c.total_volume || 0;
  const rawMcap = c.market_cap ?? 0;
  if (rawMcap < 10_000) return null;
  const mcap = rawMcap;
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
    platforms: c.platforms ?? null,
  };
}

function transform(raw: CoinGeckoRaw[]): ScanCoin[] {
  return raw.flatMap((c, i) => {
    const t = transformOne(c, i);
    return t ? [t] : [];
  });
}

// ── Main scan function ───────────────────────────────────────────────────────
export async function performScan(apiKey?: string): Promise<ScanResult> {
  const now = Date.now();

  if (cachedData && now - cacheTs < CACHE_TTL_MS) {
    return { success: true, data: cachedData, source: 'cached', ts: new Date().toISOString() };
  }

  const isCgDemoKey = apiKey && apiKey.startsWith('CG-');
  const isCgProKey  = apiKey && !apiKey.startsWith('CG-');

  const cgBase = isCgProKey
    ? 'https://pro-api.coingecko.com/api/v3'
    : 'https://api.coingecko.com/api/v3';

  // include_platform=true adds each coin's chain->contract-address map at no
  // extra request cost — see the `platforms` field note on CoinGeckoRaw above.
  const url = `${cgBase}/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h&include_platform=true`;

  const headers: Record<string, string> = {};
  if (isCgProKey)  headers['x-cg-pro-api-key']  = apiKey!;
  if (isCgDemoKey) headers['x-cg-demo-api-key'] = apiKey!;

  try {
    const raw = await fetchWithRetry(url, headers, 4);
    const data = transform(raw);
    cachedData = data;
    cacheTs = Date.now();
    return { success: true, data, source: 'live', ts: new Date().toISOString() };
  } catch (err) {
    const errMsg = (err as Error).message;
    console.error('[scan] All retries failed:', errMsg);

    // Serve stale cache if available — never serve invented data
    if (cachedData) {
      return {
        success: true,
        data: cachedData,
        source: 'cached',
        ts: new Date().toISOString(),
        error: `API failed (${errMsg}), serving stale cache`,
      };
    }

    // No cache at all — surface real error so UI can show a proper message
    return {
      success: false,
      data: [],
      source: 'cached',
      ts: new Date().toISOString(),
      error: `CoinGecko unavailable: ${errMsg}`,
    };
  }
}
