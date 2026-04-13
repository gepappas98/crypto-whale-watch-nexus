/* ══ WHALE RADAR — SIGNAL EVAL PANEL ══════════════════════════════════════════
 *  Shows win-rate table for CEO Signal Engine outputs.
 *  Data comes from signal_outcomes table, filled by background price filler.
 *  After 2 weeks of live data this tells you: does AGGRESSIVE LONG actually work?
 * ═══════════════════════════════════════════════════════════════════════════ */
import { useState, useEffect } from 'react';
import { loadSignalEval } from '@/lib/db';
import type { SignalEvalRow } from '@/lib/db';

const SIGNAL_ORDER = [
  'AGGRESSIVE LONG',
  'LONG (tight stop)',
  'LONG',
  'WATCH',
  'AVOID / SHORT',
];

const SIGNAL_COLOR: Record<string, string> = {
  'AGGRESSIVE LONG':    'text-wr-amber',
  'LONG (tight stop)':  'text-wr-amber',
  'LONG':               'text-wr-green',
  'WATCH':              'text-wr-muted',
  'AVOID / SHORT':      'text-wr-red',
};

function pct(n: number | null, decimals = 1): string {
  if (n == null) return '—';
  const s = n.toFixed(decimals);
  return n > 0 ? `+${s}%` : `${s}%`;
}

function pctColor(n: number | null): string {
  if (n == null) return 'text-wr-muted';
  if (n > 3)  return 'text-wr-green';
  if (n > 0)  return 'text-green-400/70';
  if (n > -3) return 'text-wr-red/70';
  return 'text-wr-red';
}

function winColor(rate: number | null): string {
  if (rate == null) return 'text-wr-muted';
  if (rate >= 60) return 'text-wr-green';
  if (rate >= 50) return 'text-green-400/70';
  if (rate >= 40) return 'text-wr-amber';
  return 'text-wr-red';
}

export function WRSignalEval() {
  const [rows, setRows]     = useState<SignalEvalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  async function fetchEval() {
    setLoading(true);
    setError(null);
    try {
      const data = await loadSignalEval();
      // Sort by canonical signal order
      data.sort((a, b) => {
        const ai = SIGNAL_ORDER.indexOf(a.signal);
        const bi = SIGNAL_ORDER.indexOf(b.signal);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
      setRows(data);
      setLastFetch(new Date());
    } catch {
      setError('Could not load eval data — is the API server running?');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchEval(); }, []);

  const totalFires   = rows.reduce((s, r) => s + Number(r.fires), 0);
  const withOutcome  = rows.reduce((s, r) => s + Number(r.with_outcome), 0);
  const coverage     = totalFires > 0 ? Math.round((withOutcome / totalFires) * 100) : 0;

  return (
    <div className="space-y-4 text-[11px] font-mono">

      {/* ── Header meta ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <div className="text-[8px] text-wr-muted tracking-widest">LAST 30 DAYS · CEO SIGNAL ENGINE v1.0</div>
          <div className="text-[8px] text-wr-muted">
            {totalFires} signals recorded · {withOutcome} with 4h outcomes ({coverage}% filled)
          </div>
        </div>
        <button
          onClick={fetchEval}
          disabled={loading}
          className="wr-btn text-[8px] px-2 py-0.5"
        >
          {loading ? '...' : '↻ REFRESH'}
        </button>
      </div>

      {/* ── Coverage warning ──────────────────────────────────────────────── */}
      {withOutcome === 0 && !loading && (
        <div className="border border-wr-amber/30 bg-wr-amber/5 rounded p-3 text-[10px] text-wr-amber leading-relaxed">
          <div className="font-bold mb-1">⏳ Collecting data — no outcomes yet</div>
          Signals are being recorded. The price filler runs every 30 minutes and fills in
          1h / 4h / 24h outcomes via CoinGecko. Come back in a few hours to see win rates.
          You need at least 20 signals with 4h outcomes for meaningful statistics.
        </div>
      )}

      {withOutcome > 0 && withOutcome < 20 && (
        <div className="border border-wr-border rounded p-2 text-[9px] text-wr-muted">
          ⚠ Only {withOutcome} outcomes so far — win rates will stabilize after ~20+ samples per signal.
        </div>
      )}

      {error && (
        <div className="border border-wr-red/30 bg-wr-red/5 rounded p-3 text-[10px] text-wr-red">
          {error}
        </div>
      )}

      {/* ── Main eval table ───────────────────────────────────────────────── */}
      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="border-b border-wr-border">
                <th className="text-left py-1.5 pr-3 text-[8px] text-wr-muted tracking-widest font-normal">SIGNAL</th>
                <th className="text-right py-1.5 px-2 text-[8px] text-wr-muted tracking-widest font-normal">FIRES</th>
                <th className="text-right py-1.5 px-2 text-[8px] text-wr-muted tracking-widest font-normal">AVG 1H</th>
                <th className="text-right py-1.5 px-2 text-[8px] text-wr-muted tracking-widest font-normal">AVG 4H</th>
                <th className="text-right py-1.5 px-2 text-[8px] text-wr-muted tracking-widest font-normal">AVG 24H</th>
                <th className="text-right py-1.5 px-2 text-[8px] text-wr-muted tracking-widest font-normal">WIN% 4H</th>
                <th className="text-right py-1.5 pl-2 text-[8px] text-wr-muted tracking-widest font-normal">AVG SCORE</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.signal} className="border-b border-wr-border/40 hover:bg-wr-bg3/30">
                  <td className={`py-2 pr-3 font-bold ${SIGNAL_COLOR[row.signal] ?? 'text-wr-white'}`}>
                    {row.signal}
                  </td>
                  <td className="text-right px-2 text-wr-white">
                    {row.fires}
                    <span className="text-wr-muted ml-1">
                      ({row.with_outcome})
                    </span>
                  </td>
                  <td className={`text-right px-2 ${pctColor(row.avg_1h_pct)}`}>
                    {pct(row.avg_1h_pct)}
                  </td>
                  <td className={`text-right px-2 font-bold ${pctColor(row.avg_4h_pct)}`}>
                    {pct(row.avg_4h_pct)}
                  </td>
                  <td className={`text-right px-2 ${pctColor(row.avg_24h_pct)}`}>
                    {pct(row.avg_24h_pct)}
                  </td>
                  <td className={`text-right px-2 font-bold ${winColor(row.win_rate_4h)}`}>
                    {row.win_rate_4h != null ? `${row.win_rate_4h}%` : '—'}
                  </td>
                  <td className="text-right pl-2 text-wr-muted">
                    {row.avg_score ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Legend ────────────────────────────────────────────────────────── */}
      <div className="border-t border-wr-border pt-3 space-y-1 text-[8px] text-wr-muted leading-relaxed">
        <div><span className="text-wr-white">Fires</span> = total signal fires · <span className="text-wr-white">(n)</span> = with 4h outcome filled</div>
        <div><span className="text-wr-white">WIN% 4H</span> = % of signals where price was higher 4h later</div>
        <div><span className="text-wr-white">AVG 4H</span> = mean % change from entry price at 4h mark</div>
        <div>Prices filled every 30min via CoinGecko. Outcomes need {'>'}2 weeks to be statistically meaningful.</div>
        {lastFetch && (
          <div className="text-wr-muted/50">Last fetched: {lastFetch.toLocaleTimeString()}</div>
        )}
      </div>

      {/* ── Quick read ────────────────────────────────────────────────────── */}
      {withOutcome >= 20 && rows.length > 0 && (() => {
        const best = rows.filter(r => r.avg_4h_pct != null).sort((a, b) => (b.avg_4h_pct ?? -999) - (a.avg_4h_pct ?? -999))[0];
        const worst = rows.filter(r => r.avg_4h_pct != null).sort((a, b) => (a.avg_4h_pct ?? 999) - (b.avg_4h_pct ?? 999))[0];
        if (!best || !worst) return null;
        return (
          <div className="border border-wr-cyan/20 bg-wr-cyan/5 rounded p-3 space-y-1">
            <div className="text-[8px] text-wr-cyan tracking-widest mb-2">✦ QUICK READ</div>
            <div className="text-[10px] text-wr-white">
              Best 4h performer: <span className={`font-bold ${SIGNAL_COLOR[best.signal] ?? ''}`}>{best.signal}</span>
              {' '}({pct(best.avg_4h_pct)} avg · {best.win_rate_4h}% win rate)
            </div>
            <div className="text-[10px] text-wr-white">
              Worst 4h performer: <span className={`font-bold ${SIGNAL_COLOR[worst.signal] ?? ''}`}>{worst.signal}</span>
              {' '}({pct(worst.avg_4h_pct)} avg · {worst.win_rate_4h}% win rate)
            </div>
          </div>
        );
      })()}

    </div>
  );
}
