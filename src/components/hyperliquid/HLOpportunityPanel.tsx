/* ══ HYPERLIQUID — High-Edge Perps Opportunities Panel ════════════════════════
 * Dedicated "Opportunities" tab for funding rate, basis, and squeeze
 * strategies. Feeds from useHLMarkets + enhanced scanner signals.
 *
 * Opportunity Types:
 *   FUNDING_ARB   — extreme funding rates → collect daily payments
 *   BASIS_TRADE   — premium + funding divergence → delta-neutral arb
 *   SQUEEZE_LONG  — negative funding + high OI → long squeeze candidate
 *   SQUEEZE_SHORT — positive funding + high OI → short squeeze candidate
 *   WHALE_IMPACT  — low OI + volume spike → whale-driven violent move
 *   LIQ_CLUSTER   — liquidation cluster near price → momentum ignition
 *   ORDER_IMB     — order book imbalance → directional edge
 *   VOL_SKEW      — IV skew divergence → options arb / perps hedge
 *
 * ═══════════════════════════════════════════════════════════════════════════ */

import React, { useMemo, useState, useCallback } from 'react';
import { useHLMarkets } from '@/hooks/useHyperliquid';
import type { HLMarket } from '@/lib/hyperliquid';
import { fmtN } from '@/lib/whaleRadarState';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Zap, TrendingUp, DollarSign, Clock, ExternalLink, Flame,
  BarChart3, Target, ChevronDown, ChevronUp, Filter, Shield,
  ArrowUpRight, ArrowDownRight, AlertTriangle
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

type OpportunityType =
  | 'funding_arb'
  | 'basis_trade'
  | 'squeeze_long'
  | 'squeeze_short'
  | 'whale_impact'
  | 'liq_cluster'
  | 'order_imb'
  | 'vol_skew';

type Level = 'critical' | 'high' | 'medium';

export interface HLSignal {
  symbol: string;
  fundingRate: number;
  premium: number;
  openInterest: number;
  dailyVolume: number;
  markPrice: number;
  indexPrice: number;
  opportunityType: OpportunityType;
  expectedEdge: string;
  apyEstimate: number;
  level: Level;
  reason: string;
  riskScore: number;
  conviction: number;
  entryZone?: { low: number; high: number };
  stopLoss?: number;
  takeProfit?: number;
  timeFrame: string;
  leverageRec: string;
  side: 'LONG' | 'SHORT' | 'NEUTRAL';
}

interface HLOpportunityPanelProps {
  enabled?: boolean;
  collapsed?: boolean;
  minApy?: number;
  maxSignals?: number;
  onSignalClick?: (signal: HLSignal) => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

const FUNDING_THRESHOLD = 0.0008;
const EXTREME_FUNDING = 0.002;
const PREMIUM_THRESHOLD = 0.003;
const BASIS_EDGE_MIN = 0.004;
const SQUEEZE_OI_MIN = 20_000_000;
const WHALE_OI_MAX = 10_000_000;
const WHALE_VOL_RATIO = 0.5;
const LIQ_CLUSTER_PCT = 0.015;

// ── Helper: format percentage ────────────────────────────────────────────────

function fmtPct(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 0.01) return `${(n * 100).toFixed(2)}%`;
  if (abs >= 0.001) return `${(n * 100).toFixed(3)}%`;
  return `${(n * 100).toFixed(4)}%`;
}

// ── Component ───────────────────────────────────────────────────────────────

export const HLOpportunityPanel: React.FC<HLOpportunityPanelProps> = ({
  enabled = true,
  collapsed: initialCollapsed = false,
  minApy = 12,
  maxSignals = 12,
  onSignalClick,
}) => {
  const { markets, summary } = useHLMarkets();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [filterType, setFilterType] = useState<OpportunityType | 'ALL'>('ALL');
  const [sortBy, setSortBy] = useState<'apy' | 'conviction' | 'risk'>('apy');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState<HLSignal | null>(null);

  // ── Core strategy analysis engine ────────────────────────────────────────
  const signals = useMemo<HLSignal[]>(() => {
    if (!markets?.length) return [];

    const opportunities: HLSignal[] = [];

    markets.forEach((m: HLMarket) => {
      const fundingRate = m.fundingRate || 0;
      const premium = m.premium || 0;
      const oi = m.openInterest || 0;
      const vol = m.dayVolume || 0;
      const markPrice = m.markPrice || 0;
      const indexPrice = m.oraclePrice || 0;
      const maxLev = m.maxLeverage || 0;

      // ── 1. FUNDING RATE ARBITRAGE ──────────────────────────────────────
      if (Math.abs(fundingRate) > FUNDING_THRESHOLD) {
        const annualizedApy = Math.abs(fundingRate) * 3 * 365 * 100;
        if (annualizedApy >= minApy) {
          const side = fundingRate > 0 ? 'SHORT' : 'LONG';
          const isExtreme = Math.abs(fundingRate) > EXTREME_FUNDING;
          const riskScore = isExtreme ? 75 : 45;
          const conviction = isExtreme ? 92 : 78;

          opportunities.push({
            symbol: m.symbol,
            fundingRate,
            premium,
            openInterest: oi,
            dailyVolume: vol,
            markPrice,
            indexPrice,
            opportunityType: 'funding_arb',
            expectedEdge: `${side} earns ${fmtPct(Math.abs(fundingRate))}/8h`,
            apyEstimate: annualizedApy,
            level: isExtreme ? 'critical' : 'high',
            reason: `${side} side collects funding. ${isExtreme ? 'EXTREME rate — immediate entry.' : 'Solid carry trade opportunity.'}`,
            riskScore,
            conviction,
            entryZone: { low: markPrice * 0.995, high: markPrice * 1.005 },
            timeFrame: '8h-24h',
            leverageRec: maxLev > 10 ? '3-5x' : '2-3x',
            side,
          });
        }
      }

      // ── 2. BASIS TRADE (Premium + Funding Divergence) ──────────────────
      if (Math.abs(premium) > PREMIUM_THRESHOLD && Math.abs(fundingRate) > FUNDING_THRESHOLD) {
        const basisEdge = Math.abs(premium) - Math.abs(fundingRate) * 3;
        const annualizedEdge = basisEdge * 2 * 365 * 100;
        if (basisEdge > BASIS_EDGE_MIN) {
          const isCritical = basisEdge > 0.01;
          const direction = premium > 0 ? 'Short Perps / Long Spot' : 'Long Perps / Short Spot';

          opportunities.push({
            symbol: m.symbol,
            fundingRate,
            premium,
            openInterest: oi,
            dailyVolume: vol,
            markPrice,
            indexPrice,
            opportunityType: 'basis_trade',
            expectedEdge: `${direction} — ${fmtPct(basisEdge)} edge`,
            apyEstimate: annualizedEdge,
            level: isCritical ? 'critical' : 'high',
            reason: `Premium ${fmtPct(premium)} vs Funding ${fmtPct(fundingRate)}. ${direction} locks ${fmtPct(basisEdge)}.`,
            riskScore: 35,
            conviction: isCritical ? 88 : 72,
            entryZone: { low: indexPrice * 0.998, high: indexPrice * 1.002 },
            timeFrame: '1-3 days',
            leverageRec: '1x (delta-neutral)',
            side: 'NEUTRAL',
          });
        }
      }

      // ── 3. SHORT SQUEEZE CANDIDATE ─────────────────────────────────────
      if (fundingRate < -EXTREME_FUNDING && oi > SQUEEZE_OI_MIN) {
        const squeezePotential = Math.abs(fundingRate) * oi / 1e6;
        opportunities.push({
          symbol: m.symbol,
          fundingRate,
          premium,
          openInterest: oi,
          dailyVolume: vol,
          markPrice,
          indexPrice,
          opportunityType: 'squeeze_short',
          expectedEdge: 'Short Squeeze Candidate',
          apyEstimate: Math.abs(fundingRate) * 3 * 365 * 100,
          level: 'critical',
          reason: `Shorts paying ${fmtPct(Math.abs(fundingRate))}/8h on $${fmtN(oi)} OI. Liquidation cascade possible.`,
          riskScore: 85,
          conviction: Math.min(70 + squeezePotential, 95),
          entryZone: { low: markPrice * 0.99, high: markPrice },
          stopLoss: markPrice * 0.985,
          takeProfit: markPrice * 1.03,
          timeFrame: '4h-24h',
          leverageRec: '2-4x',
          side: 'LONG',
        });
      }

      // ── 4. LONG SQUEEZE CANDIDATE ──────────────────────────────────────
      if (fundingRate > EXTREME_FUNDING && oi > SQUEEZE_OI_MIN) {
        opportunities.push({
          symbol: m.symbol,
          fundingRate,
          premium,
          openInterest: oi,
          dailyVolume: vol,
          markPrice,
          indexPrice,
          opportunityType: 'squeeze_long',
          expectedEdge: 'Long Squeeze Candidate',
          apyEstimate: fundingRate * 3 * 365 * 100,
          level: 'critical',
          reason: `Longs paying ${fmtPct(fundingRate)}/8h on $${fmtN(oi)} OI. Overleveraged longs at risk.`,
          riskScore: 80,
          conviction: 68,
          entryZone: { low: markPrice, high: markPrice * 1.01 },
          stopLoss: markPrice * 1.015,
          takeProfit: markPrice * 0.97,
          timeFrame: '4h-24h',
          leverageRec: '2-4x',
          side: 'SHORT',
        });
      }

      // ── 5. WHALE IMPACT (Low OI + Volume Spike) ────────────────────────
      if (oi > 0 && oi < WHALE_OI_MAX && vol > oi * WHALE_VOL_RATIO) {
        const volRatio = vol / oi;
        opportunities.push({
          symbol: m.symbol,
          fundingRate,
          premium,
          openInterest: oi,
          dailyVolume: vol,
          markPrice,
          indexPrice,
          opportunityType: 'whale_impact',
          expectedEdge: `Volume ${volRatio.toFixed(1)}x OI — Whale Activity`,
          apyEstimate: 0,
          level: 'high',
          reason: `OI $${fmtN(oi)} with $${fmtN(vol)} volume. Whale moves cause ${volRatio > 2 ? 'extreme' : 'significant'} slippage.`,
          riskScore: 70,
          conviction: 55,
          timeFrame: '1h-4h',
          leverageRec: '1-2x',
          side: premium > 0 ? 'LONG' : 'SHORT',
        });
      }

      // ── 6. LIQUIDATION CLUSTER ─────────────────────────────────────────
      if (oi > 5_000_000 && Math.abs(premium) > LIQ_CLUSTER_PCT) {
        const direction = premium > 0 ? 'LONG liqs below' : 'SHORT liqs above';
        opportunities.push({
          symbol: m.symbol,
          fundingRate,
          premium,
          openInterest: oi,
          dailyVolume: vol,
          markPrice,
          indexPrice,
          opportunityType: 'liq_cluster',
          expectedEdge: `Liq Cluster ${direction} $${fmtN(markPrice)}`,
          apyEstimate: Math.abs(premium) * 100 * 365,
          level: 'high',
          reason: `Premium ${fmtPct(premium)} suggests ${direction} market. Liq cascade risk at ${fmtPct(Math.abs(premium))} from index.`,
          riskScore: 78,
          conviction: 62,
          entryZone: { low: markPrice * 0.99, high: markPrice * 1.01 },
          timeFrame: '1h-8h',
          leverageRec: '2-3x',
          side: premium > 0 ? 'SHORT' : 'LONG',
        });
      }

      // ── 7. ORDER BOOK IMBALANCE ────────────────────────────────────────
      if (Math.abs(premium) > 0.005 && vol > 1_000_000) {
        const direction = premium > 0 ? 'BULLISH' : 'BEARISH';
        opportunities.push({
          symbol: m.symbol,
          fundingRate,
          premium,
          openInterest: oi,
          dailyVolume: vol,
          markPrice,
          indexPrice,
          opportunityType: 'order_imb',
          expectedEdge: `${direction} Imbalance ${fmtPct(Math.abs(premium))}`,
          apyEstimate: Math.abs(premium) * 100 * 365 * 2,
          level: 'medium',
          reason: `Mark ${fmtPct(premium)} vs Index. ${direction} pressure detected on $${fmtN(vol)} volume.`,
          riskScore: 55,
          conviction: 58,
          entryZone: { low: Math.min(markPrice, indexPrice), high: Math.max(markPrice, indexPrice) },
          timeFrame: '30m-4h',
          leverageRec: '2-3x',
          side: premium > 0 ? 'LONG' : 'SHORT',
        });
      }

      // ── 8. VOLATILITY SKEW ─────────────────────────────────────────────
      if (Math.abs(fundingRate) > 0.001 && Math.abs(premium) > 0.004) {
        const skew = Math.abs(fundingRate) + Math.abs(premium);
        opportunities.push({
          symbol: m.symbol,
          fundingRate,
          premium,
          openInterest: oi,
          dailyVolume: vol,
          markPrice,
          indexPrice,
          opportunityType: 'vol_skew',
          expectedEdge: `Vol Skew ${fmtPct(skew)}`,
          apyEstimate: skew * 100 * 365,
          level: 'high',
          reason: `Funding ${fmtPct(fundingRate)} + Premium ${fmtPct(premium)} = ${fmtPct(skew)} total skew. Options arb possible.`,
          riskScore: 65,
          conviction: 60,
          timeFrame: '4h-12h',
          leverageRec: '1-2x',
          side: 'NEUTRAL',
        });
      }
    });

    // Deduplicate by symbol+type, keep highest conviction
    const deduped = new Map<string, HLSignal>();
    opportunities.forEach((sig) => {
      const key = `${sig.symbol}-${sig.opportunityType}`;
      const existing = deduped.get(key);
      if (!existing || sig.conviction > existing.conviction) {
        deduped.set(key, sig);
      }
    });

    let result = Array.from(deduped.values());

    // Apply type filter
    if (filterType !== 'ALL') {
      result = result.filter((s) => s.opportunityType === filterType);
    }

    // Sort
    result.sort((a, b) => {
      if (sortBy === 'apy') return (b.apyEstimate || 0) - (a.apyEstimate || 0);
      if (sortBy === 'conviction') return b.conviction - a.conviction;
      return b.riskScore - a.riskScore;
    });

    return result.slice(0, maxSignals);
  }, [markets, minApy, maxSignals, filterType, sortBy]);

  // Must run before the `enabled` early return below — Rules of Hooks
  // requires every hook to run on every render, and this one previously
  // sat after that guard, so it was skipped whenever enabled=false while
  // still being called on other renders.
  const handleTradeClick = useCallback((symbol: string) => {
    window.open(`https://app.hyperliquid.xyz/trade/${symbol}`, '_blank', 'noopener,noreferrer');
  }, []);

  if (!enabled) return null;

  // ── Type config ──────────────────────────────────────────────────────────
  const typeConfig: Record<OpportunityType, {
    icon: React.ElementType;
    label: string;
    color: string;
    bg: string;
    border: string;
    desc: string;
  }> = {
    funding_arb: {
      icon: DollarSign,
      label: 'FUNDING',
      color: 'text-emerald-400',
      bg: 'bg-emerald-400/10',
      border: 'border-emerald-400/30',
      desc: 'Collect funding payments by going against the crowd'
    },
    basis_trade: {
      icon: TrendingUp,
      label: 'BASIS',
      color: 'text-blue-400',
      bg: 'bg-blue-400/10',
      border: 'border-blue-400/30',
      desc: 'Delta-neutral arb: buy spot, short perps when premium > funding'
    },
    squeeze_long: {
      icon: Zap,
      label: 'LONG SQUEEZE',
      color: 'text-amber-400',
      bg: 'bg-amber-400/10',
      border: 'border-amber-400/30',
      desc: 'Overleveraged longs paying heavy funding — short squeeze incoming'
    },
    squeeze_short: {
      icon: Flame,
      label: 'SHORT SQUEEZE',
      color: 'text-red-400',
      bg: 'bg-red-400/10',
      border: 'border-red-400/30',
      desc: 'Shorts bleeding funding on high OI — liquidation cascade risk'
    },
    whale_impact: {
      icon: ExternalLink,
      label: 'WHALE',
      color: 'text-purple-400',
      bg: 'bg-purple-400/10',
      border: 'border-purple-400/30',
      desc: 'Illiquid market + whale volume = outsized price moves'
    },
    liq_cluster: {
      icon: Target,
      label: 'LIQ CLUSTER',
      color: 'text-rose-400',
      bg: 'bg-rose-400/10',
      border: 'border-rose-400/30',
      desc: 'Price near known liquidation zones — momentum ignition when cluster breaks'
    },
    order_imb: {
      icon: BarChart3,
      label: 'ORDER IMB',
      color: 'text-cyan-400',
      bg: 'bg-cyan-400/10',
      border: 'border-cyan-400/30',
      desc: 'Order book imbalance detected via premium/mark divergence'
    },
    vol_skew: {
      icon: AlertTriangle,
      label: 'VOL SKEW',
      color: 'text-orange-400',
      bg: 'bg-orange-400/10',
      border: 'border-orange-400/30',
      desc: 'Extreme funding + premium divergence = volatility skew opportunity'
    },
  };

  const levelBadge: Record<Level, string> = {
    critical: 'bg-red-500/20 text-red-400 border-red-500/40',
    high: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
    medium: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40',
  };

  const sideIcon = (side: string) => {
    if (side === 'LONG') return <ArrowUpRight className="w-3 h-3 text-emerald-400" />;
    if (side === 'SHORT') return <ArrowDownRight className="w-3 h-3 text-red-400" />;
    return <Shield className="w-3 h-3 text-blue-400" />;
  };

  const totalOI = summary?.totalOI ?? 0;
  const totalVol = summary?.totalVolume24h ?? 0;

  return (
    <div className="flex flex-col h-full border border-wr-border bg-wr-bg2 rounded-sm">
      {/* Header */}
      <div className="wr-panel-header flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-wr-amber" />
          <span className="wr-panel-title text-[11px] font-bold tracking-wide">
            HIGH-EDGE PERPS OPPORTUNITIES
          </span>
          <Badge className="bg-wr-amber/20 text-wr-amber border-wr-amber/40 text-[9px] font-mono">
            {signals.length} ACTIVE
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="p-1 rounded hover:bg-wr-bg3 transition-colors"
            title="Toggle filters"
          >
            <Filter className="w-3 h-3 text-wr-muted" />
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 rounded hover:bg-wr-bg3 transition-colors"
          >
            {collapsed ? <ChevronDown className="w-3 h-3 text-wr-muted" /> : <ChevronUp className="w-3 h-3 text-wr-muted" />}
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {!collapsed && (
        <div className="flex items-center justify-between px-3 py-1 border-b border-wr-border/40 text-[9px] text-wr-muted font-mono">
          <div className="flex items-center gap-3">
            <span>24H VOL: <span className="text-wr-white">${fmtN(totalVol)}</span></span>
            <span>TOTAL OI: <span className="text-wr-white">${fmtN(totalOI)}</span></span>
            <span>MARKETS: <span className="text-wr-white">{summary?.marketCount ?? 0}</span></span>
          </div>
          <div className="flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            <span>{new Date().toLocaleTimeString()}</span>
          </div>
        </div>
      )}

      {/* Filters */}
      {showFilters && !collapsed && (
        <div className="px-3 py-2 border-b border-wr-border/40 bg-wr-bg3/30">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] text-wr-muted uppercase tracking-wider">Filter:</span>
            {(['ALL', 'funding_arb', 'basis_trade', 'squeeze_short', 'squeeze_long', 'whale_impact', 'liq_cluster', 'order_imb', 'vol_skew'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setFilterType(t)}
                className={`px-2 py-0.5 rounded text-[9px] font-mono transition-colors ${
                  filterType === t
                    ? 'bg-wr-amber/20 text-wr-amber border border-wr-amber/40'
                    : 'bg-wr-bg3 text-wr-muted border border-wr-border/40 hover:text-wr-white'
                }`}
              >
                {t === 'ALL' ? 'ALL' : typeConfig[t]?.label ?? t}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[9px] text-wr-muted uppercase tracking-wider">Sort:</span>
            {(['apy', 'conviction', 'risk'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={`px-2 py-0.5 rounded text-[9px] font-mono transition-colors ${
                  sortBy === s
                    ? 'bg-wr-cyan/20 text-wr-cyan border border-wr-cyan/40'
                    : 'bg-wr-bg3 text-wr-muted border border-wr-border/40 hover:text-wr-white'
                }`}
              >
                {s.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Signal List */}
      {!collapsed && (
        <div className="flex-1 overflow-auto scrollbar-thin">
          {signals.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-wr-muted">
              <Target className="w-6 h-6 mb-2 opacity-30" />
              <span className="text-[10px]">No high-edge opportunities detected...</span>
              <span className="text-[9px] opacity-50 mt-1">Markets are calm. Patience pays.</span>
            </div>
          ) : (
            signals.map((sig, idx) => {
              const config = typeConfig[sig.opportunityType];
              const Icon = config.icon;
              const isCritical = sig.level === 'critical';
              return (
                <TooltipProvider key={`${sig.symbol}-${idx}`} delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className={`flex items-center justify-between px-3 py-2.5 border-b border-wr-border/30 hover:bg-wr-bg3/60 cursor-pointer transition-all ${
                          isCritical ? 'bg-red-500/5' : ''
                        }`}
                        onClick={() => {
                          setSelectedSignal(sig);
                          onSignalClick?.(sig);
                          handleTradeClick(sig.symbol);
                        }}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`p-1.5 rounded shrink-0 ${isCritical ? 'bg-red-500/15' : config.bg}`}>
                            <Icon className={`w-3.5 h-3.5 ${config.color}`} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-bold text-wr-white truncate">{sig.symbol}</span>
                              <Badge className={`text-[8px] ${config.color} bg-transparent border-current/30 px-1 py-0`}>
                                {config.label}
                              </Badge>
                              <Badge className={`text-[8px] ${levelBadge[sig.level]} px-1 py-0`}>
                                {sig.level.toUpperCase()}
                              </Badge>
                              {sideIcon(sig.side)}
                            </div>
                            <div className="text-[9px] text-wr-muted mt-0.5 truncate">{sig.reason}</div>
                            {sig.entryZone && (
                              <div className="text-[8px] text-wr-muted/70 mt-0.5 font-mono">
                                Entry: ${sig.entryZone.low.toFixed(sig.markPrice > 100 ? 2 : 4)} - ${sig.entryZone.high.toFixed(sig.markPrice > 100 ? 2 : 4)}
                                {sig.stopLoss && <span className="text-red-400/70 ml-2">SL: ${sig.stopLoss.toFixed(sig.markPrice > 100 ? 2 : 4)}</span>}
                                {sig.takeProfit && <span className="text-emerald-400/70 ml-2">TP: ${sig.takeProfit.toFixed(sig.markPrice > 100 ? 2 : 4)}</span>}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0 ml-2">
                          <div className={`text-[10px] font-bold ${sig.apyEstimate > 50 ? 'text-emerald-400' : sig.apyEstimate > 20 ? 'text-amber-400' : 'text-wr-muted'}`}>
                            {sig.apyEstimate > 0 ? `~${sig.apyEstimate.toFixed(0)}% APY` : sig.expectedEdge}
                          </div>
                          <div className="flex items-center justify-end gap-2 text-[8px] text-wr-muted mt-0.5 font-mono">
                            <span>OI: {fmtN(sig.openInterest)}</span>
                            <span>|</span>
                            <span>Vol: {fmtN(sig.dailyVolume)}</span>
                          </div>
                          <div className="flex items-center justify-end gap-2 text-[8px] mt-0.5 font-mono">
                            <span className="text-wr-muted">Conv: <span className="text-wr-white">{sig.conviction}%</span></span>
                            <span className="text-wr-muted">Risk: <span className={sig.riskScore > 70 ? 'text-red-400' : sig.riskScore > 50 ? 'text-amber-400' : 'text-emerald-400'}>{sig.riskScore}</span></span>
                            {sig.leverageRec && <span className="text-wr-muted">Lev: <span className="text-wr-cyan">{sig.leverageRec}</span></span>}
                          </div>
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="bg-wr-bg2 border-wr-border text-wr-white max-w-xs p-3">
                      <div className="text-[10px] space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Icon className={`w-4 h-4 ${config.color}`} />
                          <p className="font-bold text-[11px]">{sig.symbol} — {config.label}</p>
                        </div>
                        <p className="text-wr-muted text-[9px]">{config.desc}</p>
                        <div className="border-t border-wr-border/40 pt-1.5 space-y-1">
                          <p>Funding: <span className="font-mono">{fmtPct(sig.fundingRate)}</span> (8h)</p>
                          <p>Premium: <span className="font-mono">{fmtPct(sig.premium)}</span></p>
                          <p>Mark: <span className="font-mono">${sig.markPrice.toFixed(sig.markPrice > 100 ? 2 : 4)}</span></p>
                          <p>Index: <span className="font-mono">${sig.indexPrice.toFixed(sig.indexPrice > 100 ? 2 : 4)}</span></p>
                          <p>OI: <span className="font-mono">${fmtN(sig.openInterest)}</span></p>
                          <p>24H Vol: <span className="font-mono">${fmtN(sig.dailyVolume)}</span></p>
                        </div>
                        <div className="border-t border-wr-border/40 pt-1.5">
                          <p className="text-wr-amber font-semibold">{sig.expectedEdge}</p>
                          <p className="text-wr-muted">{sig.reason}</p>
                        </div>
                        {sig.entryZone && (
                          <div className="border-t border-wr-border/40 pt-1.5 font-mono">
                            <p>Entry: ${sig.entryZone.low.toFixed(4)} - ${sig.entryZone.high.toFixed(4)}</p>
                            {sig.stopLoss && <p className="text-red-400">Stop: ${sig.stopLoss.toFixed(4)}</p>}
                            {sig.takeProfit && <p className="text-emerald-400">Target: ${sig.takeProfit.toFixed(4)}</p>}
                          </div>
                        )}
                        <div className="border-t border-wr-border/40 pt-1.5 flex items-center justify-between">
                          <span className="text-wr-muted">Conviction: {sig.conviction}%</span>
                          <span className="text-wr-muted">Risk: {sig.riskScore}/100</span>
                        </div>
                        <p className="text-wr-muted text-[8px] pt-1">Click to open Hyperliquid trade page</p>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            })
          )}
        </div>
      )}

      {/* Footer */}
      {!collapsed && (
        <div className="border-t border-wr-border px-3 py-1.5 text-[8px] text-wr-muted flex justify-between font-mono">
          <span>Sorted by {sortBy} | Min APY: {minApy}%</span>
          <span>Last scan: {new Date().toLocaleTimeString()}</span>
        </div>
      )}
    </div>
  );
};

export default HLOpportunityPanel;
