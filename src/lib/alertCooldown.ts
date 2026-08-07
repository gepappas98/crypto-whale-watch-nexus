/* ══ WHALE RADAR — ALERT COOLDOWN / CIRCUIT BREAKER ═══════════════════════════
 *
 *  Ported concept from freqtrade's plugins/protections/* (StoplossGuard,
 *  MaxDrawdownProtection, CooldownPeriod). Freqtrade "locks" a pair (or the
 *  whole bot) after too many bad events fire in a short window, so it
 *  doesn't keep re-entering a broken market. Here we apply the same idea to
 *  ALERTS instead of trades:
 *
 *    - Per-symbol guard (StoplossGuard analog): if a symbol fires N alerts
 *      within a lookback window, it's almost certainly wash-trading /
 *      flapping data, not N genuine whale events — lock that symbol out of
 *      the feed for a cooldown period.
 *
 *    - Global circuit breaker (MaxDrawdownProtection analog): if CRITICAL
 *      alerts fire across many symbols at once in a short window, that's a
 *      strong sign the data feed itself is glitching (API hiccup, bad
 *      snapshot) rather than a real market-wide event — pause ALL alerting
 *      briefly rather than blast the user with noise.
 *
 *  State is kept in-memory (module scope), matching the rest of the
 *  scan-engine's ref-based state. Nothing here is copied from freqtrade's
 *  source — only the lock/unlock-with-reason pattern is re-implemented.
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface CooldownConfig {
  /** StoplossGuard analog: max alerts for one symbol inside lookbackMs before it's locked. */
  perSymbolLimit: number;
  perSymbolLookbackMs: number;
  perSymbolLockMs: number;

  /** MaxDrawdownProtection analog: max CRITICAL alerts (any symbol) inside globalLookbackMs before global lock. */
  globalCriticalLimit: number;
  globalLookbackMs: number;
  globalLockMs: number;
}

export const DEFAULT_COOLDOWN_CONFIG: CooldownConfig = {
  perSymbolLimit: 5,
  perSymbolLookbackMs: 15 * 60_000, // 15 min
  perSymbolLockMs: 30 * 60_000,     // 30 min

  globalCriticalLimit: 8,
  globalLookbackMs: 5 * 60_000,     // 5 min
  globalLockMs: 10 * 60_000,        // 10 min
};

export type AlertLevel = 'critical' | 'high' | 'medium' | 'info';

interface SymbolHistory {
  fires: number[];       // timestamps
  lockedUntil: number;   // 0 = not locked
}

export interface LockInfo {
  scope: 'symbol' | 'global';
  symbol?: string;
  reason: string;
  until: number;
}

export class AlertCooldown {
  private cfg: CooldownConfig;
  private bySymbol = new Map<string, SymbolHistory>();
  private criticalFires: number[] = [];
  private globalLockedUntil = 0;
  private globalLockReason = '';
  private activeLocks = new Map<string, LockInfo>(); // key: 'global' | symbol

  constructor(cfg: CooldownConfig = DEFAULT_COOLDOWN_CONFIG) {
    this.cfg = cfg;
  }

  /**
   * Call BEFORE dispatching an alert. Returns whether it's allowed to fire.
   * If allowed, also records the fire (so this is check-and-record in one step,
   * mirroring how freqtrade evaluates protections at the moment of the event).
   */
  checkAndRecord(symbol: string, level: AlertLevel, now: number = Date.now()): { allowed: boolean; reason?: string } {
    // 1. Global circuit breaker check first — cheapest, and if tripped nothing else matters.
    if (this.globalLockedUntil > now) {
      return { allowed: false, reason: `global cooldown active: ${this.globalLockReason}` };
    }
    if (this.globalLockedUntil && this.globalLockedUntil <= now) {
      this.globalLockedUntil = 0;
      this.activeLocks.delete('global');
    }

    // 2. Per-symbol guard
    const hist = this.bySymbol.get(symbol) ?? { fires: [], lockedUntil: 0 };
    if (hist.lockedUntil > now) {
      return { allowed: false, reason: `symbol cooldown active (${Math.ceil((hist.lockedUntil - now) / 60_000)}m left)` };
    }
    if (hist.lockedUntil && hist.lockedUntil <= now) {
      hist.lockedUntil = 0;
      this.activeLocks.delete(symbol);
    }

    // Record this fire, prune old entries outside the lookback window
    hist.fires = hist.fires.filter(ts => now - ts < this.cfg.perSymbolLookbackMs);
    hist.fires.push(now);

    if (hist.fires.length >= this.cfg.perSymbolLimit) {
      hist.lockedUntil = now + this.cfg.perSymbolLockMs;
      const reason = `${hist.fires.length} alerts in ${Math.round(this.cfg.perSymbolLookbackMs / 60_000)}m`;
      this.activeLocks.set(symbol, {
        scope: 'symbol', symbol, reason, until: hist.lockedUntil,
      });
      this.bySymbol.set(symbol, hist);
      return { allowed: false, reason: `symbol locked: ${reason}` };
    }
    this.bySymbol.set(symbol, hist);

    // 3. Track CRITICAL fires for the global breaker
    if (level === 'critical') {
      this.criticalFires = this.criticalFires.filter(ts => now - ts < this.cfg.globalLookbackMs);
      this.criticalFires.push(now);

      if (this.criticalFires.length >= this.cfg.globalCriticalLimit) {
        this.globalLockedUntil = now + this.cfg.globalLockMs;
        this.globalLockReason = `${this.criticalFires.length} CRITICAL alerts in ${Math.round(this.cfg.globalLookbackMs / 60_000)}m — likely feed glitch`;
        this.activeLocks.set('global', {
          scope: 'global', reason: this.globalLockReason, until: this.globalLockedUntil,
        });
        // The alert that tripped the breaker still fires — it's the evidence.
        // Only subsequent ones are suppressed.
      }
    }

    return { allowed: true };
  }

  /** For a status badge / debug panel. */
  getActiveLocks(now: number = Date.now()): LockInfo[] {
    return Array.from(this.activeLocks.values()).filter(l => l.until > now);
  }

  isGloballyLocked(now: number = Date.now()): boolean {
    return this.globalLockedUntil > now;
  }

  reset(): void {
    this.bySymbol.clear();
    this.criticalFires = [];
    this.globalLockedUntil = 0;
    this.activeLocks.clear();
  }
}

// Module-level singleton — mirrors signalStore.ts's module-scope state pattern,
// so the whole app shares one cooldown instance without prop-drilling.
export const alertCooldown = new AlertCooldown();
