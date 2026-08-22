// src/hooks/useRegimeAlerts.ts
import { useEffect, useRef } from 'react';
import { alertCooldown } from '@/lib/alertCooldown';
import { dispatchNotification } from '@/lib/notifyChannels';
import { getLastAlertedRegime, setLastAlertedRegime, regimeAlertLevel, buildRegimeAlertText } from '@/lib/regime/regimeAlerts';
import type { RegimeReading } from '@/lib/regime/types';

type AddAlert = (level: 'critical' | 'high' | 'medium' | 'info', tag: string, text: string, sizing?: string) => void;

/** Deliberately separate from useRegimeEngine.ts — that hook's job is
 *  computing a reading, not deciding when to alert on it. Call this
 *  alongside it, passing the same `reading` and the app's existing
 *  addAlert, wherever both are already in scope (RegimePanel). */
export function useRegimeAlerts(reading: RegimeReading | null, addAlert: AddAlert): void {
  const lastRef = useRef<string | null>(getLastAlertedRegime());

  useEffect(() => {
    if (!reading || !reading.confirmedRegime) return;
    if (reading.confirmedRegime === lastRef.current) return;

    // Same gate scanner alerts go through (lib/alertCooldown.ts) — a
    // 'regime' tag keeps this in its own cooldown bucket, separate from any
    // per-symbol tag, so a busy scanner session can't suppress a regime
    // alert or vice versa.
    const level = regimeAlertLevel(reading.confirmedRegime);
    const { allowed } = alertCooldown.checkAndRecord('regime', level);
    if (allowed) {
      const text = buildRegimeAlertText(reading);
      addAlert(level, 'REGIME', text);
      // Same fan-out point scanner alerts use — silently no-ops for any
      // channel the user hasn't configured.
      dispatchNotification(level, 'REGIME', text);

      // Only mark this transition as alerted once it actually fired. If the
      // cooldown blocked it, lastRef/localStorage deliberately stay on the
      // PREVIOUS regime, so the next poll still sees confirmedRegime !==
      // lastRef.current and retries once the cooldown clears — otherwise a
      // single cooldown-suppressed tick would permanently swallow this
      // transition's alert.
      lastRef.current = reading.confirmedRegime;
      setLastAlertedRegime(reading.confirmedRegime);
    }
    // Only confirmedRegime changing should re-run this — re-checking it
    // via lastRef against every reading (even unconfirmed/unchanged ones)
    // on each 5-minute poll is intentional and cheap, not a bug.
  }, [reading, addAlert]);
}
