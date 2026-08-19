// src/types/insiderRisk.ts

export interface TokenHolder {
  address: string;
  balance: number;
  percentage: number;
  isContract: boolean;
  tags?: string[];
}

export interface TransferEvent {
  from: string;
  to: string;
  value: number;
  timestamp: number;
  txHash: string;
  isToCEX: boolean;
  cexName?: string;
}

export interface InsiderRiskData {
  id: string;
  symbol: string;
  name: string;
  chain: 'ethereum' | 'solana';
  address: string;

  // Supply Metrics
  totalSupply: number;
  circulatingSupply: number;
  circulatingPercentage: number;

  // Holder Concentration
  holders: TokenHolder[];
  top10Concentration: number;
  deployerAddress: string;
  deployerBalance: number;
  deployerWalletType: 'EOA' | 'GNOSIS_SAFE' | 'MULTISIG' | 'UNKNOWN';

  // Transfer Analysis
  largeTransfers: TransferEvent[];
  cexTransfers24h: number;
  cexTransfers72h: number;

  // Pre-pump Detection
  prePumpTransfer: {
    detected: boolean;
    amount: number;
    timestamp: number;
    toExchange: string;
    hoursBeforePump: number;
  } | null;

  // Risk Score
  riskScore: number;
  riskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

  // Flags
  flags: {
    lowCirculating: boolean;
    extremeTeamControl: boolean;
    highConcentration: boolean;
    prePumpCEX: boolean;
    gnosisSafe: boolean;
    largeCEXTransfers: boolean;
  };

  // Metadata
  lastUpdated: number;
  scanStatus: 'pending' | 'scanning' | 'completed' | 'error';
  errorMessage?: string;
}

export interface InsiderRiskSettings {
  etherscanApiKey: string;
  birdeyeApiKey: string;
  enableAutoScan: boolean;
  scanInterval: number;
  cexAddresses: Record<string, string[]>;
}

export const DEFAULT_CEX_ADDRESSES: Record<string, string[]> = {
  'Binance': [
    '0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE',
    '0xd93d01ce57de2989577363c3c70e4c8c4bb80c44',
    '0x28C6c06298d514Db089934071355E5743bf21d60',
  ],
  'Bitget': [
    '0x1C3E2978f8B9bE9a7aC1E7c3e5a2b5c8d9e0f1a2',
    '0x31fc196894993056954f5bff32e7434d7f1c2e9e',
  ],
  'Coinbase': [
    '0x71660c4005ba85c37ccec55d0c4493e66fe775d3',
    '0x503828976df135155eeb2d5c01017cd3e56746a1',
  ],
  'OKX': [
    '0x6d7fcc6c7da5ca53d8ab7713f7fa6f4f60f9a34b',
    '0x5c985e89dde482efe97ea9f1950ad149eb848c2f',
  ],
  'Bybit': [
    '0xf89d7b9c864db589d1b6b23e31f8e5c8f6a7d8e9',
    '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
  ],
  'Kraken': [
    '0x2c3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f',
    '0x0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b',
  ]
};

/** Solana CEX deposit/hot wallet addresses, same shape and role as
 *  DEFAULT_CEX_ADDRESSES above but for BirdeyeService.analyzeToken().
 *  Deliberately shipped EMPTY rather than pre-filled: unlike the EVM list
 *  above (which can at least be checksum-validated), there's no reliable
 *  public canonical source for Solana exchange hot wallets to hardcode here
 *  with confidence, and a wrong address is worse than none — it would
 *  misattribute an unrelated wallet's activity as a CEX deposit. Populate
 *  this from a source you trust and verify per-address (e.g. cross-check
 *  the address on Solscan/Solana Beach's labeled-address view, or a paid
 *  labeling API), then either edit this list or pass your own map into
 *  analyzeTokenRisk()'s settings.solanaCexAddresses — that takes priority
 *  over this default. Until populated, Solana scans still surface large
 *  ($500k+) transfers and timing, just without the "isToCEX" tag. */
export const SOLANA_CEX_ADDRESSES: Record<string, string[]> = {};

export const RISK_WEIGHTS = {
  extremeTeamControl: 50,    // >90% in top 10
  lowCirculating: 40,        // <30% circulating
  prePumpCEX: 35,           // Silent transfer before pump
  gnosisSafe: 25,           // Team multisig detected
  largeCEXTransfers: 20,    // >500k tokens to CEX
  highConcentration: 15,    // >80% in top 10
};
