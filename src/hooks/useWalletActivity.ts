/* ══ useWalletActivity — polls real Solana activity for tracked wallets ══════
 *  Side-effect-only hook: no return value, just keeps the wallets array's
 *  balanceSol/recentTxCount24h/lastActivity fields fresh. Owner (Index.tsx)
 *  still owns the wallets state and persistence — this only merges in what
 *  it fetches.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { useEffect, useRef } from 'react';
import { fetchWalletActivity } from '@/lib/solanaWallet';
import type { WalletEntry } from '@/lib/whaleRadarState';

const POLL_MS = 45_000;

export function useWalletActivity(
  wallets: WalletEntry[],
  setWallets: React.Dispatch<React.SetStateAction<WalletEntry[]>>,
): void {
  // Always-current snapshot for the interval closure, without making the
  // effect below re-run (and restart the timer) on every field update —
  // only wallets.length in the dependency array does that, for add/remove.
  const walletsRef = useRef(wallets);
  useEffect(() => { walletsRef.current = wallets; }, [wallets]);

  useEffect(() => {
    let cancelled = false;

    async function refreshAll() {
      for (const w of walletsRef.current) {
        if (cancelled) return;
        try {
          const activity = await fetchWalletActivity(w.address);
          if (cancelled) return;
          setWallets((prev) => prev.map((p) => (
            p.address === w.address
              ? {
                  ...p,
                  balanceSol: activity.balanceSol,
                  recentTxCount24h: activity.recentTxCount24h,
                  lastActivity: activity.lastActivityIso ?? p.lastActivity,
                }
              : p
          )));
        } catch (err) {
          console.error(`[useWalletActivity] ${w.address} failed`, (err as Error).message);
        }
      }
    }

    if (walletsRef.current.length > 0) void refreshAll();
    const timer = setInterval(() => { void refreshAll(); }, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets.length, setWallets]);
}
