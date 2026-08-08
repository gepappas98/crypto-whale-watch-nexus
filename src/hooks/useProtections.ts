import { useCallback, useEffect, useState } from "react";
import { getActiveLocks, type ProtectionLock } from "@/lib/nexus/protections";

const POLL_MS = 5_000;

/** Live view of active protection locks (cooldown / stoploss guard / max
 *  drawdown / low-profit-pairs). Polls on an interval so an expired lock
 *  disappears from the UI without a manual refresh, and exposes `refresh`
 *  for callers (e.g. after clearing a lock) who want an instant update. */
export function useProtections(): { locks: ProtectionLock[]; refresh: () => void } {
  const [locks, setLocks] = useState<ProtectionLock[]>(getActiveLocks());

  const refresh = useCallback(() => setLocks(getActiveLocks()), []);

  useEffect(() => {
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { locks, refresh };
}
