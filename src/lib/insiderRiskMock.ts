// src/lib/insiderRiskMock.ts
/**
 * REMOVED — mock / simulated insider-risk rows are no longer generated.
 *
 * Real data paths (in order of preference):
 *  1. Birdeye (Solana) / Etherscan (ETH) when API keys are configured
 *  2. Keyless public APIs: RugCheck, Ethplorer freekey, DexScreener
 *  3. Honest riskLevel: 'UNKNOWN' row when no contract / API failure
 *
 * This file remains only so any stale import fails loudly at build time
 * instead of silently inventing holder tables again.
 */

import type { CoinData } from './whaleRadarState';
import type { InsiderRiskData } from '@/types/insiderRisk';

/** @deprecated Always throws — mock data has been removed. */
export function generateMockInsiderData(
  _coin: CoinData,
  _index: number,
): InsiderRiskData {
  throw new Error(
    'generateMockInsiderData was removed. Use analyzeTokenRisk() for real public/premium data.',
  );
}

/** @deprecated Always throws — mock data has been removed. */
export function generateMockInsiderBatch(_coins: CoinData[]): InsiderRiskData[] {
  throw new Error(
    'generateMockInsiderBatch was removed. Use analyzeTokenRisk() for real public/premium data.',
  );
}

export const PREDEFINED_SCAM_EXAMPLES: Record<string, never> = {};
