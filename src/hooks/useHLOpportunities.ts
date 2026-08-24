/* ══ HYPERLIQUID — Opportunity signals indexed by symbol ═════════════════════
 * Re-runs the same opportunity-detection engine used by HLOpportunityPanel,
 * but exposes results keyed by symbol so other panels (e.g. WRScanner) can
 * highlight rows that match an active perps opportunity.
 * 
 * FIX v1.1: Added null-safety for all market fields. Prevents render crash
 * when API returns partial data.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { useMemo } from 'react';
import { useHLMarkets } from '@/hooks/useHyperliquid';
import type { HLMarket } from '@/lib/hyperliquid';

const FUNDING_THRESHOLD = 0.0008;
const EXTREME_FUNDING = 0.002;
const PREMIUM_THRESHOLD = 0.003;
const BASIS_EDGE_MIN = 0.004;
const SQUEEZE_OI_MIN = 20_000_000;
const WHALE_OI_MAX = 10_000_000;
const WHALE_VOL_RATIO = 0.5;
const LIQ_CLUSTER_PCT = 0.015;

const fmtPct = (n: number) => `${(n * 100).toFixed(3)}%`;

// ── Safe type for opportunity signals (mirrors HLSignal without full import) ─
export interface HLOppSignal {
  symbol: string;
  fundingRate: number;
  premium: number;
  openInterest: number;
  dailyVolume: number;
  markPrice: number;
  indexPrice: number;
  opportunityType: string;
  level: 'critical' | 'high' | 'medium';
  side: 'LONG' | 'SHORT' | 'NEUTRAL';
  expectedEdge: string;
  reason: string;
  apyEstimate: number;
  riskScore: number;
  conviction: number;
}

interface UseHLOpportunitiesOpts {
  enabled?: boolean;
  minApy?: number;
}

export interface UseHLOpportunitiesResult {
  /** Best (highest-conviction) signal per symbol, normalized UPPERCASE. */
  bySymbol: Map<string, HLOppSignal>;
  /** All signals (across all symbols / types). */
  all: HLOppSignal[];
  /** Lookup helper — accepts any symbol casing. */
  match: (symbol: string | undefined | null) => HLOppSignal | undefined;
}

export function useHLOpportunities({
  enabled = true,
  minApy = 12,
}: UseHLOpportunitiesOpts = {}): UseHLOpportunitiesResult {
  const { markets } = useHLMarkets();

  return useMemo(() => {
    const empty: UseHLOpportunitiesResult = {
      bySymbol: new Map(),
      all: [],
      match: () => undefined,
    };
    if (!enabled || !markets?.length) return empty;

    const opps: HLOppSignal[] = [];

    markets.forEach((m: HLMarket) => {
      // ── Null-safety: skip malformed market data ────────────────────────
      if (!m || typeof m !== 'object') return;

      const fundingRate = typeof m.fundingRate === 'number' ? m.fundingRate : 0;
      const premium = typeof m.premium === 'number' ? m.premium : 0;
      const oi = typeof m.openInterest === 'number' ? m.openInterest : 0;
      const vol = typeof m.dayVolume === 'number' ? m.dayVolume : 0;
      const markPrice = typeof m.markPrice === 'number' ? m.markPrice : 0;
      const indexPrice = typeof m.oraclePrice === 'number' ? m.oraclePrice : 0;
      const symbol = typeof m.symbol === 'string' ? m.symbol : '';

      if (!symbol) return;

      const push = (s: Partial<HLOppSignal> & Pick<HLOppSignal, 'opportunityType' | 'level' | 'side' | 'expectedEdge' | 'reason'>) => {
        opps.push({
          symbol,
          fundingRate,
          premium,
          openInterest: oi,
          dailyVolume: vol,
          markPrice,
          indexPrice,
          apyEstimate: 0,
          riskScore: 50,
          conviction: 60,
          ...s,
        });
      };

      // 1. FUNDING ARB
      if (Math.abs(fundingRate) > FUNDING_THRESHOLD) {
        const apy = Math.abs(fundingRate) * 3 * 365 * 100;
        if (apy >= minApy) {
          const isExtreme = Math.abs(fundingRate) > EXTREME_FUNDING;
          const side = fundingRate > 0 ? 'SHORT' : 'LONG';
          push({
            opportunityType: 'funding_arb',
            level: isExtreme ? 'critical' : 'high',
            side,
            apyEstimate: apy,
            riskScore: isExtreme ? 75 : 45,
            conviction: isExtreme ? 92 : 78,
            expectedEdge: `${side} earns ${fmtPct(Math.abs(fundingRate))}/8h`,
            reason: `${side} side collects funding.`,
          });
        }
      }

      // 2. BASIS
      if (Math.abs(premium) > PREMIUM_THRESHOLD && Math.abs(fundingRate) > FUNDING_THRESHOLD) {
        const edge = Math.abs(premium) - Math.abs(fundingRate) * 3;
        if (edge > BASIS_EDGE_MIN) {
          const isCritical = edge > 0.01;
          push({
            opportunityType: 'basis_trade',
            level: isCritical ? 'critical' : 'high',
            side: 'NEUTRAL',
            apyEstimate: edge * 2 * 365 * 100,
            riskScore: 35,
            conviction: isCritical ? 88 : 72,
            expectedEdge: `Basis edge ${fmtPct(edge)}`,
            reason: `Premium ${fmtPct(premium)} vs funding ${fmtPct(fundingRate)}.`,
          });
        }
      }

      // 3. SHORT SQUEEZE
      if (fundingRate < -EXTREME_FUNDING && oi > SQUEEZE_OI_MIN) {
        push({
          opportunityType: 'squeeze_short',
          level: 'critical',
          side: 'LONG',
          apyEstimate: Math.abs(fundingRate) * 3 * 365 * 100,
          riskScore: 85,
          conviction: 90,
          expectedEdge: 'Short squeeze candidate',
          reason: `Shorts paying heavy funding on high OI.`,
        });
      }

      // 4. LONG SQUEEZE
      if (fundingRate > EXTREME_FUNDING && oi > SQUEEZE_OI_MIN) {
        push({
          opportunityType: 'squeeze_long',
          level: 'critical',
          side: 'SHORT',
          apyEstimate: fundingRate * 3 * 365 * 100,
          riskScore: 80,
          conviction: 68,
          expectedEdge: 'Long squeeze candidate',
          reason: `Longs paying heavy funding on high OI.`,
        });
      }

      // 5. WHALE IMPACT
      if (oi > 0 && oi < WHALE_OI_MAX && vol > oi * WHALE_VOL_RATIO) {
        push({
          opportunityType: 'whale_impact',
          level: 'high',
          side: premium > 0 ? 'LONG' : 'SHORT',
          riskScore: 70,
          conviction: 55,
          expectedEdge: `Whale activity ${(vol / oi).toFixed(1)}x OI`,
          reason: `Illiquid market with outsized volume.`,
        });
      }

      // 6. LIQ CLUSTER
      if (oi > 5_000_000 && Math.abs(premium) > LIQ_CLUSTER_PCT) {
        push({
          opportunityType: 'liq_cluster',
          level: 'high',
          side: premium > 0 ? 'SHORT' : 'LONG',
          apyEstimate: Math.abs(premium) * 100 * 365,
          riskScore: 78,
          conviction: 62,
          expectedEdge: `Liq cluster near price`,
          reason: `Premium ${fmtPct(premium)} signals liq risk.`,
        });
      }

      // 7. ORDER IMB
      if (Math.abs(premium) > 0.005 && vol > 1_000_000) {
        push({
          opportunityType: 'order_imb',
          level: 'medium',
          side: premium > 0 ? 'LONG' : 'SHORT',
          apyEstimate: Math.abs(premium) * 100 * 365 * 2,
          riskScore: 55,
          conviction: 58,
          expectedEdge: `${premium > 0 ? 'Bullish' : 'Bearish'} imbalance`,
          reason: `Mark/index divergence on strong volume.`,
        });
      }

      // 8. VOLATILITY SKEW — mirrors HLOpportunityPanel logic
      // BUG-FIX: this opportunity type existed in HL_OPP_META (WRScanner) but was
      // never pushed here, so SKEW badges never appeared in the scanner table.
      if (Math.abs(fundingRate) > 0.001 && Math.abs(premium) > 0.004) {
        const skew = Math.abs(fundingRate) + Math.abs(premium);
        push({
          opportunityType: 'vol_skew',
          level: 'high',
          side: 'NEUTRAL',
          apyEstimate: skew * 100 * 365,
          riskScore: 65,
          conviction: 60,
          expectedEdge: `Vol Skew ${fmtPct(skew)}`,
          reason: `Funding ${fmtPct(fundingRate)} + Premium ${fmtPct(premium)} = ${fmtPct(skew)} total skew. Options arb possible.`,
        });
      }
    });

    // Best per symbol
    const bySymbol = new Map<string, HLOppSignal>();
    for (const s of opps) {
      const key = String(s.symbol).toUpperCase();
      const cur = bySymbol.get(key);
      if (!cur || s.conviction > cur.conviction) bySymbol.set(key, s);
    }

    return {
      bySymbol,
      all: opps,
      match: (sym) => (sym ? bySymbol.get(sym.toUpperCase()) : undefined),
    };
  }, [markets, enabled, minApy]);
}
