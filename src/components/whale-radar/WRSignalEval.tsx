/* ══ WHALE RADAR — SIGNAL EVAL PANEL ══════════════════════════════════════════
 *  Shows win-rate table for CEO Signal Engine outputs.
 *  Data source: localStorage (always) + backend DB (when available).
 *  Outcome prices fetched from CoinGecko at 1h / 4h / 24h marks.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { useState, useEffect, useCallback } from 'react';
import { loadSignalEval } from '@/lib/db';
import type { SignalEvalRow } from '@/lib/db';
import { fillSignalPrices, getSignalStoreStats } from '@/lib/signalStore';

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

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return '<1h ago';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function WRSignalEval() {
  const [rows, setRows]         = useState<SignalEvalRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filling, setFilling]   = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [lastFilled, setLastFilled] = useState<number>(0);
  const [storeStats, setStoreStats] = useState({ total: 0, pendingFill: 0, oldestFiredAt: null as number | null });

  const refreshStats = useCallback(() => {
    setStoreStats(getSignalStoreStats());
  }, []);

  const fetchEval = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadSignalEval();
      data.sort((a, b) => {
        const ai = SIGNAL_ORDER.indexOf(a.signal);
        const bi = SIGNAL_ORDER.indexOf(b.signal);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
      setRows(data);
      setLastFetch(new Date());
      refreshStats();
    } finally {
      setLoading(false);
    }
  }, [refreshStats]);

  const handleFillNow = useCallback(async () => {
    setFilling(true);
    try {
      const filled = await fillSignalPrices();
      setLastFilled(filled);
      await fetchEval(); // Refresh table after filling
    } finally {
      setFilling(false);
    }
  }, [fetchEval]);

  useEffect(() => {
    fetchEval();
  }, [fetchEval]);

  const totalFires  = rows.reduce((s, r) => s + Number(r.fires), 0);
  const withOutcome = rows.reduce((s, r) => s + Number(r.with_outcome), 0);
  const coverage    = totalFires > 0 ? Math.round((withOutcome / totalFires) * 100) : 0;

  return (
    <div className="space-y-4 text-[11px] font-mono">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <div className="text-[8px] text-wr-muted tracking-widest">LAST 30 DAYS · CEO SIGNAL ENGINE v1.0</div>
          <div className="text-[8px] text-wr-muted">
            {storeStats.total} signals stored · {totalFires} in 30d window · {withOutcome} with 4h outcome ({coverage}% filled)
          </div>
          {storeStats.pendingFill > 0 && (
            <div className="text-[8px] text-wr-amber">
              ⏳ {storeStats.pendingFill} pending price fill
            </div>
          )}
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button
            onClick={handleFillNow}
            disabled={filling || loading}
            className="wr-btn text-[8px] px-2 py-0.5"
            title="Fetch outcome prices now from CoinGecko"
          >
            {filling ? '...' : '⚡ FILL'}
          </button>
          <button
            onClick={fetchEval}
            disabled={loading}
            className="wr-btn text-[8px] px-2 py-0.5"
          >
            {loading ? '...' : '↻'}
          </button>
        </div>
      </div>

      {/* ── Last fill result ─────────────────────────────────────────────────── */}
      {lastFilled > 0 && (
        <div className="text-[8px] text-wr-green">
          ✓ Filled {lastFilled} outcome price{lastFilled !== 1 ? 's' : ''} from CoinGecko
        </div>
      )}

      {/* ── No data yet ─────────────────────────────────────────────────────── */}
      {storeStats.total === 0 && !loading && (
        <div className="border border-wr-amber/30 bg-wr-amber/5 rounded p-3 text-[10px] text-wr-amber leading-relaxed">
          <div className="font-bold mb-1">📡 No signals recorded yet</div>
          Run a scan — the engine records every signal automatically.
          Outcome prices (1h / 4h / 24h) are fetched from CoinGecko after each window elapses.
          Hit <span className="text-wr-white font-bold">⚡ FILL</span> to pull prices for any ready signals.
        </div>
      )}

      {/* ── Has signals but no outcomes yet ─────────────────────────────────── */}
      {storeStats.total > 0 && withOutcome === 0 && !loading && (
        <div className="border border-wr-border rounded p-3 text-[10px] text-wr-muted leading-relaxed space-y-1">
          <div className="text-wr-white font-bold">⏳ {storeStats.total} signals recorded — waiting for 1h mark</div>
          <div>Outcome prices fill automatically after 1h, 4h, 24h have elapsed.</div>
          <div>Hit <span className="text-wr-green font-bold">⚡ FILL</span> to check now.</div>
        </div>
      )}

      {withOutcome > 0 && withOutcome < 20 && (
        <div className="border border-wr-border rounded p-2 text-[9px] text-wr-muted">
          ⚠ {withOutcome} outcomes so far — win rates stabilize after ~20+ samples per signal.
        </div>
      )}

      {/* ── Main table ──────────────────────────────────────────────────────── */}
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
                <th className="text-right py-1.5 px-2 text-[8px] text-wr-muted tracking-widest font-normal">SCORE</th>
                <th className="text-right py-1.5 pl-2 text-[8px] text-wr-muted tracking-widest font-normal">LAST</th>
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
                    <span className="text-wr-muted ml-1">({row.with_outcome})</span>
                  </td>
                  <td className={`text-right px-2 ${pctColor(row.avg_1h_pct)}`}>{pct(row.avg_1h_pct)}</td>
                  <td className={`text-right px-2 font-bold ${pctColor(row.avg_4h_pct)}`}>{pct(row.avg_4h_pct)}</td>
                  <td className={`text-right px-2 ${pctColor(row.avg_24h_pct)}`}>{pct(row.avg_24h_pct)}</td>
                  <td className={`text-right px-2 font-bold ${winColor(row.win_rate_4h)}`}>
                    {row.win_rate_4h != null ? `${row.win_rate_4h}%` : '—'}
                  </td>
                  <td className="text-right px-2 text-wr-muted">{row.avg_score ?? '—'}</td>
                  <td className="text-right pl-2 text-wr-muted text-[8px]">{timeAgo(row.last_fire)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Legend ──────────────────────────────────────────────────────────── */}
      <div className="border-t border-wr-border pt-3 space-y-1 text-[8px] text-wr-muted leading-relaxed">
        <div><span className="text-wr-white">Fires</span> = total fires · <span className="text-wr-white">(n)</span> = with 4h outcome filled</div>
        <div><span className="text-wr-white">WIN% 4H</span> = % of signals where price rose after 4h</div>
        <div><span className="text-wr-white">AVG 4H</span> = mean % change from entry at 4h mark</div>
        <div>Outcomes filled from CoinGecko. Stored in browser localStorage. Needs 2+ weeks for statistical significance.</div>
        {lastFetch && (
          <div className="text-wr-muted/50">Updated: {lastFetch.toLocaleTimeString()}</div>
        )}
      </div>

      {/* ── Quick read ──────────────────────────────────────────────────────── */}
      {withOutcome >= 20 && rows.length > 0 && (() => {
        const ranked = rows.filter(r => r.avg_4h_pct != null);
        if (ranked.length < 2) return null;
        const best  = [...ranked].sort((a, b) => (b.avg_4h_pct ?? -999) - (a.avg_4h_pct ?? -999))[0];
        const worst = [...ranked].sort((a, b) => (a.avg_4h_pct ?? 999)  - (b.avg_4h_pct ?? 999))[0];
        return (
          <div className="border border-wr-cyan/20 bg-wr-cyan/5 rounded p-3 space-y-1">
            <div className="text-[8px] text-wr-cyan tracking-widest mb-2">✦ QUICK READ</div>
            <div className="text-[10px] text-wr-white">
              Best 4h: <span className={`font-bold ${SIGNAL_COLOR[best.signal] ?? ''}`}>{best.signal}</span>
              {' '}({pct(best.avg_4h_pct)} avg · {best.win_rate_4h}% win)
            </div>
            <div className="text-[10px] text-wr-white">
              Worst 4h: <span className={`font-bold ${SIGNAL_COLOR[worst.signal] ?? ''}`}>{worst.signal}</span>
              {' '}({pct(worst.avg_4h_pct)} avg · {worst.win_rate_4h}% win)
            </div>
          </div>
        );
      })()}

    </div>
  );
}


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

