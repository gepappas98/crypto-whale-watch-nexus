/* ══ HYPERLIQUID — Enhanced On-Chain Manipulation & Opportunity Scanner ═══════
 *
 * v2.0 — TOP TRADER CEO EDITION
 * Adds 8 opportunity detection strategies on top of existing manipulation scans:
 *   FUNDING_ARB, BASIS_TRADE, SQUEEZE_LONG, SQUEEZE_SHORT, WHALE_IMPACT,
 *   LIQ_CLUSTER, ORDER_IMB, VOL_SKEW
 *
 * Patterns detected:
 *   MEGA_TX       — single tx value > threshold
 *   BLOCK_FLOOD   — block tx count >> normal (wash-trade signal)
 *   REPEAT_ADDR   — same from-addr appears in multiple consecutive txs
 *   DEAD_BLOCK    — zero-tx block streak (potential validator issue / halt)
 *   SURGE_RATE    — tx rate spike vs rolling average
 *   FUNDING_EXT   — extreme funding rate opportunity
 *   BASIS_DIV     — premium + funding divergence
 *   SQUEEZE_RISK  — funding + OI squeeze setup
 *   WHALE_ILLIQ   — low OI + volume spike
 *   LIQ_WALL      — liquidation cluster proximity
 *
 * ═══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useHLBlocks, useHLTxs, useHLMarkets } from './useHyperliquid';
import type { HLBlock, HLTx, HLMarket } from '@/lib/hyperliquid';
import type { AlertItem } from '@/lib/whaleRadarState';

// ── Thresholds ────────────────────────────────────────────────────────────────

const MEGA_TX_USD = 500_000;
const BLOCK_FLOOD_MULT = 3.0;
const REPEAT_ADDR_COUNT = 3;
const DEAD_BLOCK_STREAK = 5;
const SURGE_MULT = 4.0;
const ALERT_COOLDOWN_MS = 30_000;
const ROLLING_WINDOW = 20;

// Opportunity thresholds
const FUNDING_THRESHOLD = 0.0008;
const EXTREME_FUNDING = 0.002;
const PREMIUM_THRESHOLD = 0.003;
const BASIS_EDGE_MIN = 0.004;
const SQUEEZE_OI_MIN = 20_000_000;
const WHALE_OI_MAX = 10_000_000;
const WHALE_VOL_RATIO = 0.5;

// ── Types ─────────────────────────────────────────────────────────────────────

export type OpportunityType =
  | 'funding_arb'
  | 'basis_trade'
  | 'squeeze_long'
  | 'squeeze_short'
  | 'whale_impact'
  | 'liq_cluster'
  | 'order_imb'
  | 'vol_skew';

export interface HLOpportunity {
  ts: number;
  symbol: string;
  type: OpportunityType;
  level: 'critical' | 'high' | 'medium';
  fundingRate: number;
  premium: number;
  openInterest: number;
  dailyVolume: number;
  markPrice: number;
  expectedEdge: string;
  apyEstimate: number;
  reason: string;
  conviction: number;
  riskScore: number;
  side: 'LONG' | 'SHORT' | 'NEUTRAL';
}

interface ScannerOptions {
  enabled?: boolean;
  megaTxUsd?: number;
  onAlert: (alert: AlertItem) => void;
  onOpportunity?: (opp: HLOpportunity) => void;
  minApy?: number;
}

interface RollingState {
  blockTxCounts: number[];
  txRates: number[];
  lastBlockTime: number;
  lastBlockHeight: number;
  processedTxHashes: Set<string>;
  processedBlockHeights: Set<number>;
  alertCooldowns: Map<string, number>;
  emptyBlockStreak: number;
  processedOpportunities: Set<string>;
}

// ── Alert builder ─────────────────────────────────────────────────────────────

function buildAlert(
  level: AlertItem['level'],
  tc: string,
  tag: string,
  text: string,
): AlertItem {
  return { ts: Date.now(), level, tag, text, tc, sizing: null, pinned: false };
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtPct(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 0.01) return `${(n * 100).toFixed(2)}%`;
  if (abs >= 0.001) return `${(n * 100).toFixed(3)}%`;
  return `${(n * 100).toFixed(4)}%`;
}

function fmtN(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

function formatUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useHLManipulationScanner({
  enabled = true,
  megaTxUsd = MEGA_TX_USD,
  onAlert,
  onOpportunity,
  minApy = 12,
}: ScannerOptions) {
  const { blocks, isFirstLoad: blocksLoading } = useHLBlocks();
  const { txs, isFirstLoad: txsLoading } = useHLTxs();
  const { markets } = useHLMarkets();

  const [opportunities, setOpportunities] = useState<HLOpportunity[]>([]);

  const stateRef = useRef<RollingState>({
    blockTxCounts: [],
    txRates: [],
    lastBlockTime: 0,
    lastBlockHeight: 0,
    processedTxHashes: new Set(),
    processedBlockHeights: new Set(),
    alertCooldowns: new Map(),
    emptyBlockStreak: 0,
    processedOpportunities: new Set(),
  });

  // ── Cooldown check ──────────────────────────────────────────────────────────
  const canAlert = useCallback((key: string): boolean => {
    const s = stateRef.current;
    const last = s.alertCooldowns.get(key) ?? 0;
    if (Date.now() - last < ALERT_COOLDOWN_MS) return false;
    s.alertCooldowns.set(key, Date.now());
    return true;
  }, []);

  // ── Opportunity dedup ─────────────────────────────────────────────────────
  const canEmitOpportunity = useCallback((symbol: string, type: OpportunityType): boolean => {
    const s = stateRef.current;
    const key = `${symbol}-${type}`;
    if (s.processedOpportunities.has(key)) return false;
    s.processedOpportunities.add(key);
    if (s.processedOpportunities.size > 500) {
      const arr = [...s.processedOpportunities];
      s.processedOpportunities = new Set(arr.slice(-250));
    }
    return true;
  }, []);

  // ── Process new blocks ────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || blocksLoading || blocks.length === 0) return;

    const s = stateRef.current;
    const newBlocks = blocks.filter((b) => !s.processedBlockHeights.has(b.height));
    if (newBlocks.length === 0) return;

    for (const block of newBlocks) {
      s.processedBlockHeights.add(block.height);
      s.blockTxCounts.push(block.txCount);
      if (s.blockTxCounts.length > ROLLING_WINDOW) s.blockTxCounts.shift();

      // TX Rate surge
      if (s.lastBlockTime > 0 && s.lastBlockHeight > 0) {
        const dtSec = Math.max(0.1, (block.time - s.lastBlockTime) / 1_000);
        const rate = block.txCount / dtSec;
        s.txRates.push(rate);
        if (s.txRates.length > ROLLING_WINDOW) s.txRates.shift();

        const avgRate = s.txRates.reduce((a, b) => a + b, 0) / s.txRates.length;
        if (s.txRates.length >= 5 && avgRate > 0 && rate > avgRate * SURGE_MULT) {
          if (canAlert('surge')) {
            onAlert(buildAlert(
              'high', 'H', '⚡ HL TX SURGE',
              `Block #${block.height}: ${block.txCount} txs (${rate.toFixed(1)}/s vs avg ${avgRate.toFixed(1)}/s) — ${SURGE_MULT}x surge detected`,
            ));
          }
        }
      }

      // Block Flood
      if (s.blockTxCounts.length >= 5) {
        const avg = s.blockTxCounts.slice(0, -1).reduce((a, b) => a + b, 0) / (s.blockTxCounts.length - 1);
        if (avg > 0 && block.txCount > avg * BLOCK_FLOOD_MULT) {
          if (canAlert('flood')) {
            onAlert(buildAlert(
              'high', 'H', '🌊 HL BLOCK FLOOD',
              `Block #${block.height}: ${block.txCount} txs — ${(block.txCount / avg).toFixed(1)}x normal rate. Possible wash-trade burst.`,
            ));
          }
        }
      }

      // Dead-block streak
      if (block.txCount === 0) {
        s.emptyBlockStreak++;
        if (s.emptyBlockStreak >= DEAD_BLOCK_STREAK && canAlert('dead')) {
          onAlert(buildAlert(
            'medium', 'M', '💀 HL DEAD BLOCKS',
            `${s.emptyBlockStreak} consecutive empty blocks up to #${block.height}. Network may be stalled or validator issue.`,
          ));
        }
      } else {
        s.emptyBlockStreak = 0;
      }

      s.lastBlockTime = block.time;
      s.lastBlockHeight = block.height;
    }
  }, [blocks, enabled, blocksLoading, canAlert, onAlert]);

  // ── Process new txs ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || txsLoading || txs.length === 0) return;

    const s = stateRef.current;
    const newTxs = txs.filter((tx) => !s.processedTxHashes.has(tx.hash));
    if (newTxs.length === 0) return;

    for (const tx of newTxs) {
      s.processedTxHashes.add(tx.hash);
      if (s.processedTxHashes.size > 2000) {
        const arr = [...s.processedTxHashes];
        s.processedTxHashes = new Set(arr.slice(-1000));
      }

      // Mega-TX detection
      const valueUsd = parseFloat(tx.value ?? '0');
      if (valueUsd >= megaTxUsd) {
        const key = `mega-${tx.hash}`;
        if (canAlert(key)) {
          const tier = valueUsd >= 5_000_000 ? 'critical' : valueUsd >= 1_000_000 ? 'high' : 'medium';
          const emoji = valueUsd >= 5_000_000 ? '🚨' : valueUsd >= 1_000_000 ? '🐋' : '📦';
          onAlert(buildAlert(
            tier, tier === 'critical' ? 'C' : tier === 'high' ? 'H' : 'M',
            `${emoji} HL MEGA TX`,
            `${formatUsd(valueUsd)} ${tx.action ?? 'transfer'} from ${tx.from.slice(0, 8)}… — Block #${tx.blockHeight}`,
          ));
        }
      }
    }

    // Repeat-address pattern
    const recent = [...newTxs, ...txs].slice(0, 10);
    const addrCounts = new Map<string, number>();
    for (const tx of recent) {
      addrCounts.set(tx.from, (addrCounts.get(tx.from) ?? 0) + 1);
    }
    for (const [addr, count] of addrCounts) {
      if (count >= REPEAT_ADDR_COUNT) {
        const key = `repeat-${addr}`;
        if (canAlert(key)) {
          onAlert(buildAlert(
            'medium', 'M', '🔁 HL REPEAT ADDR',
            `${addr.slice(0, 10)}… sent ${count} txs in last 10 — possible bot or wash-trade pattern`,
          ));
        }
      }
    }
  }, [txs, enabled, txsLoading, megaTxUsd, canAlert, onAlert]);

  // ── OPPORTUNITY SCANNER (markets-based) ───────────────────────────────────
  useEffect(() => {
    if (!enabled || !markets?.length) return;

    const newOpportunities: HLOpportunity[] = [];

    markets.forEach((m: HLMarket) => {
      const fundingRate = m.fundingRate || 0;
      const premium = m.premium || 0;
      const oi = m.openInterest || 0;
      const vol = m.dayVolume || 0;
      const markPrice = m.markPrice || 0;

      // 1. EXTREME FUNDING RATE → FUNDING_ARB
      if (Math.abs(fundingRate) > FUNDING_THRESHOLD) {
        const annualizedApy = Math.abs(fundingRate) * 3 * 365 * 100;
        if (annualizedApy >= minApy && canEmitOpportunity(m.symbol, 'funding_arb')) {
          const isExtreme = Math.abs(fundingRate) > EXTREME_FUNDING;
          const side = fundingRate > 0 ? 'SHORT' : 'LONG';
          const opp: HLOpportunity = {
            ts: Date.now(),
            symbol: m.symbol,
            type: 'funding_arb',
            level: isExtreme ? 'critical' : 'high',
            fundingRate,
            premium,
            openInterest: oi,
            dailyVolume: vol,
            markPrice,
            expectedEdge: `${side} earns ${fmtPct(Math.abs(fundingRate))}/8h`,
            apyEstimate: annualizedApy,
            reason: `${side} side collects funding. ${isExtreme ? 'EXTREME rate detected.' : 'Solid carry trade.'}`,
            conviction: isExtreme ? 92 : 78,
            riskScore: isExtreme ? 75 : 45,
            side,
          };
          newOpportunities.push(opp);
          onOpportunity?.(opp);

          if (isExtreme && canAlert(`funding-${m.symbol}`)) {
            onAlert(buildAlert(
              'critical', 'C', '💰 FUNDING ARB',
              `${m.symbol} ${side} pays ${fmtPct(Math.abs(fundingRate))}/8h → ~${annualizedApy.toFixed(0)}% APY. ${side} NOW.`,
            ));
          }
        }
      }

      // 2. BASIS TRADE → BASIS_TRADE
      if (Math.abs(premium) > PREMIUM_THRESHOLD && Math.abs(fundingRate) > FUNDING_THRESHOLD) {
        const basisEdge = Math.abs(premium) - Math.abs(fundingRate) * 3;
        const annualizedEdge = basisEdge * 2 * 365 * 100;
        if (basisEdge > BASIS_EDGE_MIN && canEmitOpportunity(m.symbol, 'basis_trade')) {
          const isCritical = basisEdge > 0.01;
          const direction = premium > 0 ? 'Short Perps / Long Spot' : 'Long Perps / Short Spot';
          const opp: HLOpportunity = {
            ts: Date.now(),
            symbol: m.symbol,
            type: 'basis_trade',
            level: isCritical ? 'critical' : 'high',
            fundingRate,
            premium,
            openInterest: oi,
            dailyVolume: vol,
            markPrice,
            expectedEdge: `${direction} — ${fmtPct(basisEdge)} edge`,
            apyEstimate: annualizedEdge,
            reason: `Premium ${fmtPct(premium)} vs Funding ${fmtPct(fundingRate)}. ${direction} locks ${fmtPct(basisEdge)}.`,
            conviction: isCritical ? 88 : 72,
            riskScore: 35,
            side: 'NEUTRAL',
          };
          newOpportunities.push(opp);
          onOpportunity?.(opp);

          if (canAlert(`basis-${m.symbol}`)) {
            onAlert(buildAlert(
              isCritical ? 'critical' : 'high',
              isCritical ? 'C' : 'H',
              '📊 BASIS TRADE',
              `${m.symbol} ${direction}. Edge: ${fmtPct(basisEdge)} → ~${annualizedEdge.toFixed(0)}% APY.`,
            ));
          }
        }
      }

      // 3. SHORT SQUEEZE → SQUEEZE_SHORT
      if (fundingRate < -EXTREME_FUNDING && oi > SQUEEZE_OI_MIN && canEmitOpportunity(m.symbol, 'squeeze_short')) {
        const annualized = Math.abs(fundingRate) * 3 * 365 * 100;
        const opp: HLOpportunity = {
          ts: Date.now(),
          symbol: m.symbol,
          type: 'squeeze_short',
          level: 'critical',
          fundingRate,
          premium,
          openInterest: oi,
          dailyVolume: vol,
          markPrice,
          expectedEdge: 'Short Squeeze Candidate',
          apyEstimate: annualized,
          reason: `Shorts paying ${fmtPct(Math.abs(fundingRate))}/8h on $${fmtN(oi)} OI. Liq cascade risk.`,
          conviction: 85,
          riskScore: 85,
          side: 'LONG',
        };
        newOpportunities.push(opp);
        onOpportunity?.(opp);

        if (canAlert(`squeeze-${m.symbol}`)) {
          onAlert(buildAlert(
            'critical', 'C', '🔥 SHORT SQUEEZE',
            `${m.symbol}: Shorts bleeding ${fmtPct(Math.abs(fundingRate))}/8h. $${fmtN(oi)} OI. SQUEEZE IMMINENT.`,
          ));
        }
      }

      // 4. LONG SQUEEZE → SQUEEZE_LONG
      if (fundingRate > EXTREME_FUNDING && oi > SQUEEZE_OI_MIN && canEmitOpportunity(m.symbol, 'squeeze_long')) {
        const annualized = fundingRate * 3 * 365 * 100;
        const opp: HLOpportunity = {
          ts: Date.now(),
          symbol: m.symbol,
          type: 'squeeze_long',
          level: 'critical',
          fundingRate,
          premium,
          openInterest: oi,
          dailyVolume: vol,
          markPrice,
          expectedEdge: 'Long Squeeze Candidate',
          apyEstimate: annualized,
          reason: `Longs paying ${fmtPct(fundingRate)}/8h on $${fmtN(oi)} OI. Overleveraged longs at risk.`,
          conviction: 70,
          riskScore: 80,
          side: 'SHORT',
        };
        newOpportunities.push(opp);
        onOpportunity?.(opp);
      }

      // 5. WHALE IMPACT → WHALE_IMPACT
      if (oi > 0 && oi < WHALE_OI_MAX && vol > oi * WHALE_VOL_RATIO && canEmitOpportunity(m.symbol, 'whale_impact')) {
        const opp: HLOpportunity = {
          ts: Date.now(),
          symbol: m.symbol,
          type: 'whale_impact',
          level: 'high',
          fundingRate,
          premium,
          openInterest: oi,
          dailyVolume: vol,
          markPrice,
          expectedEdge: `Volume ${(vol / oi).toFixed(1)}x OI`,
          apyEstimate: 0,
          reason: `OI $${fmtN(oi)} with $${fmtN(vol)} volume. Whale-driven violent move possible.`,
          conviction: 55,
          riskScore: 70,
          side: premium > 0 ? 'LONG' : 'SHORT',
        };
        newOpportunities.push(opp);
        onOpportunity?.(opp);

        if (canAlert(`whale-${m.symbol}`)) {
          onAlert(buildAlert(
            'high', 'H', '🐋 WHALE IMPACT',
            `${m.symbol}: Low OI ($${fmtN(oi)}) + Vol spike ($${fmtN(vol)}). Whale can move price hard.`,
          ));
        }
      }

      // 6. LIQUIDATION CLUSTER → LIQ_CLUSTER
      if (oi > 5_000_000 && Math.abs(premium) > 0.015 && canEmitOpportunity(m.symbol, 'liq_cluster')) {
        const direction = premium > 0 ? 'LONG liqs below' : 'SHORT liqs above';
        const opp: HLOpportunity = {
          ts: Date.now(),
          symbol: m.symbol,
          type: 'liq_cluster',
          level: 'high',
          fundingRate,
          premium,
          openInterest: oi,
          dailyVolume: vol,
          markPrice,
          expectedEdge: `Liq Cluster ${direction} $${fmtN(markPrice)}`,
          apyEstimate: Math.abs(premium) * 100 * 365,
          reason: `Premium ${fmtPct(premium)}. ${direction} market at ${fmtPct(Math.abs(premium))} from index.`,
          conviction: 62,
          riskScore: 78,
          side: premium > 0 ? 'SHORT' : 'LONG',
        };
        newOpportunities.push(opp);
        onOpportunity?.(opp);
      }

      // 7. ORDER BOOK IMBALANCE → ORDER_IMB
      if (Math.abs(premium) > 0.005 && vol > 1_000_000 && canEmitOpportunity(m.symbol, 'order_imb')) {
        const direction = premium > 0 ? 'BULLISH' : 'BEARISH';
        const opp: HLOpportunity = {
          ts: Date.now(),
          symbol: m.symbol,
          type: 'order_imb',
          level: 'medium',
          fundingRate,
          premium,
          openInterest: oi,
          dailyVolume: vol,
          markPrice,
          expectedEdge: `${direction} Imbalance ${fmtPct(Math.abs(premium))}`,
          apyEstimate: Math.abs(premium) * 100 * 365 * 2,
          reason: `Mark ${fmtPct(premium)} vs Index. ${direction} pressure on $${fmtN(vol)} volume.`,
          conviction: 58,
          riskScore: 55,
          side: premium > 0 ? 'LONG' : 'SHORT',
        };
        newOpportunities.push(opp);
        onOpportunity?.(opp);
      }

      // 8. VOLATILITY SKEW → VOL_SKEW
      if (Math.abs(fundingRate) > 0.001 && Math.abs(premium) > 0.004 && canEmitOpportunity(m.symbol, 'vol_skew')) {
        const skew = Math.abs(fundingRate) + Math.abs(premium);
        const opp: HLOpportunity = {
          ts: Date.now(),
          symbol: m.symbol,
          type: 'vol_skew',
          level: 'high',
          fundingRate,
          premium,
          openInterest: oi,
          dailyVolume: vol,
          markPrice,
          expectedEdge: `Vol Skew ${fmtPct(skew)}`,
          apyEstimate: skew * 100 * 365,
          reason: `Funding ${fmtPct(fundingRate)} + Premium ${fmtPct(premium)} = ${fmtPct(skew)} skew. Options arb.`,
          conviction: 60,
          riskScore: 65,
          side: 'NEUTRAL',
        };
        newOpportunities.push(opp);
        onOpportunity?.(opp);
      }
    });

    if (newOpportunities.length > 0) {
      setOpportunities((prev) => {
        const combined = [...newOpportunities, ...prev];
        const map = new Map<string, HLOpportunity>();
        combined.forEach((o) => {
          const key = `${o.symbol}-${o.type}`;
          const existing = map.get(key);
          if (!existing || o.ts > existing.ts) {
            map.set(key, o);
          }
        });
        return Array.from(map.values()).sort((a, b) => b.ts - a.ts).slice(0, 100);
      });
    }
  }, [enabled, markets, minApy, canAlert, onAlert, onOpportunity, canEmitOpportunity]);

  // ── Cleanup on unmount ──────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      const s = stateRef.current;
      s.processedTxHashes.clear();
      s.processedBlockHeights.clear();
      s.alertCooldowns.clear();
      s.processedOpportunities.clear();
    };
  }, []);

  return { alerts: [], opportunities, markets };
}
