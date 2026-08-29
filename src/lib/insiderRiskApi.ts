// src/lib/insiderRiskApi.ts
/**
 * Real API service for Insider Risk Scanner
 * Handles Etherscan and Birdeye API calls with rate limiting and caching
 */

import { 
  InsiderRiskData, 
  TokenHolder, 
  TransferEvent, 
  DEFAULT_CEX_ADDRESSES,
} from '@/types/insiderRisk';
import { SOLANA_CEX_ADDRESSES } from './insiderRisk';
import { detectCEX, detectWalletType, detectPrePumpPattern } from './insiderRiskUtils';
import type { CoinData } from './whaleRadarState';

/** What analyzeTokenRisk actually reads off a "coin" beyond CoinData's real
 *  fields. FIXED: this was dead for every real coin — CoinData.platforms was
 *  never populated (useMarketData.ts's CoinGecko request used
 *  include_platform=false), so isSolana was always false and contractAddress
 *  always undefined, meaning the Etherscan/Birdeye "real data" path always
 *  threw and every scan silently fell back to generateMockInsiderData()
 *  regardless of the useRealData toggle or configured API keys. Fixed at the
 *  source rather than here: the existing bulk CoinGecko request now passes
 *  include_platform=true (server proxy in scan.ts and the direct-CG fallback
 *  in services/api.ts), which adds a chain->contract-address `platforms` map
 *  to every coin at zero extra request cost, and useMarketData.ts's
 *  processData() carries it through onto CoinData.platforms. `coin.id` is
 *  still just a CoinGecko slug, never a contract address — that part of this
 *  note remains true; `coin.chain`/`coin.contract_address` below stay as a
 *  fallback for any caller that sets them directly, but the real, populated
 *  field for every scanned coin is now `coin.platforms`. Native L1 coins
 *  (BTC, ETH itself, SOL itself, etc.) correctly have an empty platforms
 *  object — there's no contract to inspect — and correctly throw here, which
 *  the caller (WRInsiderRiskScanner.tsx) now surfaces as an honest
 *  riskLevel: 'UNKNOWN' / scanStatus: 'error' row instead of the mock-data
 *  substitution it used to do (removed — see that file's own comment),
 *  which is the right behavior, not a remaining gap. */
type InsiderRiskCoin = CoinData & {
  chain?: string;
  contract_address?: string;
};

// ── Fetch with timeout (no AbortSignal.timeout — broad browser compat) ────────
function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Rate limiting queues
class RateLimiter {
  private queue: (() => Promise<unknown>)[] = [];
  private running = false;
  private lastCall = 0;
  private minDelay: number;

  constructor(callsPerSecond: number) {
    this.minDelay = 1000 / callsPerSecond;
  }

  async add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const now = Date.now();
          const wait = Math.max(0, this.lastCall + this.minDelay - now);
          if (wait > 0) await new Promise(r => setTimeout(r, wait));

          this.lastCall = Date.now();
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      if (!this.running) this.process();
    });
  }

  private async process() {
    this.running = true;
    while (this.queue.length > 0) {
      const fn = this.queue.shift();
      if (fn) await fn();
    }
    this.running = false;
  }
}

// Rate limiters for each API
const etherscanLimiter = new RateLimiter(5); // 5 calls/sec for free tier
const birdeyeLimiter = new RateLimiter(1.6); // 100 calls/minute

// Cache implementation
const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_DURATION) {
    return entry.data as T;
  }
  cache.delete(key);
  return null;
}

function setCached<T>(key: string, data: T) {
  cache.set(key, { data, timestamp: Date.now() });
}

interface EtherscanTx {
  from: string;
  to: string;
  value: string;
  timeStamp: string;
  hash: string;
}

// Etherscan API Service
export class EtherscanService {
  private apiKey: string;
  private baseUrl = 'https://api.etherscan.io/api';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getTokenInfo(contractAddress: string): Promise<{
    totalSupply: string;
    decimals: string;
    name: string;
    symbol: string;
  }> {
    const cacheKey = `etherscan:info:${contractAddress}`;
    const cached = getCached<{ totalSupply: string; decimals: string; name: string; symbol: string }>(cacheKey);
    if (cached) return cached;

    return etherscanLimiter.add(async () => {
      const url = `${this.baseUrl}?module=stats&action=tokensupply&contractaddress=${contractAddress}&apikey=${this.apiKey}`;
      const response = await fetchWithTimeout(url);
      const data = await response.json();

      if (data.status !== '1') throw new Error(data.message);

      setCached(cacheKey, data.result);
      return data.result;
    });
  }

  async getTokenHolders(contractAddress: string): Promise<TokenHolder[]> {
    const cacheKey = `etherscan:holders:${contractAddress}`;
    const cached = getCached<TokenHolder[]>(cacheKey);
    if (cached) return cached;

    return etherscanLimiter.add(async () => {
      // Note: Etherscan Pro API required for holder list
      // Fallback to alternative approach using events
      const transfers = await this.getRecentTransfers(contractAddress);
      const holderMap = new Map<string, number>();

      // Process transfers to estimate current holdings
      // This is an approximation - real holder data requires proprietary APIs
      transfers.forEach(tx => {
        const from = tx.from.toLowerCase();
        const to = tx.to.toLowerCase();
        const value = parseFloat(tx.value);

        holderMap.set(from, (holderMap.get(from) || 0) - value);
        holderMap.set(to, (holderMap.get(to) || 0) + value);
      });

      // Get top holders by balance
      const sorted = Array.from(holderMap.entries())
        .filter(([_, balance]) => balance > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      const totalSupply = sorted.reduce((sum, [_, bal]) => sum + bal, 0);

      const holders: TokenHolder[] = await Promise.all(
        sorted.map(async ([address, balance], index) => {
          const code = await this.getCode(address);
          return {
            address,
            balance,
            percentage: (balance / totalSupply) * 100,
            isContract: code !== '0x',
            tags: index === 0 ? ['Deployer'] : []
          };
        })
      );

      setCached(cacheKey, holders);
      return holders;
    });
  }

  async getRecentTransfers(contractAddress: string): Promise<EtherscanTx[]> {
    const cacheKey = `etherscan:transfers:${contractAddress}`;
    const cached = getCached<EtherscanTx[]>(cacheKey);
    if (cached) return cached;

    return etherscanLimiter.add(async () => {
      const url = `${this.baseUrl}?module=account&action=tokentx&contractaddress=${contractAddress}&page=1&offset=100&sort=desc&apikey=${this.apiKey}`;
      const response = await fetchWithTimeout(url);
      const data = await response.json();

      if (data.status !== '1') throw new Error(data.message);

      setCached(cacheKey, data.result);
      return data.result;
    });
  }

  async getCode(address: string): Promise<string> {
    const cacheKey = `etherscan:code:${address}`;
    const cached = getCached<string>(cacheKey);
    if (cached) return cached;

    return etherscanLimiter.add(async () => {
      const url = `${this.baseUrl}?module=proxy&action=eth_getCode&address=${address}&tag=latest&apikey=${this.apiKey}`;
      const response = await fetchWithTimeout(url);
      const data = await response.json();

      setCached(cacheKey, data.result);
      return data.result;
    });
  }

  async analyzeToken(contractAddress: string): Promise<Partial<InsiderRiskData>> {
    try {
      const [holders, transfers] = await Promise.all([
        this.getTokenHolders(contractAddress),
        this.getRecentTransfers(contractAddress)
      ]);

      const top10Concentration = holders.reduce((sum, h) => sum + h.percentage, 0);
      const deployerAddress = holders[0]?.address || '';

      // Analyze transfers for CEX patterns
      const largeTransfers: TransferEvent[] = transfers
        .filter((tx) => parseFloat(tx.value) > 500000)
        .map((tx) => {
          const cexInfo = detectCEX(tx.to, DEFAULT_CEX_ADDRESSES);
          return {
            from: tx.from,
            to: tx.to,
            value: parseFloat(tx.value),
            timestamp: parseInt(tx.timeStamp),
            txHash: tx.hash,
            isToCEX: cexInfo.isCEX,
            cexName: cexInfo.name
          };
        });

      const cexTransfers24h = largeTransfers.filter(t => 
        (Date.now() / 1000 - t.timestamp) < 86400
      ).length;

      // Detect pre-pump patterns
      const prePumpTransfer = detectPrePumpPattern(largeTransfers);

      // Detect wallet type
      const deployerCode = await this.getCode(deployerAddress);
      const walletType = detectWalletType(deployerCode);

      return {
        holders,
        top10Concentration,
        deployerAddress,
        deployerBalance: holders[0]?.balance || 0,
        deployerWalletType: walletType,
        largeTransfers,
        cexTransfers24h,
        cexTransfers72h: largeTransfers.filter(t => 
          (Date.now() / 1000 - t.timestamp) < 259200
        ).length,
        prePumpTransfer
      };
    } catch (error) {
      console.error('Etherscan analysis error:', error);
      throw error;
    }
  }

}
// detectPrePumpPattern (formerly a private method here) now lives in
// insiderRiskUtils.ts, shared with BirdeyeService.analyzeToken below —
// same >$1M-to-CEX-within-24h rule on both chains, one implementation.

interface BirdeyeTokenOverview {
  totalSupply?: number;
  circulatingSupply?: number;
  [key: string]: unknown;
}

interface BirdeyeHolderRow {
  owner: string;
  uiAmount?: number;
  ownerProgram?: boolean;
}

/** Field names below cover the variants seen across Birdeye's transfer
 *  endpoints (to/to_wallet/toAddress, value/valueUsd, block_unix_time/
 *  blockTime) since the exact shape isn't pinned down without a live key to
 *  test against — kept as a wide optional-field interface rather than a
 *  single pinned shape, matching the existing per-row fallback logic below
 *  instead of fabricating one canonical shape. */
interface BirdeyeTransferRow {
  to?: string; to_wallet?: string; toAddress?: string; destination?: string;
  from?: string; from_wallet?: string; fromAddress?: string; source?: string;
  value?: number; value_usd?: number; valueUsd?: number;
  block_unix_time?: number; blockTime?: number; time?: number; timestamp?: number;
  tx_hash?: string; txHash?: string; signature?: string;
}

// Birdeye API Service
export class BirdeyeService {
  private apiKey: string;
  private baseUrl = 'https://public-api.birdeye.so';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getTokenOverview(mintAddress: string): Promise<BirdeyeTokenOverview> {
    const cacheKey = `birdeye:overview:${mintAddress}`;
    const cached = getCached<BirdeyeTokenOverview>(cacheKey);
    if (cached) return cached;

    return birdeyeLimiter.add(async () => {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/defi/token_overview?address=${mintAddress}`,
        {
          headers: {
            'X-API-KEY': this.apiKey,
            'x-chain': 'solana'
          }
        }
      );

      if (!response.ok) throw new Error('Birdeye API error');

      const data = await response.json() as { data: BirdeyeTokenOverview };
      setCached(cacheKey, data.data);
      return data.data;
    });
  }

  async getTokenHolders(mintAddress: string): Promise<TokenHolder[]> {
    const cacheKey = `birdeye:holders:${mintAddress}`;
    const cached = getCached<TokenHolder[]>(cacheKey);
    if (cached) return cached;

    return birdeyeLimiter.add(async () => {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/defi/token_holder?address=${mintAddress}&offset=0&limit=10`,
        {
          headers: {
            'X-API-KEY': this.apiKey,
            'x-chain': 'solana'
          }
        }
      );

      if (!response.ok) throw new Error('Birdeye API error');

      const data = await response.json() as { data?: { items?: BirdeyeHolderRow[] } };
      const holders = data.data?.items || [];

      const totalSupply = holders.reduce((sum, h) => sum + (h.uiAmount || 0), 0);

      const formatted: TokenHolder[] = holders.map((h, index) => ({
        address: h.owner,
        balance: h.uiAmount || 0,
        percentage: totalSupply > 0 ? ((h.uiAmount || 0) / totalSupply) * 100 : 0,
        isContract: h.ownerProgram || false,
        tags: index === 0 ? ['Deployer'] : []
      }));

      setCached(cacheKey, formatted);
      return formatted;
    });
  }

  /** Raw on-chain transfer records for one Solana mint, POST /token/v1/transfer
   *  (not a DEX-swap endpoint — a swap's counterparty is an AMM pool, not a
   *  CEX wallet, so it can never show a "sent to Binance" pattern; this is
   *  the wallet-to-wallet transfer feed, the Solana analog of Etherscan's
   *  getRecentTransfers). from_value filters server-side to transfers worth
   *  at least $500k, matching the Ethereum path's threshold. */
  async getTokenTransfers(mintAddress: string, minUsdValue = 500_000): Promise<BirdeyeTransferRow[]> {
    const cacheKey = `birdeye:transfers:${mintAddress}:${minUsdValue}`;
    const cached = getCached<BirdeyeTransferRow[]>(cacheKey);
    if (cached) return cached;

    return birdeyeLimiter.add(async () => {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/token/v1/transfer`,
        {
          method: 'POST',
          headers: {
            'X-API-KEY': this.apiKey,
            'x-chain': 'solana',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            token_address: mintAddress,
            from_value: minUsdValue,
            limit: 50,
          }),
        }
      );

      if (!response.ok) throw new Error('Birdeye API error');

      const data = await response.json() as { data?: { items?: BirdeyeTransferRow[]; transfers?: BirdeyeTransferRow[] } };
      const items = data.data?.items || data.data?.transfers || [];
      setCached(cacheKey, items);
      return items;
    });
  }

  async analyzeToken(mintAddress: string, cexAddresses: Record<string, string[]> = {}): Promise<Partial<InsiderRiskData>> {
    try {
      const [overview, holders, rawTransfers] = await Promise.all([
        this.getTokenOverview(mintAddress),
        this.getTokenHolders(mintAddress),
        // A transfer-history fetch failure (endpoint down, plan doesn't
        // include it, etc.) shouldn't fail the whole scan — holders/overview
        // are still useful on their own — so this one degrades to [].
        this.getTokenTransfers(mintAddress, 500_000).catch((err) => {
          console.warn('Birdeye transfer history unavailable, CEX detection skipped:', err);
          return [];
        }),
      ]);

      const top10Concentration = holders.reduce((sum, h) => sum + h.percentage, 0);
      const circulatingPct = overview.circulatingSupply && overview.totalSupply 
        ? (overview.circulatingSupply / overview.totalSupply) * 100 
        : 0;

      // Field names below cover the variants seen across Birdeye's transfer
      // endpoints (to/to_wallet/toAddress, value/valueUsd, block_unix_time/
      // blockTime) since the exact shape isn't pinned down without a live
      // key to test against — this degrades to "no CEX match" per-row
      // rather than throwing if a given row doesn't have the field.
      const largeTransfers: TransferEvent[] = rawTransfers.map((tx) => {
        const to = tx.to_wallet ?? tx.to ?? tx.toAddress ?? tx.destination ?? '';
        const from = tx.from_wallet ?? tx.from ?? tx.fromAddress ?? tx.source ?? '';
        const value = Number(tx.value_usd ?? tx.valueUsd ?? tx.value ?? 0);
        const timestamp = Number(tx.block_unix_time ?? tx.blockTime ?? tx.time ?? tx.timestamp ?? 0);
        const cexInfo = detectCEX(to, cexAddresses);
        return {
          from,
          to,
          value,
          timestamp,
          txHash: tx.tx_hash ?? tx.txHash ?? tx.signature ?? '',
          isToCEX: cexInfo.isCEX,
          cexName: cexInfo.name,
        };
      });

      const cexTransfers24h = largeTransfers.filter(t =>
        (Date.now() / 1000 - t.timestamp) < 86400
      ).length;
      const cexTransfers72h = largeTransfers.filter(t =>
        (Date.now() / 1000 - t.timestamp) < 259200
      ).length;
      const prePumpTransfer = detectPrePumpPattern(largeTransfers);

      return {
        totalSupply: overview.totalSupply || 0,
        circulatingSupply: overview.circulatingSupply || 0,
        circulatingPercentage: circulatingPct,
        holders,
        top10Concentration,
        deployerAddress: holders[0]?.address || '',
        deployerBalance: holders[0]?.balance || 0,
        deployerWalletType: holders[0]?.isContract ? 'MULTISIG' : 'EOA',
        largeTransfers,
        cexTransfers24h,
        cexTransfers72h,
        prePumpTransfer,
      };
    } catch (error) {
      console.error('Birdeye analysis error:', error);
      throw error;
    }
  }
}

// ── Keyless public providers (real data, no simulated rows) ─────────────────
// Solana  → RugCheck report (mint/freeze authority, LP lock, risk score)
// Ethereum → Ethplorer freekey holders + token supply
// Both    → DexScreener token pairs for live liquidity signal
// Paid keys (Birdeye / Etherscan) still preferred when present — deeper
// transfer/CEX analysis — but absence of keys no longer means mock data.

interface EthplorerHolder {
  address: string;
  balance: number;
  share: number;
}

interface EthplorerHoldersResponse {
  holders?: EthplorerHolder[];
}

interface EthplorerTokenInfo {
  totalSupply?: string | number;
  decimals?: string | number;
  holdersCount?: number;
  price?: { rate?: number } | null;
}

interface DexTokenPair {
  chainId?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  baseToken?: { address?: string };
  quoteToken?: { address?: string };
}

interface DexTokenResponse {
  pairs?: DexTokenPair[] | null;
}

interface RugCheckPublicReport {
  score?: number | null;
  score_normalised?: number | null;
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  token?: {
    mintAuthority?: string | null;
    freezeAuthority?: string | null;
    supply?: number | null;
  } | null;
  totalMarketLiquidity?: number | null;
  totalLPProviders?: number | null;
  topHolders?: Array<{
    owner?: string;
    address?: string;
    pct?: number;
    percentage?: number;
    amount?: number;
    uiAmount?: number;
    insider?: boolean;
  }> | null;
  risks?: Array<{ name?: string; level?: string; score?: number }> | null;
  rugged?: boolean;
}

// Separate limiters + TTLs per provider (holders change slower than liquidity).
const ethplorerLimiter = new RateLimiter(2);
const rugcheckLimiter = new RateLimiter(2);
const dexLimiter = new RateLimiter(3);
const TTL_HOLDERS_MS = 5 * 60 * 1000;
const TTL_RISK_MS = 10 * 60 * 1000;
const TTL_LIQ_MS = 60 * 1000;

const RISK_MODEL_VERSION = 'WR-10.1';

/** Unified internal 0–100 model — same weights on every chain so scores are comparable. */
function computeInternalRiskScore(input: {
  top10Concentration: number;
  mintAuthority?: boolean;
  freezeAuthority?: boolean;
  rugged?: boolean;
  liquidityUsd: number | null;
  pairCount: number | null;
}): number {
  let score = 0;
  const top10 = input.top10Concentration;
  if (top10 > 90) score += 40;
  else if (top10 > 80) score += 25;
  else if (top10 > 60) score += 12;

  if (input.mintAuthority) score += 20;
  if (input.freezeAuthority) score += 15;
  if (input.rugged) score += 40;

  if (input.pairCount === 0) score += 10;
  else if (input.liquidityUsd != null && input.liquidityUsd > 0 && input.liquidityUsd < 25_000) {
    score += 15;
  }

  return Math.max(0, Math.min(100, score));
}

function levelFromScore(score: number): InsiderRiskData['riskLevel'] {
  if (score >= 75) return 'CRITICAL';
  if (score >= 50) return 'HIGH';
  if (score >= 25) return 'MEDIUM';
  return 'LOW';
}

function getCachedWithTtl<T>(key: string, ttlMs: number): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < ttlMs) return entry.data as T;
  if (entry) cache.delete(key);
  return null;
}

async function fetchEthplorerHolders(contractAddress: string): Promise<{
  holders: TokenHolder[];
  top10Concentration: number;
  totalSupply: number;
}> {
  const cacheKey = `ethplorer:holders:v2:${contractAddress.toLowerCase()}`;
  const cached = getCachedWithTtl<{ holders: TokenHolder[]; top10Concentration: number; totalSupply: number }>(
    cacheKey,
    TTL_HOLDERS_MS,
  );
  if (cached) return cached;

  return ethplorerLimiter.add(async () => {
    const [holdersRes, infoRes] = await Promise.all([
      fetchWithTimeout(
        `https://api.ethplorer.io/getTopTokenHolders/${contractAddress}?apiKey=freekey&limit=10`,
      ),
      fetchWithTimeout(
        `https://api.ethplorer.io/getTokenInfo/${contractAddress}?apiKey=freekey`,
      ),
    ]);

    if (!holdersRes.ok) throw new Error(`Ethplorer holders HTTP ${holdersRes.status}`);
    if (!infoRes.ok) throw new Error(`Ethplorer info HTTP ${infoRes.status}`);

    const holdersJson = (await holdersRes.json()) as EthplorerHoldersResponse;
    const infoJson = (await infoRes.json()) as EthplorerTokenInfo;

    const decimals = Number(infoJson.decimals ?? 18) || 18;
    const rawSupply = Number(infoJson.totalSupply ?? 0);
    const totalSupply = rawSupply > 0 ? rawSupply / Math.pow(10, decimals) : 0;

    const holders: TokenHolder[] = (holdersJson.holders ?? []).map((h, index) => {
      const balance = Number(h.balance ?? 0) / Math.pow(10, decimals);
      const percentage = typeof h.share === 'number' ? h.share : (totalSupply > 0 ? (balance / totalSupply) * 100 : 0);
      return {
        address: h.address,
        balance,
        percentage,
        isContract: false,
        tags: index === 0 ? ['Top holder'] : undefined,
      };
    });

    const top10Concentration = holders.reduce((sum, h) => sum + h.percentage, 0);
    const result = { holders, top10Concentration, totalSupply };
    setCached(cacheKey, result);
    return result;
  });
}

async function fetchRugCheckPublic(mint: string): Promise<{
  holders: TokenHolder[];
  top10Concentration: number;
  totalSupply: number;
  externalRiskScore: number | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  rugged: boolean;
  risks: string[];
}> {
  const cacheKey = `rugcheck:public:v2:${mint}`;
  const cached = getCachedWithTtl<{
    holders: TokenHolder[];
    top10Concentration: number;
    totalSupply: number;
    externalRiskScore: number | null;
    mintAuthority: string | null;
    freezeAuthority: string | null;
    rugged: boolean;
    risks: string[];
  }>(cacheKey, TTL_RISK_MS);
  if (cached) return cached;

  return rugcheckLimiter.add(async () => {
    const response = await fetchWithTimeout(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`);
    if (!response.ok) throw new Error(`RugCheck HTTP ${response.status}`);
    const rep = (await response.json()) as RugCheckPublicReport;

    const holders: TokenHolder[] = (rep.topHolders ?? []).slice(0, 10).map((h, index) => {
      const percentage = Number(h.pct ?? h.percentage ?? 0);
      const balance = Number(h.uiAmount ?? h.amount ?? 0);
      return {
        address: h.owner || h.address || '',
        balance,
        percentage,
        isContract: false,
        tags: [
          ...(index === 0 ? ['Top holder'] : []),
          ...(h.insider ? ['Insider'] : []),
        ],
      };
    });

    const top10Concentration = holders.reduce((sum, h) => sum + h.percentage, 0);

    // ONLY score_normalised is a reliable 0–100 scale. Raw `score` uses a
    // different unbounded scale — never divide by 100 as a conversion.
    let externalRiskScore: number | null = null;
    if (typeof rep.score_normalised === 'number' && !isNaN(rep.score_normalised)) {
      externalRiskScore = Math.max(0, Math.min(100, Math.round(rep.score_normalised)));
    }

    const result = {
      holders,
      top10Concentration,
      totalSupply: Number(rep.token?.supply ?? 0) || 0,
      externalRiskScore,
      mintAuthority: rep.mintAuthority ?? rep.token?.mintAuthority ?? null,
      freezeAuthority: rep.freezeAuthority ?? rep.token?.freezeAuthority ?? null,
      rugged: Boolean(rep.rugged),
      risks: (rep.risks ?? []).map(r => r.name).filter((n): n is string => !!n).slice(0, 6),
    };
    setCached(cacheKey, result);
    return result;
  });
}

async function fetchDexLiquidity(
  contractAddress: string,
  preferredChain?: 'solana' | 'ethereum',
): Promise<{
  liquidityUsd: number;
  volume24h: number;
  pairCount: number;
}> {
  const cacheKey = `dex:token:v2:${preferredChain || 'any'}:${contractAddress.toLowerCase()}`;
  const cached = getCachedWithTtl<{ liquidityUsd: number; volume24h: number; pairCount: number }>(
    cacheKey,
    TTL_LIQ_MS,
  );
  if (cached) return cached;

  return dexLimiter.add(async () => {
    const response = await fetchWithTimeout(
      `https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`,
    );
    if (!response.ok) throw new Error(`DexScreener HTTP ${response.status}`);
    const json = (await response.json()) as DexTokenResponse;
    const addrLower = contractAddress.toLowerCase();

    // Prefer pairs on the target chain; drop zero-liquidity / non-matching base.
    let pairs = (json.pairs ?? []).filter((p) => {
      const base = (p.baseToken?.address || '').toLowerCase();
      const quote = (p.quoteToken?.address || '').toLowerCase();
      const matchesToken = base === addrLower || quote === addrLower;
      const hasLiq = (p.liquidity?.usd ?? 0) > 0;
      return matchesToken && hasLiq;
    });

    if (preferredChain === 'solana') {
      const sol = pairs.filter((p) => (p.chainId || '').toLowerCase() === 'solana');
      if (sol.length) pairs = sol;
    } else if (preferredChain === 'ethereum') {
      const eth = pairs.filter((p) => {
        const c = (p.chainId || '').toLowerCase();
        return c === 'ethereum' || c === 'eth';
      });
      if (eth.length) pairs = eth;
    }

    // Dedupe by pair identity-ish: chain + highest-liq wins per roughly same pool set
    pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    // Keep top 10 pools only — avoids inflating sum with dust/stale mirrors
    pairs = pairs.slice(0, 10);

    const liquidityUsd = pairs.reduce((s, p) => s + (p.liquidity?.usd ?? 0), 0);
    const volume24h = pairs.reduce((s, p) => s + (p.volume?.h24 ?? 0), 0);
    const result = { liquidityUsd, volume24h, pairCount: pairs.length };
    setCached(cacheKey, result);
    return result;
  });
}

/**
 * Real, keyless analysis path.
 * - Never invents circulating %, transfers, wallet type, or deployer.
 * - riskScore is always the internal WR-10.1 model (cross-chain comparable).
 * - externalRiskScore holds provider-native scores when available.
 */
async function analyzeTokenRiskPublic(
  coin: InsiderRiskCoin,
  isSolana: boolean,
  contractAddress: string,
): Promise<Partial<InsiderRiskData>> {
  const unavailableTransfers = {
    largeTransfers: [] as TransferEvent[],
    cexTransfers24h: 0,
    cexTransfers72h: 0,
    prePumpTransfer: null,
  };

  if (isSolana) {
    const [rug, dex] = await Promise.all([
      fetchRugCheckPublic(contractAddress),
      fetchDexLiquidity(contractAddress, 'solana').catch(() => null),
    ]);

    const extremeTeam = rug.top10Concentration > 90;
    const highConc = rug.top10Concentration > 80 && rug.top10Concentration <= 90;

    const internalRiskScore = computeInternalRiskScore({
      top10Concentration: rug.top10Concentration,
      mintAuthority: Boolean(rug.mintAuthority),
      freezeAuthority: Boolean(rug.freezeAuthority),
      rugged: rug.rugged,
      liquidityUsd: dex?.liquidityUsd ?? null,
      pairCount: dex?.pairCount ?? null,
    });

    const topHolder = rug.holders[0];

    return {
      chain: 'solana',
      address: contractAddress,
      totalSupply: rug.totalSupply,
      // Circulating % is NOT measured by RugCheck top-holders — leave 0 and
      // mark UNAVAILABLE. Never invent 100 - top10*0.35 as "circulating".
      circulatingSupply: 0,
      circulatingPercentage: 0,
      holders: rug.holders,
      top10Concentration: rug.top10Concentration,
      // top holder ≠ deployer
      deployerAddress: '',
      deployerBalance: 0,
      deployerWalletType: 'UNKNOWN',
      topHolderAddress: topHolder?.address || '',
      ...unavailableTransfers,
      flags: {
        lowCirculating: false, // not measured
        extremeTeamControl: extremeTeam,
        highConcentration: highConc,
        prePumpCEX: false, // not measured
        gnosisSafe: false, // not measured
        largeCEXTransfers: false, // not measured
      },
      riskScore: internalRiskScore,
      riskLevel: levelFromScore(internalRiskScore),
      externalRiskScore: rug.externalRiskScore,
      internalRiskScore,
      riskModelVersion: RISK_MODEL_VERSION,
      riskProvider: rug.externalRiskScore != null ? 'mixed' : 'rugcheck',
      fieldStatus: {
        circulating: 'UNAVAILABLE',
        holders: 'REAL',
        transfers: 'UNAVAILABLE',
        prePump: 'UNAVAILABLE',
        walletType: 'UNAVAILABLE',
        deployer: 'UNAVAILABLE',
        flags: 'DERIVED', // concentration flags derived from real holders; transfer flags unavailable
      },
    };
  }

  // Ethereum / EVM — Ethplorer freekey is real holder data
  const [eth, dex] = await Promise.all([
    fetchEthplorerHolders(contractAddress),
    fetchDexLiquidity(contractAddress, 'ethereum').catch(() => null),
  ]);

  const extremeTeam = eth.top10Concentration > 90;
  const highConc = eth.top10Concentration > 80 && eth.top10Concentration <= 90;

  const internalRiskScore = computeInternalRiskScore({
    top10Concentration: eth.top10Concentration,
    liquidityUsd: dex?.liquidityUsd ?? null,
    pairCount: dex?.pairCount ?? null,
  });

  const topHolder = eth.holders[0];

  return {
    chain: 'ethereum',
    address: contractAddress,
    totalSupply: eth.totalSupply,
    // Ethplorer totalSupply ≠ verified circulating supply
    circulatingSupply: 0,
    circulatingPercentage: 0,
    holders: eth.holders,
    top10Concentration: eth.top10Concentration,
    deployerAddress: '',
    deployerBalance: 0,
    deployerWalletType: 'UNKNOWN',
    topHolderAddress: topHolder?.address || '',
    ...unavailableTransfers,
    flags: {
      lowCirculating: false,
      extremeTeamControl: extremeTeam,
      highConcentration: highConc,
      prePumpCEX: false,
      gnosisSafe: false,
      largeCEXTransfers: false,
    },
    riskScore: internalRiskScore,
    riskLevel: levelFromScore(internalRiskScore),
    externalRiskScore: null,
    internalRiskScore,
    riskModelVersion: RISK_MODEL_VERSION,
    riskProvider: 'ethplorer',
    fieldStatus: {
      circulating: 'UNAVAILABLE',
      holders: 'REAL',
      transfers: 'UNAVAILABLE',
      prePump: 'UNAVAILABLE',
      walletType: 'UNAVAILABLE',
      deployer: 'UNAVAILABLE',
      flags: 'DERIVED',
    },
  };
}

// Main analysis orchestrator — always real data. Keys unlock deeper
// transfer/CEX analysis; without keys we still hit free public APIs.
export async function analyzeTokenRisk(
  coin: InsiderRiskCoin,
  settings: { etherscanKey?: string; birdeyeKey?: string; solanaCexAddresses?: Record<string, string[]> }
): Promise<Partial<InsiderRiskData>> {
  const solMint = coin.platforms?.solana || (coin.chain === 'solana' ? coin.contract_address : undefined);
  const ethAddr = coin.platforms?.ethereum || (coin.chain === 'ethereum' ? coin.contract_address : undefined)
    || coin.contract_address;
  const isSolana = Boolean(solMint) || coin.chain === 'solana';

  if (isSolana && settings.birdeyeKey && solMint) {
    const service = new BirdeyeService(settings.birdeyeKey);
    // settings.solanaCexAddresses is user-supplied (Settings UI) and
    // takes priority since SOLANA_CEX_ADDRESSES ships empty — see its
    // definition in types/insiderRisk.ts for why.
    return await service.analyzeToken(solMint, settings.solanaCexAddresses ?? SOLANA_CEX_ADDRESSES);
  }

  if (!isSolana && settings.etherscanKey && ethAddr) {
    const service = new EtherscanService(settings.etherscanKey);
    return await service.analyzeToken(ethAddr);
  }

  const contractAddress = isSolana ? solMint : ethAddr;
  if (!contractAddress) {
    throw new Error(
      `No contract address for ${coin.symbol || coin.id || 'token'} — native L1 or missing platforms map`,
    );
  }

  // Free public path (RugCheck / Ethplorer / DexScreener) — real on-chain data
  return await analyzeTokenRiskPublic(coin, isSolana, contractAddress);
}

// Batch analysis with progress
export async function analyzeBatchRisk(
  coins: InsiderRiskCoin[],
  settings: { etherscanKey?: string; birdeyeKey?: string },
  onProgress?: (current: number, total: number) => void
): Promise<Partial<InsiderRiskData>[]> {
  const results: Partial<InsiderRiskData>[] = [];

  for (let i = 0; i < coins.length; i++) {
    try {
      const result = await analyzeTokenRisk(coins[i], settings);
      results.push(result);
      onProgress?.(i + 1, coins.length);
    } catch (error) {
      console.error(`Failed to analyze ${coins[i].symbol}:`, error);
      results.push({});
    }

    // Small delay to prevent overwhelming APIs
    await new Promise(r => setTimeout(r, 200));
  }

  return results;
}
