// src/lib/insiderRiskUtils.ts

import { InsiderRiskData, TransferEvent, TokenHolder } from '@/types/insiderRisk';

/** Shared by EtherscanService and BirdeyeService's analyzeToken() — same
 *  pattern used on both chains: a large (>$1M) transfer TO a known CEX
 *  address within the last 24h counts as a pre-pump signal. Previously this
 *  lived only inside EtherscanService as a private method, so the Solana
 *  path had no equivalent and always returned null regardless of activity. */
export function detectPrePumpPattern(transfers: TransferEvent[]): InsiderRiskData['prePumpTransfer'] {
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

/**
 * Calculate insider risk score based on various factors
 */
export function calculateRiskScore(data: Partial<InsiderRiskData>): {
  score: number;
  level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  flags: InsiderRiskData['flags'];
} {
  let score = 0;
  const flags: InsiderRiskData['flags'] = {
    lowCirculating: false,
    extremeTeamControl: false,
    highConcentration: false,
    prePumpCEX: false,
    gnosisSafe: false,
    largeCEXTransfers: false,
  };

  // Check circulating supply
  if (data.circulatingPercentage !== undefined && data.circulatingPercentage < 30) {
    score += 40;
    flags.lowCirculating = true;
  }

  // Check holder concentration
  if (data.top10Concentration !== undefined) {
    if (data.top10Concentration > 90) {
      score += 50;
      flags.extremeTeamControl = true;
    } else if (data.top10Concentration > 80) {
      score += 15;
      flags.highConcentration = true;
    }
  }

  // Check for pre-pump transfers
  if (data.prePumpTransfer?.detected) {
    score += 35;
    flags.prePumpCEX = true;
  }

  // Check wallet type
  if (data.deployerWalletType === 'GNOSIS_SAFE' || data.deployerWalletType === 'MULTISIG') {
    score += 25;
    flags.gnosisSafe = true;
  }

  // Check large CEX transfers
  if (data.cexTransfers24h && data.cexTransfers24h > 0) {
    score += 20;
    flags.largeCEXTransfers = true;
  }

  // Determine risk level
  let level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
  if (score >= 70) level = 'CRITICAL';
  else if (score >= 40) level = 'HIGH';
  else if (score >= 10) level = 'MEDIUM';

  return { score, level, flags };
}

/**
 * Detect if an address belongs to a known CEX
 */
export function detectCEX(address: string, cexAddresses: Record<string, string[]>): {
  isCEX: boolean;
  name?: string;
} {
  // EVM addresses (0x...) are case-insensitive (the mixed case some
  // addresses ship with is just EIP-55 checksumming, not distinct
  // characters), so lowercasing both sides before comparing is correct
  // there. Solana addresses are base58 — case IS significant, two
  // addresses differing only by case are different addresses — so they
  // must compare exactly as given, not lowercased.
  const isEvm = address.startsWith('0x') || address.startsWith('0X');
  const normalized = isEvm ? address.toLowerCase() : address;

  for (const [cex, addresses] of Object.entries(cexAddresses)) {
    const match = addresses.some(addr =>
      isEvm ? addr.toLowerCase() === normalized : addr === normalized
    );
    if (match) {
      return { isCEX: true, name: cex };
    }
  }

  return { isCEX: false };
}

/**
 * Detect wallet type from bytecode or signatures
 */
export function detectWalletType(bytecode?: string, codeHash?: string): 'GNOSIS_SAFE' | 'MULTISIG' | 'EOA' | 'UNKNOWN' {
  if (!bytecode || bytecode === '0x') return 'EOA';

  // Gnosis Safe bytecode signatures
  const gnosisSignatures = [
    '0x60806040', // Gnosis Safe proxy
    '0x60a06040', // Gnosis Safe v1.3.0
  ];

  // Multisig patterns
  const multisigPatterns = [
    'multisig',
    'confirmTransaction',
    'submitTransaction',
  ];

  if (gnosisSignatures.some(sig => bytecode.startsWith(sig))) {
    return 'GNOSIS_SAFE';
  }

  if (multisigPatterns.some(pattern => bytecode.toLowerCase().includes(pattern))) {
    return 'MULTISIG';
  }

  return 'UNKNOWN';
}

/**
 * Analyze transfer patterns for pre-pump detection
 */
export function analyzePrePumpPattern(
  transfers: TransferEvent[],
  priceChange24h: number
): {
  detected: boolean;
  confidence: number;
  details?: { transfers: TransferEvent[]; totalAmount: number; avgHoursBefore: number };
} {
  if (!transfers.length || priceChange24h < 20) {
    return { detected: false, confidence: 0 };
  }

  // Look for large transfers to CEX within 24h before price jump
  const now = Date.now() / 1000;
  const suspiciousTransfers = transfers.filter(t => 
    t.isToCEX && 
    t.value > 1e6 && // > 1M tokens
    (now - t.timestamp) < 86400 // Within 24h
  );

  if (suspiciousTransfers.length === 0) {
    return { detected: false, confidence: 0 };
  }

  // Calculate confidence based on timing and amount
  const totalAmount = suspiciousTransfers.reduce((sum, t) => sum + t.value, 0);
  const avgTimeBefore = suspiciousTransfers.reduce((sum, t) => sum + (now - t.timestamp), 0) / suspiciousTransfers.length;

  const confidence = Math.min(100, 
    (suspiciousTransfers.length * 20) + 
    (totalAmount / 1e6 * 5) + 
    (avgTimeBefore < 43200 ? 30 : 10) // Extra points if within 12h
  );

  return {
    detected: confidence > 60,
    confidence,
    details: {
      transfers: suspiciousTransfers,
      totalAmount,
      avgHoursBefore: Math.floor(avgTimeBefore / 3600)
    }
  };
}

/**
 * Export risk data to CSV
 */
export function exportInsiderRiskCSV(data: InsiderRiskData[]): void {
  const headers = [
    'Symbol',
    'Name',
    'Chain',
    'Contract Address',
    'Risk Score',
    'Risk Level',
    'Data Source',
    'Circulating %',
    'Top 10 Concentration %',
    'Deployer Wallet Type',
    'Large CEX Transfers (24h)',
    'Large CEX Transfers (72h)',
    'Pre-pump Detected',
    'Pre-pump Amount',
    'Pre-pump Exchange',
    'Flags',
    'Last Updated'
  ];

  const rows = data.map(token => [
    token.symbol,
    token.name,
    token.chain,
    token.address,
    token.riskScore,
    token.riskLevel,
    // Real vs simulated (or, for a failed real scan, "real" with an
    // UNKNOWN risk level and empty metrics — see WRInsiderRiskScanner.tsx).
    // Exported explicitly so this distinction survives outside the app.
    token.dataSource,
    token.circulatingPercentage.toFixed(2),
    token.top10Concentration.toFixed(2),
    token.deployerWalletType,
    token.cexTransfers24h,
    token.cexTransfers72h,
    token.prePumpTransfer?.detected ? 'YES' : 'NO',
    token.prePumpTransfer?.amount || 0,
    token.prePumpTransfer?.toExchange || '',
    Object.entries(token.flags)
      .filter(([_, active]) => active)
      .map(([key]) => key)
      .join('; '),
    new Date(token.lastUpdated).toISOString()
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `insider-risk-scan-${Date.now()}.csv`);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

interface EtherscanHolderRow { TokenHolderAddress: string; TokenHolderQuantity: string }
interface EtherscanTransferRow { from: string; to: string; value: string; tokenDecimal: string; timeStamp: string; hash: string }
interface EtherscanListResponse<T> { status: string; message?: string; result: T[] }

/**
 * Fetch token holders from Etherscan
 */
export async function fetchEtherscanTokenHolders(
  contractAddress: string,
  apiKey: string
): Promise<TokenHolder[]> {
  const url = `https://api.etherscan.io/api?module=token&action=tokenholderlist&contractaddress=${contractAddress}&page=1&offset=10&apikey=${apiKey}`;

  const response = await fetch(url);
  const data = await response.json() as EtherscanListResponse<EtherscanHolderRow>;

  if (data.status !== '1') {
    throw new Error(data.message || 'Failed to fetch holders');
  }

  const totalSupply = data.result.reduce((sum, h) => sum + parseFloat(h.TokenHolderQuantity), 0);

  return data.result.map((h) => ({
    address: h.TokenHolderAddress,
    balance: parseFloat(h.TokenHolderQuantity),
    percentage: (parseFloat(h.TokenHolderQuantity) / totalSupply) * 100,
    isContract: h.TokenHolderAddress !== h.TokenHolderAddress.toLowerCase(), // Simplified check
  }));
}

/**
 * Fetch transfers from Etherscan
 */
export async function fetchEtherscanTransfers(
  contractAddress: string,
  deployerAddress: string,
  apiKey: string
): Promise<TransferEvent[]> {
  // Get internal transactions for deployer
  const url = `https://api.etherscan.io/api?module=account&action=tokentx&contractaddress=${contractAddress}&address=${deployerAddress}&page=1&offset=100&sort=desc&apikey=${apiKey}`;

  const response = await fetch(url);
  const data = await response.json() as EtherscanListResponse<EtherscanTransferRow>;

  if (data.status !== '1') {
    return [];
  }

  return data.result.map((tx) => ({
    from: tx.from,
    to: tx.to,
    value: parseFloat(tx.value) / Math.pow(10, parseInt(tx.tokenDecimal)),
    timestamp: parseInt(tx.timeStamp),
    txHash: tx.hash,
    isToCEX: false, // Will be checked later
  }));
}

/**
 * Fetch Solana token data from Birdeye
 */
export async function fetchBirdeyeTokenData(
  mintAddress: string,
  apiKey: string
): Promise<unknown> {
  const response = await fetch(`https://public-api.birdeye.so/defi/token_overview?address=${mintAddress}`, {
    headers: {
      'X-API-KEY': apiKey,
      'x-chain': 'solana'
    }
  });

  if (!response.ok) {
    throw new Error('Failed to fetch Birdeye data');
  }

  return response.json();
}

/**
 * Format large numbers for display
 */
export function formatTokenAmount(amount: number, decimals: number = 0): string {
  if (amount >= 1e9) return `${(amount / 1e9).toFixed(2)}B`;
  if (amount >= 1e6) return `${(amount / 1e6).toFixed(2)}M`;
  if (amount >= 1e3) return `${(amount / 1e3).toFixed(2)}K`;
  return amount.toFixed(decimals);
}
