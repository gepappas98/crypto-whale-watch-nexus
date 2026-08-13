/* ══ useWalletSkillScoring — polls smart-money skill scores for tracked wallets ══
 *  Sibling to useWalletActivity.ts, kept as its OWN hook rather than folded
 *  into it: activity polling is two light RPC calls every 45s, skill
 *  scoring is up to 12 getTransaction calls (staggered) per wallet, so it
 *  runs far less often and sequentially across wallets — a tracked list of
 *  several wallets scoring in parallel is exactly the burst pattern public
 *  Solana RPC 429s.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { useEffect, useRef } from 'react';
import { scoreWalletSkill } from '@/lib/walletSkillScoring';
import type { WalletEntry } from '@/lib/whaleRadarState';

const POLL_MS = 3 * 60_000;
const BETWEEN_WALLETS_MS = 500; // stagger across wallets too, not just within one wallet's tx fetches

export function useWalletSkillScoring(
  wallets: WalletEntry[],
  setWallets: React.Dispatch<React.SetStateAction<WalletEntry[]>>,
): void {
  const walletsRef = useRef(wallets);
  useEffect(() => { walletsRef.current = wallets; }, [wallets]);

  useEffect(() => {
    let cancelled = false;

    async function scoreAll() {
      for (const w of walletsRef.current) {
        if (cancelled) return;
        try {
          const skill = await scoreWalletSkill(w.address);
          if (cancelled) return;
          setWallets((prev) => prev.map((p) => (
            p.address === w.address
              ? {
                  ...p,
                  skillScore: skill.score ?? p.skillScore,
                  winRate: skill.winRate ?? p.winRate,
                  avgProfitSol: skill.avgProfitSol ?? p.avgProfitSol,
                  closedTrades: skill.closedTrades,
                }
              : p
          )));
        } catch (err) {
          console.error(`[useWalletSkillScoring] ${w.address} failed`, (err as Error).message);
        }
        if (!cancelled) await new Promise((r) => setTimeout(r, BETWEEN_WALLETS_MS));
      }
    }

    if (walletsRef.current.length > 0) void scoreAll();
    const timer = setInterval(() => { void scoreAll(); }, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets.length, setWallets]);
}
