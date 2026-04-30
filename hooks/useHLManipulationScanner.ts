/* ══ HYPERLIQUID — On-Chain Manipulation Scanner ══════════════════════════════
 *  Analyses cached HL blocks + txs to surface whale manipulation signals.
 *  Feeds alerts into the existing AlertItem system via onAlert callback.
 *
 *  Patterns detected:
 *    MEGA_TX      — single tx value > threshold
 *    BLOCK_FLOOD  — block tx count >> normal (wash-trade signal)
 *    REPEAT_ADDR  — same from-addr appears in multiple consecutive txs
 *    DEAD_BLOCK   — zero-tx block streak (potential validator issue / halt)
 *    SURGE_RATE   — tx rate spike vs rolling average
 * ═══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useCallback } from 'react';
import { useHLBlocks, useHLTxs } from './useHyperliquid';
import type { HLBlock, HLTx } from '@/lib/hyperliquid';
import type { AlertItem } from '@/lib/whaleRadarState';

// ── Thresholds ────────────────────────────────────────────────────────────────

const MEGA_TX_USD       = 500_000;   // $500k single-tx threshold
const BLOCK_FLOOD_MULT  = 3.0;       // block txCount > 3× rolling avg → flood
const REPEAT_ADDR_COUNT = 3;         // same addr in ≥3 of last 10 txs → suspect
const DEAD_BLOCK_STREAK = 5;         // ≥5 consecutive empty blocks → alert
const SURGE_MULT        = 4.0;       // tx rate > 4× rolling avg → surge
const ALERT_COOLDOWN_MS = 30_000;    // deduplicate same alert within 30s
const ROLLING_WINDOW    = 20;        // blocks to compute rolling avg

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScannerOptions {
  enabled?: boolean;
  megaTxUsd?: number;
  onAlert: (alert: AlertItem) => void;
}

interface RollingState {
  blockTxCounts: number[];   // last ROLLING_WINDOW counts
  txRates: number[];         // txs per second samples
  lastBlockTime: number;
  lastBlockHeight: number;
  processedTxHashes: Set<string>;
  processedBlockHeights: Set<number>;
  alertCooldowns: Map<string, number>;  // key → last-alerted epoch ms
  emptyBlockStreak: number;
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

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useHLManipulationScanner({
  enabled = true,
  megaTxUsd = MEGA_TX_USD,
  onAlert,
}: ScannerOptions) {
  const { blocks, isFirstLoad: blocksLoading } = useHLBlocks();
  const { txs,    isFirstLoad: txsLoading }    = useHLTxs();

  const stateRef = useRef<RollingState>({
    blockTxCounts:         [],
    txRates:               [],
    lastBlockTime:         0,
    lastBlockHeight:       0,
    processedTxHashes:     new Set(),
    processedBlockHeights: new Set(),
    alertCooldowns:        new Map(),
    emptyBlockStreak:      0,
  });

  // ── Cooldown check ──────────────────────────────────────────────────────────
  const canAlert = useCallback((key: string): boolean => {
    const s = stateRef.current;
    const last = s.alertCooldowns.get(key) ?? 0;
    if (Date.now() - last < ALERT_COOLDOWN_MS) return false;
    s.alertCooldowns.set(key, Date.now());
    return true;
  }, []);

  // ── Process new blocks ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || blocksLoading || blocks.length === 0) return;

    const s = stateRef.current;
    const newBlocks = blocks.filter(b => !s.processedBlockHeights.has(b.height));
    if (newBlocks.length === 0) return;

    for (const block of newBlocks) {
      s.processedBlockHeights.add(block.height);
      s.blockTxCounts.push(block.txCount);
      if (s.blockTxCounts.length > ROLLING_WINDOW) s.blockTxCounts.shift();

      // ── TX Rate (txs/sec between blocks) ───────────────────────────────────
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
              `Block #${block.height}: ${block.txCount} txs (${rate.toFixed(1)}/s vs avg ${avgRate.toFixed(1)}/s) — ${SURGE_MULT}× surge detected`,
            ));
          }
        }
      }

      // ── Block Flood ─────────────────────────────────────────────────────────
      if (s.blockTxCounts.length >= 5) {
        const avg = s.blockTxCounts.slice(0, -1).reduce((a, b) => a + b, 0) / (s.blockTxCounts.length - 1);
        if (avg > 0 && block.txCount > avg * BLOCK_FLOOD_MULT) {
          if (canAlert('flood')) {
            onAlert(buildAlert(
              'high', 'H', '🌊 HL BLOCK FLOOD',
              `Block #${block.height}: ${block.txCount} txs — ${(block.txCount / avg).toFixed(1)}× normal rate. Possible wash-trade burst.`,
            ));
          }
        }
      }

      // ── Dead-block streak ───────────────────────────────────────────────────
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

      s.lastBlockTime   = block.time;
      s.lastBlockHeight = block.height;
    }
  }, [blocks, enabled, blocksLoading, canAlert, onAlert]);

  // ── Process new txs ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || txsLoading || txs.length === 0) return;

    const s = stateRef.current;
    const newTxs = txs.filter(tx => !s.processedTxHashes.has(tx.hash));
    if (newTxs.length === 0) return;

    // ── Mega-TX detection ────────────────────────────────────────────────────
    for (const tx of newTxs) {
      s.processedTxHashes.add(tx.hash);
      if (s.processedTxHashes.size > 2000) {
        // Trim oldest entries to avoid memory leak over long sessions
        const arr = [...s.processedTxHashes];
        s.processedTxHashes = new Set(arr.slice(-1000));
      }

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

    // ── Repeat-address pattern ───────────────────────────────────────────────
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

  // ── Cleanup on unmount ───────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      const s = stateRef.current;
      s.processedTxHashes.clear();
      s.processedBlockHeights.clear();
      s.alertCooldowns.clear();
    };
  }, []);
}

// ── Formatter ─────────────────────────────────────────────────────────────────

function formatUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
