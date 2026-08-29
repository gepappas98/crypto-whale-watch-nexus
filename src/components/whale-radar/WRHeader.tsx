/* ══ WHALE RADAR v9 — HEADER ═════════════════════════════════════════════════ */
import { Link } from 'react-router-dom';
import { useInstallPrompt } from '@/lib/pwa';

interface WRHeaderProps {
  scanCount: number;
  alertCount: number;
  nextScan: string;
  aiCallCount: number;
  scanning: boolean;
  soundOn: boolean;
  onToggleSound: () => void;
  onToggleSettings: () => void;
  onToggleKbd: () => void;
}

export function WRHeader({
  scanCount, alertCount, nextScan, aiCallCount, scanning,
  soundOn, onToggleSound, onToggleSettings, onToggleKbd,
}: WRHeaderProps) {
  const { canInstall, promptInstall } = useInstallPrompt();
  return (
    <header className="flex items-center gap-3 px-4 py-2.5 border-b border-wr-border bg-wr-bg2 sticky top-0 z-[100]">
      {/* Radar icon */}
      <div className="w-10 h-10 flex-shrink-0">
        <svg viewBox="0 0 42 42" fill="none" className="w-full h-full">
          <circle cx="21" cy="21" r="19" stroke="hsl(var(--wr-border))" strokeWidth="1" />
          <circle cx="21" cy="21" r="13" stroke="hsl(var(--wr-border))" strokeWidth="1" />
          <circle cx="21" cy="21" r="7" stroke="hsl(var(--wr-border))" strokeWidth="1" />
          <circle cx="21" cy="21" r="2.5" fill="hsl(var(--wr-green))" opacity=".9" />
          <g className="animate-sweep" style={{ transformOrigin: '21px 21px' }}>
            <path d="M21 21 L21 2" stroke="url(#sg9)" strokeWidth="1.5" opacity=".9" />
            <defs>
              <linearGradient id="sg9" x1="21" y1="21" x2="21" y2="2" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="hsl(var(--wr-green))" stopOpacity="0" />
                <stop offset="100%" stopColor="hsl(var(--wr-green))" stopOpacity=".9" />
              </linearGradient>
            </defs>
          </g>
          <circle className="animate-rpulse" cx="21" cy="21" r="3" fill="none" stroke="hsl(var(--wr-green))" strokeWidth="1" />
        </svg>
      </div>

      {/* Title */}
      <div>
        <h1 className="font-head text-base font-black text-wr-green tracking-[4px]" style={{ textShadow: '0 0 20px hsl(var(--wr-green) / .5)' }}>
          WHALE RADAR
        </h1>
        <p className="text-[9px] text-wr-green-dim tracking-[2px] mt-0.5">
          MARKET MANIPULATION DETECTION v9.0 — AI · ON-CHAIN · SOLANA
        </p>
      </div>

      {/* Stats */}
      <div className="flex gap-3 items-center ml-auto flex-wrap wr-header-stats">
        <HeaderStat label="SCANNING" value={scanCount > 0 ? `${scanCount} TOKENS` : '—'} live={scanCount > 0} />
        <HeaderStat label="ALERTS" value={String(alertCount)} />
        <HeaderStat label="NEXT SCAN" value={nextScan} />
        <HeaderStat label="AI CALLS" value={String(aiCallCount)} color="purple" />
        {/* Grouped terminals — reduces header clutter */}
        <div className="relative group">
          <button
            type="button"
            className="text-[10px] tracking-[2px] px-2 py-1 rounded border border-wr-green/40 text-wr-green hover:bg-wr-green/10 transition-colors bg-transparent cursor-pointer"
            title="Trading terminals"
            aria-haspopup="true"
          >
            TERMINALS ▾
          </button>
          <div className="absolute right-0 top-full mt-1 hidden group-hover:flex group-focus-within:flex flex-col min-w-[160px] rounded border border-wr-border bg-wr-bg2 shadow-lg z-[120]">
            <Link
              to="/trading-hub"
              className="text-[10px] tracking-[1px] px-3 py-2 text-primary hover:bg-primary/10 border-b border-wr-border/50"
            >
              Trading Hub
              <span className="block text-[8px] text-wr-muted tracking-normal">TA · Backtest · Screener</span>
            </Link>
            <Link
              to="/nexus"
              className="text-[10px] tracking-[1px] px-3 py-2 text-wr-green hover:bg-wr-green/10 border-b border-wr-border/50"
            >
              Nexus
              <span className="block text-[8px] text-wr-muted tracking-normal">HL · Arb · Grid · Bot</span>
            </Link>
            <Link
              to="/orderflow"
              className="text-[10px] tracking-[1px] px-3 py-2 text-wr-white hover:bg-wr-bg3"
            >
              Orderflow
              <span className="block text-[8px] text-wr-muted tracking-normal">Depth · Liquidations</span>
            </Link>
          </div>
        </div>
        {canInstall && (
          <button
            className="text-[10px] tracking-[2px] px-2 py-1 rounded border border-wr-amber/40 text-wr-amber hover:bg-wr-amber/10 transition-colors bg-transparent cursor-pointer"
            onClick={() => promptInstall()}
            title="Add Whale Radar to your home screen"
          >
            📲 INSTALL
          </button>
        )}


        <button
          className="text-sm opacity-60 hover:opacity-100 transition-opacity p-1 bg-transparent border-none cursor-pointer"
          onClick={onToggleSound}
          title="Sound [M]"
          aria-label={soundOn ? 'Mute sound' : 'Unmute sound'}
        >
          {soundOn ? '🔊' : '🔇'}
        </button>
        <button
          className="text-sm opacity-60 hover:opacity-100 transition-opacity p-1 bg-transparent border-none cursor-pointer"
          onClick={onToggleKbd}
          title="Shortcuts [?]"
          aria-label="Keyboard shortcuts"
        >
          ⌨
        </button>
        <button
          className="text-sm opacity-60 hover:opacity-100 transition-opacity p-1 bg-transparent border-none cursor-pointer"
          onClick={onToggleSettings}
          title="Settings ⚙"
          aria-label="Settings"
        >
          ⚙
        </button>
        <div className="w-2 h-2 rounded-full bg-wr-green animate-blink" style={{ boxShadow: '0 0 8px hsl(var(--wr-green))' }} />
      </div>
    </header>
  );
}

function HeaderStat({ label, value, live, color }: { label: string; value: string; live?: boolean; color?: string }) {
  return (
    <div className="text-right wr-stat">
      <div className="text-[8px] text-wr-muted tracking-widest">{label}</div>
      <div className={`text-xs ${live ? 'text-wr-green' : color === 'purple' ? 'text-wr-purple' : 'text-wr-white'}`}>
        {value}
      </div>
    </div>
  );
}
