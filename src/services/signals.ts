/* ══ Signal computation — pure functions, no side effects ═══════════════════ */

export const MCAP_MIN_RELIABLE = 10_000;

/**
 * CEO signal label. Mirrors WRScanner.getCeoSignal.
 * BUG-004 fix preserved: WASH/bad-data short-circuit before CRITICAL+PUMP path.
 */
export function getCeoSignalLabel(
  score: number,
  threat: string,
  category: string,
  vmcap: number,
): string {
  const t = threat.toUpperCase();
  const cat = (category || '').toUpperCase();

  if (vmcap > 1000 || cat.includes('WASH')) return 'AVOID / SHORT';
  if (t === 'CRITICAL' && (cat.includes('PUMP') || cat.includes('SQUEEZE'))) return 'AGGRESSIVE LONG';
  if (score >= 88) return 'AVOID / SHORT';
  if (t === 'CRITICAL') return 'AVOID / SHORT';
  if (score >= 70 && (cat.includes('PUMP') || cat.includes('SQUEEZE'))) return 'AGGRESSIVE LONG';
  if (score >= 60 && (cat.includes('PUMP') || cat.includes('SQUEEZE') || vmcap > 300)) return 'LONG (tight stop)';
  if (score >= 45) return 'LONG';
  if (score >= 35) return 'WATCH';
  return 'HOLD';
}
