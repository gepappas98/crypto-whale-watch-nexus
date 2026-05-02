// src/lib/insiderRiskUtils.ts

import { InsiderRiskData, TransferEvent, TokenHolder } from '@/types/insiderRisk';

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
  const normalized = address.toLowerCase();

  for (const [cex, addresses] of Object.entries(cexAddresses)) {
    if (addresses.some(addr => addr.toLowerCase() === normalized)) {
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
): { detected: boolean; confidence: number; details?: any } {
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

/**
 * Fetch token holders from Etherscan
 */
export async function fetchEtherscanTokenHolders(
  contractAddress: string,
  apiKey: string
): Promise<TokenHolder[]> {
  const url = `https://api.etherscan.io/api?module=token&action=tokenholderlist&contractaddress=${contractAddress}&page=1&offset=10&apikey=${apiKey}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== '1') {
    throw new Error(data.message || 'Failed to fetch holders');
  }

  const totalSupply = data.result.reduce((sum: number, h: any) => sum + parseFloat(h.TokenHolderQuantity), 0);

  return data.result.map((h: any) => ({
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
  const data = await response.json();

  if (data.status !== '1') {
    return [];
  }

  return data.result.map((tx: any) => ({
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
): Promise<any> {
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
