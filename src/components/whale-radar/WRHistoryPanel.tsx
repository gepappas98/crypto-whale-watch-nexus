/* ══ WHALE RADAR — HISTORY PANEL ══════════════════════════════════════════════
 *  Closes a "logic existed but never reached the UI" gap, same pattern as the
 *  v9.6 fixes documented in the README: src/lib/db.ts has had a fully working
 *  scan-history read API since early on — getScanSessions(), getScanCoins(),
 *  getTokenHistory(), getTopThreats() — backed by real server/routes/scans.ts
 *  endpoints and a populated scan_coins/scan_sessions table (saveScan() has
 *  been called from useMarketData.ts on every scan all along). Nothing ever
 *  called the read side. This panel is that missing consumer — including
 *  getScanCoins(), which had the same gap independently: clicking a session
 *  in the list below fetches and expands its actual coin list.
 *
 *  Fetched on-demand (tab open / refresh click / session click), not polled —
 *  this is historical data, it doesn't change fast enough to justify a live
 *  loop, and it would just be extra backend load for no benefit.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useState } from 'react';
import { getScanSessions, getScanCoins, getTokenHistory, getTopThreats, type ScanSession, type HistoricalCoin, type TopThreatRow } from '@/lib/db';
import type { CoinData } from '@/lib/whaleRadarState';

function threatBadgeClass(threat: string): string {
  switch (threat) {
    case 'CRITICAL': return 'wr-badge-critical';
    case 'HIGH': return 'wr-badge-high';
    case 'MEDIUM': return 'wr-badge-medium';
    default: return 'wr-badge-low';
  }
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0 || Number.isNaN(diffMs)) return '—';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function WRHistoryPanel({ isActive }: { isActive: boolean }) {
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [sessions, setSessions] = useState<ScanSession[]>([]);
  const [topThreats, setTopThreats] = useState<TopThreatRow[]>([]);
  const [symbolQuery, setSymbolQuery] = useState('');
  const [symbolResult, setSymbolResult] = useState<HistoricalCoin[] | null>(null);
  const [symbolLoading, setSymbolLoading] = useState(false);
  // getScanCoins(sessionId) — real, working endpoint (server/routes/scans.ts's
  // GET /scans/:id, already sorted by score) — had no caller either, same
  // "logic exists, no UI consumer" gap this whole panel closes. This is
  // that consumer: click a session row to drill into what it actually saw.
  const [openSessionId, setOpenSessionId] = useState<number | null>(null);
  const [sessionCoins, setSessionCoins] = useState<CoinData[] | null>(null);
  const [sessionCoinsLoading, setSessionCoinsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [s, t] = await Promise.all([getScanSessions(), getTopThreats()]);
    setSessions(s);
    setTopThreats(t);
    setLoading(false);
    setLoadedOnce(true);
  }, []);

  // Load once when the tab is first opened, not on every render.
  useEffect(() => {
    if (isActive && !loadedOnce) void refresh();
  }, [isActive, loadedOnce, refresh]);

  const lookupSymbol = useCallback(async () => {
    const sym = symbolQuery.trim().toUpperCase();
    if (!sym) return;
    setSymbolLoading(true);
    const rows = await getTokenHistory(sym);
    setSymbolResult(rows);
    setSymbolLoading(false);
  }, [symbolQuery]);

  const toggleSession = useCallback(async (id: number) => {
    if (openSessionId === id) {
      setOpenSessionId(null);
      setSessionCoins(null);
      return;
    }
    setOpenSessionId(id);
    setSessionCoins(null);
    setSessionCoinsLoading(true);
    const coins = await getScanCoins(id);
    setSessionCoins(coins);
    setSessionCoinsLoading(false);
  }, [openSessionId]);

  const noBackendData = loadedOnce && sessions.length === 0 && topThreats.length === 0;

  return (
    <div className="border-b border-wr-border">
      <div className="wr-panel-header">
        <span className="wr-panel-title text-wr-amber">📜 SCAN HISTORY</span>
        <button
          className="text-[8px] px-1.5 py-0.5 border border-wr-border text-wr-muted hover:text-wr-amber hover:border-wr-amber font-mono tracking-widest"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? '…' : '⟳ REFRESH'}
        </button>
      </div>

      {/* ── Per-symbol history lookup ─────────────────────────────────── */}
      <div className="p-2 border-b border-wr-border flex gap-1">
        <input
          className="wr-input flex-1 text-[9px]"
          placeholder="Symbol (e.g. BONK) — see its score/price across past scans"
          value={symbolQuery}
          onChange={(e) => setSymbolQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void lookupSymbol()}
        />
        <button className="wr-btn text-[8px]" onClick={() => void lookupSymbol()} disabled={symbolLoading}>
          {symbolLoading ? '…' : 'GO'}
        </button>
      </div>
      {symbolResult !== null && (
        <div className="max-h-40 overflow-y-auto scrollbar-thin border-b border-wr-border">
          {symbolResult.length === 0 ? (
            <div className="text-center text-wr-muted text-[9px] py-4 tracking-widest">
              No scan history for "{symbolQuery.trim().toUpperCase()}" yet
            </div>
          ) : (
            symbolResult.map((r, i) => (
              <div key={i} className="px-3 py-1 border-b border-wr-border/30 grid grid-cols-[auto_1fr_auto_auto] gap-2 items-center text-[8px]">
                <span className={`wr-badge ${threatBadgeClass(r.threat)}`}>{r.threat}</span>
                <span className="text-wr-muted">{new Date(r.scanned_at).toLocaleString()}</span>
                <span className={r.change_24h >= 0 ? 'text-wr-green' : 'text-wr-red'}>{r.change_24h >= 0 ? '+' : ''}{r.change_24h?.toFixed(1)}%</span>
                <span className="text-wr-white">score {r.score}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Top threats across all scan history ───────────────────────── */}
      <div className="wr-panel-header">
        <span className="text-[8px] text-wr-muted tracking-[2px]">TOP THREATS · ALL-TIME</span>
      </div>
      <div className="max-h-40 overflow-y-auto scrollbar-thin border-b border-wr-border">
        {noBackendData ? (
          <div className="text-center text-wr-muted text-[9px] py-6 tracking-widest px-3">
            No scan history yet — needs the backend online and at least one completed scan
          </div>
        ) : (
          topThreats.map((t) => (
            <div key={t.symbol} className="px-3 py-1 border-b border-wr-border/30 grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center text-[8px]">
              <span className="text-wr-white">{t.symbol}</span>
              <span className={`wr-badge ${threatBadgeClass(t.worst_threat)}`}>{t.worst_threat}</span>
              <span className="text-wr-cyan">peak {t.peak_score}</span>
              <span className="text-wr-muted">{t.appearances}× · {timeAgo(t.last_seen)}</span>
            </div>
          ))
        )}
      </div>

      {/* ── Recent scan sessions ──────────────────────────────────────── */}
      <div className="wr-panel-header">
        <span className="text-[8px] text-wr-muted tracking-[2px]">RECENT SCAN SESSIONS</span>
      </div>
      <div className="max-h-48 overflow-y-auto scrollbar-thin">
        {sessions.length === 0 ? (
          <div className="text-center text-wr-muted text-[9px] py-4 tracking-widest">
            {loadedOnce ? 'No sessions recorded yet' : 'Loading…'}
          </div>
        ) : (
          sessions.map((s) => (
            <div key={s.id}>
              <button
                className="w-full text-left px-3 py-1 border-b border-wr-border/30 grid grid-cols-[1fr_auto_auto] gap-2 items-center text-[8px] bg-transparent hover:bg-wr-bg3 cursor-pointer"
                onClick={() => void toggleSession(s.id)}
                title="Click to see this session's actual coin list"
              >
                <span className="text-wr-muted">{openSessionId === s.id ? '▾' : '▸'} {timeAgo(s.scanned_at)}</span>
                <span className="text-wr-white">{s.coin_count} coins</span>
                <span className="text-wr-red">{s.crit_count}C / {s.high_count}H</span>
              </button>
              {openSessionId === s.id && (
                <div className="bg-wr-bg3 border-b border-wr-border/30 max-h-40 overflow-y-auto scrollbar-thin">
                  {sessionCoinsLoading ? (
                    <div className="text-center text-wr-muted text-[8px] py-3 tracking-widest">Loading…</div>
                  ) : !sessionCoins?.length ? (
                    <div className="text-center text-wr-muted text-[8px] py-3 tracking-widest">No coins recorded for this session</div>
                  ) : (
                    sessionCoins.map((c) => (
                      <div key={c.symbol} className="px-3 py-1 grid grid-cols-[1fr_auto_auto] gap-2 items-center text-[8px]">
                        <span className="text-wr-white">{c.symbol}</span>
                        <span className={`wr-badge ${threatBadgeClass(c.threat)}`}>{c.threat}</span>
                        <span className="text-wr-cyan">{c.score}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
