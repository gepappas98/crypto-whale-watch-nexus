// src/lib/insiderRiskApi.ts
/**
 * Real API service for Insider Risk Scanner
 * Handles Etherscan and Birdeye API calls with rate limiting and caching
 */

import { 
  InsiderRiskData, 
  TokenHolder, 
  TransferEvent, 
  DEFAULT_CEX_ADDRESSES 
} from '@/types/insiderRisk';
import { detectCEX, detectWalletType } from './insiderRiskUtils';

// ── Fetch with timeout (no AbortSignal.timeout — broad browser compat) ────────
function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Rate limiting queues
class RateLimiter {
  private queue: (() => Promise<any>)[] = [];
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
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

function getCached(key: string): any | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_DURATION) {
    return entry.data;
  }
  cache.delete(key);
  return null;
}

function setCached(key: string, data: any) {
  cache.set(key, { data, timestamp: Date.now() });
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
    const cached = getCached(cacheKey);
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
    const cached = getCached(cacheKey);
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

  async getRecentTransfers(contractAddress: string): Promise<any[]> {
    const cacheKey = `etherscan:transfers:${contractAddress}`;
    const cached = getCached(cacheKey);
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
    const cached = getCached(cacheKey);
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
        .filter((tx: any) => parseFloat(tx.value) > 500000)
        .map((tx: any) => {
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
      const prePumpTransfer = this.detectPrePumpPattern(largeTransfers);

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

  private detectPrePumpPattern(transfers: TransferEvent[]): InsiderRiskData['prePumpTransfer'] {
    const suspicious = transfers.find(t => 
      t.isToCEX && 
      t.value > 1e6 &&
      (Date.now() / 1000 - t.timestamp) < 86400
    );

    if (suspicious) {
      return {
        detected: true,
        amount: suspicious.value,
        timestamp: suspicious.timestamp,
        toExchange: suspicious.cexName || 'Unknown',
        hoursBeforePump: Math.floor((Date.now() / 1000 - suspicious.timestamp) / 3600)
      };
    }

    return null;
  }
}

// Birdeye API Service
export class BirdeyeService {
  private apiKey: string;
  private baseUrl = 'https://public-api.birdeye.so';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getTokenOverview(mintAddress: string): Promise<any> {
    const cacheKey = `birdeye:overview:${mintAddress}`;
    const cached = getCached(cacheKey);
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

      const data = await response.json();
      setCached(cacheKey, data.data);
      return data.data;
    });
  }

  async getTokenHolders(mintAddress: string): Promise<TokenHolder[]> {
    const cacheKey = `birdeye:holders:${mintAddress}`;
    const cached = getCached(cacheKey);
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

      const data = await response.json();
      const holders = data.data?.items || [];

      const totalSupply = holders.reduce((sum: number, h: any) => sum + (h.uiAmount || 0), 0);

      const formatted: TokenHolder[] = holders.map((h: any, index: number) => ({
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

  async analyzeToken(mintAddress: string): Promise<Partial<InsiderRiskData>> {
    try {
      const [overview, holders] = await Promise.all([
        this.getTokenOverview(mintAddress),
        this.getTokenHolders(mintAddress)
      ]);

      const top10Concentration = holders.reduce((sum, h) => sum + h.percentage, 0);
      const circulatingPct = overview.circulatingSupply && overview.totalSupply 
        ? (overview.circulatingSupply / overview.totalSupply) * 100 
        : 0;

      return {
        totalSupply: overview.totalSupply || 0,
        circulatingSupply: overview.circulatingSupply || 0,
        circulatingPercentage: circulatingPct,
        holders,
        top10Concentration,
        deployerAddress: holders[0]?.address || '',
        deployerBalance: holders[0]?.balance || 0,
        deployerWalletType: holders[0]?.isContract ? 'MULTISIG' : 'EOA',
        largeTransfers: [], // Birdeye requires separate tx history API
        cexTransfers24h: 0,
        cexTransfers72h: 0,
        prePumpTransfer: null
      };
    } catch (error) {
      console.error('Birdeye analysis error:', error);
      throw error;
    }
  }
}

// Main analysis orchestrator
export async function analyzeTokenRisk(
  coin: any,
  settings: { etherscanKey?: string; birdeyeKey?: string }
): Promise<Partial<InsiderRiskData>> {
  const isSolana = coin.chain === 'solana' || coin.platforms?.solana;

  if (isSolana && settings.birdeyeKey) {
    const service = new BirdeyeService(settings.birdeyeKey);
    const mintAddress = coin.platforms?.solana || coin.contract_address;
    if (mintAddress) {
      return await service.analyzeToken(mintAddress);
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
  coins: any[],
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
