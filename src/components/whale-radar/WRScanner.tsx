/* ══ WHALE RADAR v9 — SCANNER TABLE ══════════════════════════════════════════ */
import { useState } from 'react';
import { CoinData, TrackedToken, PortfolioEntry, fmtN, fmtP, calcSizing } from '@/lib/whaleRadarState';
import type { AlertItem } from '@/lib/whaleRadarState';

interface WRScannerProps {
  coins: CoinData[];
  scanBadge: string;
  scanning: boolean;
  autoScan: boolean;
  watchlistOnly: boolean;
  tracked: Record<string, TrackedToken>;
  portfolio: Record<string, PortfolioEntry>;
  aiKey: string;
  vmcapThr: number;
  pchgThr: number;
  onScan: () => void;
  onToggleAuto: () => void;
  onToggleWatchlist: () => void;
  onTrack: (id: string, symbol: string, price: number) => void;
  onUntrack: (symbol: string) => void;
  onVmcapChange: (v: number) => void;
  onPchgChange: (v: number) => void;
  onOpenModal: (m: string) => void;
  onAddAlert: (level: AlertItem['level'], tag: string, text: string) => void;
}

export function WRScanner({
  coins, scanBadge, scanning, autoScan, watchlistOnly, tracked, portfolio,
  aiKey, vmcapThr, pchgThr,
  onScan, onToggleAuto, onToggleWatchlist, onTrack, onUntrack,
  onVmcapChange, onPchgChange, onOpenModal,
}: WRScannerProps) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string>('score');
  const [sortDir, setSortDir] = useState(-1);

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => -d);
    else { setSortKey(key); setSortDir(-1); }
  };

  const filtered = coins
    .filter(c => !search || c.symbol.includes(search.toUpperCase()) || c.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortKey];
      const bv = (b as Record<string, unknown>)[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir;
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * sortDir;
      return 0;
    });

  const badgeCls = scanBadge === 'LIVE' ? 'text-wr-green border-wr-green-dim bg-wr-green-ghost'
    : scanBadge === 'SCANNING' ? 'text-wr-cyan border-wr-cyan/30'
    : scanBadge === 'ERROR' || scanBadge === 'RATE LIMITED' ? 'text-wr-red border-wr-red/30'
    : 'text-wr-muted border-wr-border';

  return (
    <div className="flex flex-col border border-wr-border bg-wr-bg2 min-h-0">
      {/* Panel header */}
      <div className="wr-panel-header">
        <span className="wr-panel-title">⬡ MANIPULATION SCANNER v9 — TOP 250</span>
        <div className="flex gap-2 items-center flex-wrap">
          <span className={`text-[8px] px-1.5 py-0.5 border tracking-widest ${badgeCls}`}>{scanBadge}</span>
        </div>
      </div>

      {/* Quick Actions Bar */}
      <div className="quick-actions">
        <button className="wr-btn" onClick={onScan} disabled={scanning} title="Scan now [S]">
          {scanning ? <span className="inline-block w-2.5 h-2.5 border border-wr-border border-t-wr-green rounded-full animate-spin-fast mr-1" /> : '▶'} SCAN
        </button>
        <button className={`wr-btn ${autoScan ? 'active' : ''}`} onClick={onToggleAuto} title="Toggle auto [A]">
          AUTO: {autoScan ? 'ON' : 'OFF'}
        </button>
        <button className={`wr-btn blue ${watchlistOnly ? 'active' : ''}`} onClick={onToggleWatchlist} title="Watchlist only [W]">
          ☆ WL
        </button>
        <button className="wr-btn ai" onClick={() => onOpenModal('backtest')} title="Backtest [B]">
          📊 BT <span className="pro-badge">PRO</span>
        </button>
        <button className="wr-btn sol" onClick={() => onOpenModal('portfolio')} title="Portfolio [P]">
          💼 PTF <span className="pro-badge">PRO</span>
        </button>
        <button className="wr-btn ai" onClick={() => onOpenModal('sentiment')} title="AI Sentiment">
          ✦ SENT <span className="pro-badge">PRO</span>
        </button>

        <div className="flex-1" />

        <input
          className="wr-input max-w-[160px]"
          placeholder="Filter symbol / name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {/* Sliders */}
        <div className="flex items-center gap-1.5">
          <label className="text-[8px] text-wr-green-dim tracking-widest">VOL/MCAP≥</label>
          <input type="range" className="w-16 h-0.5 accent-wr-green" min={50} max={1000} step={25} value={vmcapThr} onChange={e => onVmcapChange(+e.target.value)} />
          <span className="text-[10px] text-wr-amber w-10">{vmcapThr}%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-[8px] text-wr-green-dim tracking-widest">24H≥</label>
          <input type="range" className="w-16 h-0.5 accent-wr-green" min={5} max={60} step={5} value={pchgThr} onChange={e => onPchgChange(+e.target.value)} />
          <span className="text-[10px] text-wr-amber w-8">{pchgThr}%</span>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto scrollbar-thin">
        <table className="wr-table">
          <thead>
            <tr>
              {[
                { key: 'rank', label: '#' },
                { key: 'symbol', label: 'TOKEN' },
                { key: 'price', label: 'PRICE' },
                { key: 'change', label: '24H%' },
                { key: 'volume', label: '24H VOL' },
                { key: 'mcap', label: 'MKT CAP' },
                { key: 'vmcap', label: 'VOL/MCAP ⚠' },
                { key: 'score', label: 'SCORE' },
                { key: 'threat', label: 'THREAT' },
                { key: 'category', label: 'CATEGORY' },
                { key: '', label: 'TRACK' },
              ].map(col => (
                <th
                  key={col.label}
                  onClick={() => col.key && handleSort(col.key)}
                  className={sortKey === col.key ? 'text-wr-amber' : ''}
                >
                  {col.label}
                  {sortKey === col.key && (sortDir > 0 ? ' ▴' : ' ▾')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={11} className="text-center text-wr-muted text-xs py-12 tracking-widest">
                {coins.length === 0 ? 'Click SCAN to begin surveillance' : 'No tokens match current filters'}
              </td></tr>
            ) : filtered.map(c => {
              const siz = calcSizing(c);
              const isTracked = !!tracked[c.symbol];
              const vmcapCls = c.vmcap >= 800 ? 'text-wr-red' : c.vmcap >= 400 ? 'text-wr-amber' : c.vmcap >= 200 ? 'text-wr-cyan' : 'text-wr-green-dim';
              const catCls = c.category ? `wr-cat-${c.category.toLowerCase()}` : '';

              return (
                <tr key={c.id} className={c.threat === 'CRITICAL' ? 'animate-flash-red' : c.threat === 'HIGH' ? 'animate-flash-amber' : ''}>
                  <td className="text-wr-muted text-[8px]">{c.rank}</td>
                  <td>
                    <div className="font-head text-[10px] text-wr-white tracking-widest">
                      {c.symbol}
                      {c.isSol && <span className="text-wr-sol text-[7px] ml-0.5">◎</span>}
                      {c.dexHot && <span className="text-[7px] px-0.5 bg-wr-blue/10 border border-wr-blue/30 text-wr-blue ml-1">DEX</span>}
                    </div>
                    <div className="text-[8px] text-wr-muted">{c.name}</div>
                  </td>
                  <td className="text-wr-cyan">${fmtP(c.price)}</td>
                  <td className={c.change >= 0 ? 'text-wr-green' : 'text-wr-red'}>
                    {c.change >= 0 ? '+' : ''}{c.change.toFixed(2)}%
                  </td>
                  <td className="text-wr-white">{fmtN(c.volume)}</td>
                  <td className="text-wr-muted">{fmtN(c.mcap)}</td>
                  <td>
                    <span className={vmcapCls}>{c.vmcap.toFixed(0)}%</span>
                    <div className="text-[7px] text-wr-muted">VS:×{c.volSpike.toFixed(1)}</div>
                  </td>
                  <td>
                    <div className="text-[9px] text-wr-amber">{c.score}/100</div>
                    <div className="flex gap-0.5 mt-0.5">
                      {Array.from({ length: 10 }).map((_, i) => (
                        <div key={i} className={`w-1 h-1 rounded-[1px] ${i < Math.ceil(c.score / 10) ? 'bg-wr-amber' : 'bg-wr-border'}`} style={{ background: i < Math.ceil(c.score / 10) ? 'hsl(var(--wr-amber))' : 'hsl(var(--wr-border))' }} />
                      ))}
                    </div>
                    <div className="text-[7px] text-wr-muted mt-0.5">CONF:{c.confidence}%</div>
                  </td>
                  <td><span className={`wr-badge wr-badge-${c.threat.toLowerCase()}`}>{c.threat}</span></td>
                  <td>
                    {c.category ? (
                      <span className={`wr-badge ${catCls}`}>{c.category}</span>
                    ) : (
                      <span className="text-wr-muted text-[7px]">—</span>
                    )}
                  </td>
                  <td>
                    <button
                      className={`wr-btn text-[8px] px-1.5 py-0.5 ${isTracked ? 'active' : ''}`}
                      onClick={() => isTracked ? onUntrack(c.symbol) : onTrack(c.id, c.symbol, c.price)}
                    >
                      {isTracked ? '✓' : '+'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
