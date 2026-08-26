// src/hooks/useRegimeAlerts.ts
import { useEffect, useRef } from 'react';
import { alertCooldown } from '@/lib/alertCooldown';
import { dispatchNotification } from '@/lib/notifyChannels';
import { getLastAlertedTier, setLastAlertedTier, tierAdvanced, regimeAlertLevel, buildRegimeAlertText } from '@/lib/regime/regimeAlerts';
import type { RegimeReading } from '@/lib/regime/types';

type AddAlert = (level: 'critical' | 'high' | 'medium' | 'info', tag: string, text: string, sizing?: string) => void;

/** Deliberately separate from useRegimeEngine.ts — that hook's job is
 *  computing a reading, not deciding when to alert on it. Call this
 *  alongside it, passing the same `reading` and the app's existing
 *  addAlert, wherever both are already in scope (RegimePanel).
 *
 *  v9.38: fires once per tier reached within a regime streak (early →
 *  developing → confirmed), not once at the old single ~15min "confirmed"
 *  mark — up to 3 alerts per transition, each with genuinely new
 *  information. See regimeAlerts.ts's tierAdvanced()/regimeAlertLevel(). */
export function useRegimeAlerts(reading: RegimeReading | null, addAlert: AddAlert): void {
  const lastRef = useRef(getLastAlertedTier());

  useEffect(() => {
    if (!reading || !reading.tier) return;
    if (!tierAdvanced(lastRef.current, reading.regime, reading.tier)) return;

    // Same gate scanner alerts go through (lib/alertCooldown.ts) — a
    // 'regime' tag keeps this in its own cooldown bucket, separate from any
    // per-symbol tag, so a busy scanner session can't suppress a regime
    // alert or vice versa.
    const level = regimeAlertLevel(reading.regime, reading.tier);
    const { allowed } = alertCooldown.checkAndRecord('regime', level);
    if (allowed) {
      const text = buildRegimeAlertText(reading);
      addAlert(level, 'REGIME', text);
      // Same fan-out point scanner alerts use — silently no-ops for any
      // channel the user hasn't configured.
      dispatchNotification(level, 'REGIME', text);

      // Only mark this tier as alerted once it actually fired. If the
      // cooldown blocked it, lastRef/localStorage deliberately stay on the
      // PREVIOUS tier, so the next poll still sees an advance and retries
      // once the cooldown clears — otherwise a single cooldown-suppressed
      // tick would permanently swallow this tier's alert.
      lastRef.current = { regime: reading.regime, tier: reading.tier };
      setLastAlertedTier(reading.regime, reading.tier);
    }
    // Only reading.tier/reading.regime changing should re-run this
    // meaningfully — re-checking via lastRef against every reading (even
    // unchanged ones) on each 5-minute poll is intentional and cheap, not
    // a bug: tierAdvanced() is what actually gates whether anything fires.
  }, [reading, addAlert]);
}
