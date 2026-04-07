/* ══ WHALE RADAR v9 — RIGHT PANEL ════════════════════════════════════════════ */
import { useState } from 'react';
import { AlertItem, WhaleTrade, WalletEntry, fmtN, fmtP } from '@/lib/whaleRadarState';

interface WRRightPanelProps {
  whaleFeed: WhaleTrade[];
  alerts: AlertItem[];
  alertFilter: string;
  onAlertFilterChange: (f: string) => void;
  wallets: WalletEntry[];
  onAddWallet: (w: WalletEntry) => void;
  onRemoveWallet: (addr: string) => void;
  onTogglePin: (idx: number) => void;
  onClearAlerts: () => void;
}

export function WRRightPanel({
  whaleFeed, alerts, alertFilter, onAlertFilterChange,
  wallets, onAddWallet, onRemoveWallet, onTogglePin, onClearAlerts,
}: WRRightPanelProps) {
  const [walletInput, setWalletInput] = useState('');
  const [walletLabel, setWalletLabel] = useState('');
  const [activeTab, setActiveTab] = useState<'whales' | 'wallets'>('whales');

  const handleAddWallet = () => {
    const addr = walletInput.trim();
    if (!addr || addr.length < 32) return;
    onAddWallet({ address: addr, label: walletLabel.trim() || addr.slice(0, 8) + '...' });
    setWalletInput('');
    setWalletLabel('');
  };

  return (
    <div className="flex flex-col border-l border-wr-border bg-wr-bg2 wr-right-panel min-h-0">
      {/* Whale Trades / Wallet Tracker tabs */}
      <div className="flex border-b border-wr-border bg-wr-bg">
        <button
          className={`flex-1 py-1.5 text-[8px] tracking-[2px] text-center cursor-pointer border-b-2 transition-all font-mono
            ${activeTab === 'whales' ? 'text-wr-green border-wr-green' : 'text-wr-muted border-transparent'}`}
          onClick={() => setActiveTab('whales')}
        >
          🐳 WHALE TRADES
        </button>
        <button
          className={`flex-1 py-1.5 text-[8px] tracking-[2px] text-center cursor-pointer border-b-2 transition-all font-mono
            ${activeTab === 'wallets' ? 'text-wr-sol border-wr-sol' : 'text-wr-muted border-transparent'}`}
          onClick={() => setActiveTab('wallets')}
        >
          🐳 WALLET TRACKER <span className="pro-badge">PRO</span>
        </button>
      </div>

      {activeTab === 'whales' ? (
        <div className="border-b border-wr-border">
          <div className="wr-panel-header">
            <span className="wr-panel-title">🐳 WHALE TRADES — LIVE</span>
          </div>
          <div className="max-h-48 overflow-y-auto scrollbar-thin">
            {whaleFeed.length === 0 ? (
              <div className="text-center text-wr-muted text-[9px] py-6 tracking-widest">
                Add a pair to monitor whale trades
              </div>
            ) : (
              whaleFeed.slice(0, 30).map((w, i) => (
                <div key={i} className="px-3 py-1.5 border-b border-wr-border/40 grid grid-cols-[46px_1fr_auto] gap-1.5 items-center animate-slide-in">
                  <span className="text-[8px] text-wr-muted">{new Date(w.ts).toLocaleTimeString()}</span>
                  <span className="text-[9px] text-wr-white">{w.sym} {w.side}</span>
                  <span className={`text-[10px] text-right ${w.usdt >= 5e6 ? 'text-wr-red font-bold' : w.usdt >= 1e6 ? 'text-wr-amber' : 'text-wr-cyan'}`}>
                    ${fmtN(w.usdt)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="border-b border-wr-border">
          <div className="wr-panel-header">
            <span className="wr-panel-title text-wr-sol">🐳 LIVE WALLET TRACKER</span>
          </div>
          <div className="p-2 space-y-2 border-b border-wr-border">
            <input
              className="wr-input text-[9px]"
              placeholder="Solana wallet address..."
              value={walletInput}
              onChange={e => setWalletInput(e.target.value)}
            />
            <div className="flex gap-1.5">
              <input
                className="wr-input flex-1 text-[9px]"
                placeholder="Label (optional)"
                value={walletLabel}
                onChange={e => setWalletLabel(e.target.value)}
              />
              <button className="wr-btn sol text-[8px]" onClick={handleAddWallet}>+ TRACK</button>
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto scrollbar-thin">
            {wallets.length === 0 ? (
              <div className="text-center text-wr-muted text-[9px] py-6 tracking-widest px-3">
                Add Solana wallet addresses to track whale/dev wallet flows in real-time
              </div>
            ) : (
              wallets.map((w, i) => (
                <div key={i} className="px-3 py-2 border-b border-wr-border/40 flex items-center gap-2 animate-slide-in">
                  <div className="wr-dot wr-dot-sol" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[9px] text-wr-white truncate">{w.label}</div>
                    <div className="text-[7px] text-wr-muted truncate">{w.address}</div>
                  </div>
                  <button className="wr-btn red text-[7px] px-1 py-0" onClick={() => onRemoveWallet(w.address)}>✕</button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Alerts Panel */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="wr-panel-header">
          <span className="wr-panel-title">🚨 MANIPULATION ALERTS</span>
          <button className="wr-btn red text-[7px] px-1.5 py-0.5" onClick={onClearAlerts}>CLR</button>
        </div>

        {/* Alert filter tabs */}
        <div className="px-2 py-1 border-b border-wr-border flex gap-1 items-center flex-wrap">
          {['ALL', 'C', 'H', 'M', 'I', 'PIN'].map(f => (
            <button
              key={f}
              className={`text-[8px] px-1.5 py-0.5 border cursor-pointer font-mono tracking-widest transition-all
                ${alertFilter === f
                  ? 'bg-wr-green-ghost border-wr-green text-wr-green'
                  : 'border-wr-border text-wr-muted hover:border-wr-green-dim hover:text-wr-green'}`}
              onClick={() => onAlertFilterChange(f)}
            >
              {f === 'C' ? 'CRIT' : f === 'H' ? 'HIGH' : f === 'M' ? 'MED' : f === 'PIN' ? '📌' : f}
            </button>
          ))}
        </div>

        {/* Alert feed */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {alerts.length === 0 ? (
            <div className="text-center text-wr-muted text-[9px] py-6 tracking-widest">
              No alerts triggered
            </div>
          ) : (
            alerts.slice(0, 80).map((a, i) => (
              <div
                key={i}
                className={`px-3 py-1.5 border-l-[3px] border-b border-wr-border/40 text-[9px] leading-relaxed animate-slide-in relative
                  ${a.level === 'critical' ? 'border-l-wr-red bg-wr-red/[.03]'
                    : a.level === 'high' ? 'border-l-wr-amber bg-wr-amber/[.02]'
                    : a.level === 'medium' ? 'border-l-wr-cyan'
                    : 'border-l-wr-muted'}
                  ${a.pinned ? '!border-l-wr-gold !bg-wr-gold/[.03]' : ''}`}
              >
                <button
                  className={`absolute right-1 top-1 text-[9px] cursor-pointer bg-transparent border-none text-wr-gold ${a.pinned ? 'opacity-90' : 'opacity-25 hover:opacity-90'}`}
                  onClick={() => onTogglePin(i)}
                >
                  {a.pinned ? '📌' : '📍'}
                </button>
                <span className="text-[7px] text-wr-muted block mb-0.5">{new Date(a.ts).toLocaleTimeString()}</span>
                <span className="text-wr-white">
                  <span className={`inline-block text-[7px] px-1 mr-1
                    ${a.tc === 'C' ? 'bg-wr-red/20 text-wr-red'
                      : a.tc === 'H' ? 'bg-wr-amber/20 text-wr-amber'
                      : a.tc === 'M' ? 'bg-wr-cyan/10 text-wr-cyan'
                      : 'bg-wr-green-ghost text-wr-green-dim'}`}
                  >{a.tc}</span>
                  <strong>{a.tag}</strong>: {a.text}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
