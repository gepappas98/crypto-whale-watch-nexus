/* ══ WHALE RADAR — SMART-MONEY WALLET SKILL SCORING ═══════════════════════════
 *  Roadmap item: "ranking tracked wallets by trading skill (win rate, avg
 *  profit on their trades), not just showing raw balance/activity — needs
 *  per-wallet trade history parsing (token swaps, not just tx count)."
 *
 *  solanaWallet.ts already fetches balance + a raw tx *count* per wallet.
 *  This module goes one level deeper: it pulls each tracked wallet's recent
 *  transactions, parses the ones that are actually SOL<->SPL-token swaps
 *  (via preBalances/postBalances + preTokenBalances/postTokenBalances —
 *  the same public getTransaction fields Solscan-style explorers use, no
 *  paid indexer needed), and FIFO-matches buys against sells per token to
 *  get a REALIZED SOL P&L per closed round-trip — same cost-basis
 *  convention server/services/gridPnl.ts already uses for grid fills, not
 *  re-derived from scratch.
 *
 *  Honest scope, called out rather than hidden (same convention this file's
 *  neighbors use):
 *   - Only txs with exactly ONE SOL-correlated token-balance change are
 *     scored. A tx where several token balances move at once (multi-hop
 *     routed swaps, token-to-token swaps with no direct SOL leg) has no
 *     unambiguous way to attribute the SOL delta to one mint here, so it's
 *     skipped rather than guessed at.
 *   - A sell only counts as a *scored* closed trade when it's fully covered
 *     by buys this module has actually seen. A sell of tokens acquired
 *     before the tracked window (airdrops, a buy older than the signature
 *     lookback, a transfer in) has no honest cost basis, so — exactly like
 *     gridPnl.ts's unseeded grid sell-side — it's excluded from win-rate/
 *     avg-profit math rather than counted at 100% profit.
 *   - Public RPC only, same trust model as the rest of this file's balance/
 *     activity fetch: getTransaction bodies are cached forever per
 *     signature (a finalized tx never changes) so repeated scoring passes
 *     only pay for *new* signatures, not the whole history every time.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { solanaRpcCall, type RpcSignatureEntry } from './solanaWallet';

const SIGNATURE_LOOKBACK = 12; // per-wallet getTransaction calls this module makes per scoring pass, at most
const TX_FETCH_STAGGER_MS = 150; // sequential, not parallel — public RPC 429s aggressively on bursts
const SCORE_CACHE_TTL_MS = 3 * 60_000;
const MIN_CONFIDENT_TRADES = 5; // closed trades needed before the score isn't discounted for sample size

export interface WalletSwapEvent {
  signature: string;
  ts: number;
  mint: string;
  side: 'buy' | 'sell';
  tokenAmount: number;
  solAmount: number; // SOL spent (buy) or received (sell), net of the tx's own fee
}

export interface WalletSkillScore {
  address: string;
  closedTrades: number; // sells fully covered by tracked buys — the only ones counted below
  winRate: number | null; // fraction of closedTrades with positive realized SOL pnl
  avgProfitSol: number | null;
  totalRealizedPnlSol: number;
  sampleSize: number; // raw swap legs parsed (buys + all sells, incl. unscored ones), for an honesty caveat in the UI
  score: number | null; // 0-100, confidence-discounted; null until there's at least one closed trade
  scannedAt: number;
}

const txCache = new Map<string, ParsedTx | null>();
const scoreCache = new Map<string, { data: WalletSkillScore; ts: number }>();

interface ParsedTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { uiAmount: number | null };
}

interface ParsedTx {
  blockTime: number | null;
  accountKeys: { pubkey: string }[];
  preBalances: number[];
  postBalances: number[];
  preTokenBalances: ParsedTokenBalance[];
  postTokenBalances: ParsedTokenBalance[];
}

async function fetchParsedTx(signature: string): Promise<ParsedTx | null> {
  if (txCache.has(signature)) return txCache.get(signature)!;
  try {
    const raw = await solanaRpcCall<{
      blockTime: number | null;
      transaction: { message: { accountKeys: { pubkey: string }[] } };
      meta: {
        preBalances: number[];
        postBalances: number[];
        preTokenBalances?: ParsedTokenBalance[];
        postTokenBalances?: ParsedTokenBalance[];
      } | null;
    } | null>('getTransaction', [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);

    if (!raw || !raw.meta) {
      txCache.set(signature, null);
      return null;
    }
    const parsed: ParsedTx = {
      blockTime: raw.blockTime,
      accountKeys: raw.transaction.message.accountKeys,
      preBalances: raw.meta.preBalances,
      postBalances: raw.meta.postBalances,
      preTokenBalances: raw.meta.preTokenBalances ?? [],
      postTokenBalances: raw.meta.postTokenBalances ?? [],
    };
    txCache.set(signature, parsed);
    // Unbounded growth guard — a tracked-wallet session won't realistically
    // touch more signatures than this; if it does, drop the oldest half.
    if (txCache.size > 4000) {
      const keys = [...txCache.keys()].slice(0, 2000);
      for (const k of keys) txCache.delete(k);
    }
    return parsed;
  } catch (err) {
    console.error(`[walletSkillScoring] getTransaction ${signature} failed`, (err as Error).message);
    txCache.set(signature, null);
    return null;
  }
}

const LAMPORTS_PER_SOL = 1_000_000_000;

/** Extracts at most one swap event from a parsed tx for `address`, or null
 *  if the tx isn't a swap this module can attribute unambiguously. */
function extractSwap(address: string, sig: string, tx: ParsedTx): WalletSwapEvent | null {
  const accIdx = tx.accountKeys.findIndex((k) => k.pubkey === address);
  if (accIdx === -1 || tx.preBalances[accIdx] == null || tx.postBalances[accIdx] == null) return null;

  const solDeltaLamports = tx.postBalances[accIdx] - tx.preBalances[accIdx];
  if (solDeltaLamports === 0) return null;

  const preByMint = new Map<string, number>();
  for (const b of tx.preTokenBalances) {
    if (b.owner === address) preByMint.set(b.mint, b.uiTokenAmount.uiAmount ?? 0);
  }
  const postByMint = new Map<string, number>();
  for (const b of tx.postTokenBalances) {
    if (b.owner === address) postByMint.set(b.mint, b.uiTokenAmount.uiAmount ?? 0);
  }

  const mints = new Set([...preByMint.keys(), ...postByMint.keys()]);
  const changedMints: { mint: string; delta: number }[] = [];
  for (const mint of mints) {
    const delta = (postByMint.get(mint) ?? 0) - (preByMint.get(mint) ?? 0);
    if (Math.abs(delta) > 1e-9) changedMints.push({ mint, delta });
  }

  // Ambiguous multi-token tx (routed swap through several hops) — skip
  // rather than guess which mint the SOL delta belongs to.
  if (changedMints.length !== 1) return null;

  const { mint, delta } = changedMints[0];
  const solAmount = Math.abs(solDeltaLamports) / LAMPORTS_PER_SOL;
  const ts = tx.blockTime ?? Math.floor(Date.now() / 1000);

  if (delta > 0 && solDeltaLamports < 0) {
    return { signature: sig, ts, mint, side: 'buy', tokenAmount: delta, solAmount };
  }
  if (delta < 0 && solDeltaLamports > 0) {
    return { signature: sig, ts, mint, side: 'sell', tokenAmount: -delta, solAmount };
  }
  return null; // SOL and token moved the same direction — not a swap (e.g. just paid a fee)
}

/** FIFO-matches one mint's chronological buy/sell events. Mirrors
 *  server/services/gridPnl.ts's matchFillsFifo convention: sells consume
 *  the oldest unmatched buys first. Only *fully*-matched sells are counted
 *  as closed trades — see module docstring for why. */
function fifoMatchMint(events: WalletSwapEvent[]): { pnlSol: number }[] {
  const buys: { tokenAmount: number; solCost: number }[] = [];
  const closed: { pnlSol: number }[] = [];

  for (const e of events) {
    if (e.side === 'buy') {
      buys.push({ tokenAmount: e.tokenAmount, solCost: e.solAmount });
      continue;
    }
    const dust = e.tokenAmount * 1e-6;
    let remaining = e.tokenAmount;
    let matchedCost = 0;
    while (remaining > dust && buys.length > 0) {
      const buy = buys[0];
      const matched = Math.min(remaining, buy.tokenAmount);
      const costPerUnit = buy.solCost / buy.tokenAmount;
      matchedCost += costPerUnit * matched;
      buy.tokenAmount -= matched;
      buy.solCost -= costPerUnit * matched;
      remaining -= matched;
      if (buy.tokenAmount <= dust) buys.shift();
    }
    if (remaining <= dust) {
      closed.push({ pnlSol: e.solAmount - matchedCost });
    }
    // else: sell exceeded tracked cost basis — not scored, see docstring.
  }
  return closed;
}

/**
 * Fetches, parses, and scores one wallet's recent swap history. Cached for
 * SCORE_CACHE_TTL_MS so a poll loop across several tracked wallets doesn't
 * re-walk transaction history faster than that per address; the underlying
 * getTransaction bodies are cached indefinitely regardless (see txCache).
 */
export async function scoreWalletSkill(address: string): Promise<WalletSkillScore> {
  const cached = scoreCache.get(address);
  if (cached && Date.now() - cached.ts < SCORE_CACHE_TTL_MS) return cached.data;

  const signatures = await solanaRpcCall<RpcSignatureEntry[]>('getSignaturesForAddress', [
    address,
    { limit: SIGNATURE_LOOKBACK },
  ]);

  const events: WalletSwapEvent[] = [];
  for (let i = 0; i < signatures.length; i++) {
    const tx = await fetchParsedTx(signatures[i].signature);
    if (tx) {
      const swap = extractSwap(address, signatures[i].signature, tx);
      if (swap) events.push(swap);
    }
    if (i < signatures.length - 1) await new Promise((r) => setTimeout(r, TX_FETCH_STAGGER_MS));
  }

  events.sort((a, b) => a.ts - b.ts);
  const byMint = new Map<string, WalletSwapEvent[]>();
  for (const e of events) {
    const list = byMint.get(e.mint) ?? [];
    list.push(e);
    byMint.set(e.mint, list);
  }

  const closedTrades: { pnlSol: number }[] = [];
  for (const mintEvents of byMint.values()) closedTrades.push(...fifoMatchMint(mintEvents));

  const wins = closedTrades.filter((t) => t.pnlSol > 0).length;
  const totalRealizedPnlSol = closedTrades.reduce((s, t) => s + t.pnlSol, 0);
  const winRate = closedTrades.length > 0 ? wins / closedTrades.length : null;
  const avgProfitSol = closedTrades.length > 0 ? totalRealizedPnlSol / closedTrades.length : null;

  // Confidence-discounted composite, same reasoning as pairPerformance.ts's
  // score: a wallet with 1 lucky closed trade shouldn't outrank one with a
  // consistent 15-trade record. Win rate carries most of the weight since
  // it's the more stable signal at small sample sizes; avg profit (clamped
  // to +-1 SOL for the scaling) adds a secondary tilt.
  let score: number | null = null;
  if (winRate !== null) {
    const confidence = Math.min(1, closedTrades.length / MIN_CONFIDENT_TRADES);
    const profitTilt = Math.max(-1, Math.min(1, (avgProfitSol ?? 0) / 1)) * 10;
    score = Math.max(0, Math.min(100, (winRate * 90 + profitTilt) * confidence));
  }

  const data: WalletSkillScore = {
    address,
    closedTrades: closedTrades.length,
    winRate,
    avgProfitSol,
    totalRealizedPnlSol: +totalRealizedPnlSol.toFixed(6),
    sampleSize: events.length,
    score: score === null ? null : +score.toFixed(1),
    scannedAt: Date.now(),
  };
  scoreCache.set(address, { data, ts: Date.now() });
  return data;
}

/** Sorts scored wallets by skill score, unscored/thin-data wallets last —
 *  same "rank the ones that qualify, don't hide the rest" convention
 *  pairPerformance.ts's rankByPerformance() uses for symbols. */
export function rankWalletsBySkill<T extends { address: string; skillScore?: number | null }>(wallets: T[]): T[] {
  return [...wallets].sort((a, b) => {
    const aScore = a.skillScore ?? -1;
    const bScore = b.skillScore ?? -1;
    return bScore - aScore;
  });
}
