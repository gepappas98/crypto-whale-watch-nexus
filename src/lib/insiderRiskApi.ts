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
 *  object — there's no contract to inspect — and still degrade to mock data,
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

// Main analysis orchestrator
export async function analyzeTokenRisk(
  coin: InsiderRiskCoin,
  settings: { etherscanKey?: string; birdeyeKey?: string; solanaCexAddresses?: Record<string, string[]> }
): Promise<Partial<InsiderRiskData>> {
  const isSolana = coin.chain === 'solana' || coin.platforms?.solana;

  if (isSolana && settings.birdeyeKey) {
    const service = new BirdeyeService(settings.birdeyeKey);
    const mintAddress = coin.platforms?.solana || coin.contract_address;
    if (mintAddress) {
      // settings.solanaCexAddresses is user-supplied (Settings UI) and
      // takes priority since SOLANA_CEX_ADDRESSES ships empty — see its
      // definition in types/insiderRisk.ts for why.
      return await service.analyzeToken(mintAddress, settings.solanaCexAddresses ?? SOLANA_CEX_ADDRESSES);
    }
  }

  if (!isSolana && settings.etherscanKey) {
    const service = new EtherscanService(settings.etherscanKey);
    const contractAddress = coin.platforms?.ethereum || coin.contract_address;
    if (contractAddress) {
      return await service.analyzeToken(contractAddress);
    }
  }

  throw new Error('No valid API configuration for this token');
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
