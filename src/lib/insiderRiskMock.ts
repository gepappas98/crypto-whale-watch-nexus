// src/lib/insiderRiskMock.ts
/**
 * Mock data service for Insider Risk Scanner
 * Generates realistic risk data for demonstration when API keys are not available
 */

import { InsiderRiskData, TokenHolder, TransferEvent, DEFAULT_CEX_ADDRESSES } from '@/types/insiderRisk';

// Known "scam" patterns for realistic mock generation
const SUSPICIOUS_PATTERNS = [
  {
    name: 'Low Float + High Control',
    circulatingRange: [15, 25],
    top10Range: [90, 98],
    hasPrePump: true,
    walletType: 'GNOSIS_SAFE' as const,
    description: 'Classic pump & dump setup'
  },
  {
    name: 'Team Multisig Control',
    circulatingRange: [30, 50],
    top10Range: [80, 90],
    hasPrePump: false,
    walletType: 'MULTISIG' as const,
    description: 'Team-controlled via multisig'
  },
  {
    name: 'Organic Distribution',
    circulatingRange: [60, 90],
    top10Range: [40, 60],
    hasPrePump: false,
    walletType: 'EOA' as const,
    description: 'Relatively healthy distribution'
  },
  {
    name: 'Whale Concentration',
    circulatingRange: [40, 70],
    top10Range: [70, 85],
    hasPrePump: Math.random() > 0.7,
    walletType: 'EOA' as const,
    description: 'Whale-dominated but not extreme'
  }
];

// Generate deterministic random from seed
function seededRandom(seed: number): number {
  const x = Math.sin(seed++) * 10000;
  return x - Math.floor(x);
}

// Generate mock holder data
function generateMockHolders(
  pattern: typeof SUSPICIOUS_PATTERNS[0],
  seed: number
): TokenHolder[] {
  const holders: TokenHolder[] = [];
  const targetConcentration = pattern.top10Range[0] + 
    seededRandom(seed) * (pattern.top10Range[1] - pattern.top10Range[0]);

  let remaining = targetConcentration;

  // Generate 10 holders with decreasing percentages
  for (let i = 0; i < 10; i++) {
    // First holder gets largest share (team/deployer)
    const share = i === 0 
      ? remaining * (0.3 + seededRandom(seed + i) * 0.2) // 30-50% for deployer
      : remaining * (0.08 + seededRandom(seed + i) * 0.12); // 8-20% for others

    remaining -= share;

    holders.push({
      address: generateMockAddress(seed + i),
      balance: share * 1e9,
      percentage: share,
      isContract: i === 0 && pattern.walletType === 'GNOSIS_SAFE',
      tags: i === 0 ? ['Deployer', 'Team'] : i < 3 ? ['Team'] : []
    });
  }

  return holders;
}

// Generate mock Ethereum address
function generateMockAddress(seed: number): string {
  const chars = '0123456789abcdef';
  let addr = '0x';
  for (let i = 0; i < 40; i++) {
    addr += chars[Math.floor(seededRandom(seed + i) * 16)];
  }
  return addr;
}

// Generate mock transaction hash
function generateMockTxHash(seed: number): string {
  const chars = '0123456789abcdef';
  let hash = '0x';
  for (let i = 0; i < 64; i++) {
    hash += chars[Math.floor(seededRandom(seed + i) * 16)];
  }
  return hash;
}

// Generate transfer events
function generateMockTransfers(
  pattern: typeof SUSPICIOUS_PATTERNS[0],
  deployerAddress: string,
  seed: number
): TransferEvent[] {
  const transfers: TransferEvent[] = [];

  // If pre-pump pattern, generate suspicious transfer
  if (pattern.hasPrePump && seededRandom(seed) > 0.3) {
    const amount = 10e6 + seededRandom(seed + 1) * 20e6; // 10-30M tokens
    const hoursAgo = 6 + seededRandom(seed + 2) * 18; // 6-24 hours ago

    const cexNames = Object.keys(DEFAULT_CEX_ADDRESSES);
    const targetCex = cexNames[Math.floor(seededRandom(seed + 3) * cexNames.length)];
    const cexAddress = DEFAULT_CEX_ADDRESSES[targetCex][0];

    transfers.push({
      from: deployerAddress,
      to: cexAddress,
      value: amount,
      timestamp: (Date.now() / 1000) - (hoursAgo * 3600),
      txHash: generateMockTxHash(seed + 4),
      isToCEX: true,
      cexName: targetCex
    });
  }

  // Add some random smaller transfers
  const transferCount = Math.floor(seededRandom(seed + 5) * 3);
  for (let i = 0; i < transferCount; i++) {
    const isToCex = seededRandom(seed + i + 10) > 0.5;
    transfers.push({
      from: deployerAddress,
      to: isToCex 
        ? DEFAULT_CEX_ADDRESSES['Binance'][0]
        : generateMockAddress(seed + i + 20),
      value: 500000 + seededRandom(seed + i + 15) * 1e6,
      timestamp: (Date.now() / 1000) - (seededRandom(seed + i + 25) * 172800), // Up to 48h ago
      txHash: generateMockTxHash(seed + i + 30),
      isToCEX: isToCex,
      cexName: isToCex ? 'Binance' : undefined
    });
  }

  return transfers.sort((a, b) => b.timestamp - a.timestamp);
}

// Calculate risk score from pattern
function calculateMockRiskScore(
  pattern: typeof SUSPICIOUS_PATTERNS[0],
  circulatingPct: number,
  top10Pct: number,
  hasPrePump: boolean
): { score: number; level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' } {
  let score = 0;

  // Low circulating
  if (circulatingPct < 30) score += 40;
  else if (circulatingPct < 50) score += 20;

  // High concentration
  if (top10Pct > 90) score += 50;
  else if (top10Pct > 80) score += 15;

  // Pre-pump
  if (hasPrePump) score += 35;

  // Multisig
  if (pattern.walletType === 'GNOSIS_SAFE') score += 25;
  else if (pattern.walletType === 'MULTISIG') score += 15;

  // Determine level
  let level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
  if (score >= 70) level = 'CRITICAL';
  else if (score >= 40) level = 'HIGH';
  else if (score >= 10) level = 'MEDIUM';

  return { score, level };
}

// Main mock data generator
export function generateMockInsiderData(
  coin: any,
  index: number
): InsiderRiskData {
  // Use symbol hash as seed for deterministic "random" data
  const seed = coin.symbol.split('').reduce((a: number, b: string) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, index);

  // Select pattern based on seed
  const patternIndex = Math.floor(seededRandom(seed) * SUSPICIOUS_PATTERNS.length);
  const pattern = SUSPICIOUS_PATTERNS[patternIndex];

  // Generate metrics
  const circulatingPct = pattern.circulatingRange[0] + 
    seededRandom(seed + 100) * (pattern.circulatingRange[1] - pattern.circulatingRange[0]);

  // Generate holders
  const holders = generateMockHolders(pattern, seed);
  const top10Pct = holders.reduce((sum, h) => sum + h.percentage, 0);
  const deployerAddress = holders[0]?.address || generateMockAddress(seed);

  // Generate transfers
  const transfers = generateMockTransfers(pattern, deployerAddress, seed);
  const prePumpTransfer = transfers.find(t => 
    t.isToCEX && 
    t.value > 1e6 && 
    ((Date.now() / 1000) - t.timestamp) < 86400
  );

  // Calculate risk
  const { score, level } = calculateMockRiskScore(
    pattern, 
    circulatingPct, 
    top10Pct, 
    !!prePumpTransfer
  );

  // Build flags
  const flags = {
    lowCirculating: circulatingPct < 30,
    extremeTeamControl: top10Pct > 90,
    highConcentration: top10Pct > 80 && top10Pct <= 90,
    prePumpCEX: !!prePumpTransfer,
    gnosisSafe: pattern.walletType === 'GNOSIS_SAFE',
    largeCEXTransfers: transfers.filter(t => t.isToCEX && t.value > 500000).length > 0
  };

  return {
    id: coin.id || `token-${index}`,
    symbol: coin.symbol || 'UNKNOWN',
    name: coin.name || 'Unknown Token',
    chain: seededRandom(seed + 200) > 0.5 ? 'ethereum' : 'solana',
    address: generateMockAddress(seed + 300),

    totalSupply: 1e9,
    circulatingSupply: 1e9 * (circulatingPct / 100),
    circulatingPercentage: circulatingPct,

    holders,
    top10Concentration: top10Pct,
    deployerAddress,
    deployerBalance: holders[0]?.balance || 0,
    deployerWalletType: pattern.walletType,

    largeTransfers: transfers,
    cexTransfers24h: transfers.filter(t => 
      t.isToCEX && 
      ((Date.now() / 1000) - t.timestamp) < 86400
    ).length,
    cexTransfers72h: transfers.filter(t => 
      t.isToCEX && 
      ((Date.now() / 1000) - t.timestamp) < 259200
    ).length,

    prePumpTransfer: prePumpTransfer ? {
      detected: true,
      amount: prePumpTransfer.value,
      timestamp: prePumpTransfer.timestamp,
      toExchange: prePumpTransfer.cexName || 'Unknown',
      hoursBeforePump: Math.floor(((Date.now() / 1000) - prePumpTransfer.timestamp) / 3600)
    } : null,

    riskScore: score,
    riskLevel: level,
    flags,

    lastUpdated: Date.now(),
    scanStatus: 'completed'
  };
}

// Generate batch of mock data
export function generateMockInsiderBatch(coins: any[]): InsiderRiskData[] {
  return coins.map((coin, index) => generateMockInsiderData(coin, index));
}

// Predefined "scam" examples for demos
export const PREDEFINED_SCAM_EXAMPLES: Record<string, Partial<InsiderRiskData>> = {
  'RAVE': {
    circulatingPercentage: 25,
    top10Concentration: 98,
    riskScore: 95,
    riskLevel: 'CRITICAL',
    flags: {
      lowCirculating: true,
      extremeTeamControl: true,
      highConcentration: false,
      prePumpCEX: true,
      gnosisSafe: true,
      largeCEXTransfers: true
    },
    prePumpTransfer: {
      detected: true,
      amount: 19e6,
      timestamp: Date.now() / 1000 - 43200,
      toExchange: 'Bitget',
      hoursBeforePump: 12
    },
    deployerWalletType: 'GNOSIS_SAFE'
  },
  'PEPE': {
    circulatingPercentage: 85,
    top10Concentration: 45,
    riskScore: 5,
    riskLevel: 'LOW',
    flags: {
      lowCirculating: false,
      extremeTeamControl: false,
      highConcentration: false,
      prePumpCEX: false,
      gnosisSafe: false,
      largeCEXTransfers: false
    }
  },
  'BONK': {
    circulatingPercentage: 92,
    top10Concentration: 35,
    riskScore: 0,
    riskLevel: 'LOW',
    flags: {
      lowCirculating: false,
      extremeTeamControl: false,
      highConcentration: false,
      prePumpCEX: false,
      gnosisSafe: false,
      largeCEXTransfers: false
    }
  }
};
