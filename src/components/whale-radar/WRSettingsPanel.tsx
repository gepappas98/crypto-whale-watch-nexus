/* ══ WHALE RADAR v9 — SETTINGS PANEL ═════════════════════════════════════════ */
import { fmtN } from '@/lib/whaleRadarState';

interface WRSettingsPanelProps {
  apiKey: string; onApiKeyChange: (v: string) => void;
  aiKey: string; onAiKeyChange: (v: string) => void;
  birdKey: string; onBirdKeyChange: (v: string) => void;
  heliusKey: string; onHeliusKeyChange: (v: string) => void;
  theme: 'cyber' | 'matrix' | 'dark'; onThemeChange: (v: 'cyber' | 'matrix' | 'dark') => void;
  aggressiveMode: boolean; onAggressiveModeChange: (v: boolean) => void;
  whaleThr: number; onWhaleThrChange: (v: number) => void;
}

export function WRSettingsPanel({
  apiKey, onApiKeyChange,
  aiKey, onAiKeyChange,
  birdKey, onBirdKeyChange,
  heliusKey, onHeliusKeyChange,
  theme, onThemeChange,
  aggressiveMode, onAggressiveModeChange,
  whaleThr, onWhaleThrChange,
}: WRSettingsPanelProps) {
  return (
    <div className="flex flex-wrap gap-4 p-4 bg-wr-bg3 border-b-2 border-wr-amber/60 items-start animate-slide-in">
      {/* CoinGecko API */}
      <SettingsGroup label="COINGECKO PRO API KEY">
        <input className="wr-input" type="password" placeholder="CG Pro key…" value={apiKey} onChange={e => onApiKeyChange(e.target.value)} />
        <Note cls={apiKey ? 'text-wr-green' : ''}>
          {apiKey ? '✓ Pro key set' : 'Free tier: ~30 req/min · 10K/month'}
        </Note>
        <Note cls="text-wr-amber">Stored in localStorage only.</Note>
      </SettingsGroup>

      {/* AI */}
      <SettingsGroup label="🤖 AI ANALYSIS (CLAUDE)">
        <input className="wr-input" type="password" placeholder="Anthropic key (sk-ant-…)" value={aiKey} onChange={e => onAiKeyChange(e.target.value)} />
        <Note cls={aiKey ? 'text-wr-purple' : ''}>
          {aiKey ? '✓ Claude key set — AI enabled' : 'Enter key to enable AI analysis'}
        </Note>
        <Note cls="text-wr-amber">claude-haiku · ~$0.001/call</Note>
      </SettingsGroup>

      {/* Birdeye */}
      <SettingsGroup label="◎ BIRDEYE API KEY">
        <input className="wr-input" type="password" placeholder="Birdeye key (free tier ok)" value={birdKey} onChange={e => onBirdKeyChange(e.target.value)} />
        <Note cls={birdKey ? 'text-wr-sol' : 'text-wr-sol'}>
          {birdKey ? '✓ Birdeye key set — Solana on-chain ENABLED' : 'Enter key for Solana on-chain intelligence'}
        </Note>
      </SettingsGroup>

      {/* Helius */}
      <SettingsGroup label="◎ HELIUS RPC KEY">
        <input className="wr-input" type="password" placeholder="Helius API key (free tier)" value={heliusKey} onChange={e => onHeliusKeyChange(e.target.value)} />
        <Note cls={heliusKey ? 'text-wr-sol' : 'text-wr-sol'}>
          {heliusKey ? '✓ Helius key set — Wallet tracking ENABLED' : 'Enter key for real-time wallet tracking'}
        </Note>
        <Note cls="text-wr-muted">helius.dev → free tier available</Note>
      </SettingsGroup>

      {/* Scan Mode */}
      <SettingsGroup label="SCAN MODE">
        <div className="flex gap-1.5">
          <button className={`wr-btn ${!aggressiveMode ? 'active' : ''}`} onClick={() => onAggressiveModeChange(false)}>● NORMAL 5min</button>
          <button className={`wr-btn amber ${aggressiveMode ? 'active' : ''}`} onClick={() => onAggressiveModeChange(true)}>⚡ AGG 3min</button>
        </div>
        <Note>Aggressive uses 3× quota/day</Note>
      </SettingsGroup>

      {/* Whale Threshold */}
      <SettingsGroup label="WHALE THRESHOLD">
        <div className="flex gap-2 items-center">
          <input type="range" className="w-20 accent-wr-green" min={50000} max={1000000} step={50000} value={whaleThr} onChange={e => onWhaleThrChange(+e.target.value)} />
          <span className="text-[10px] text-wr-amber">${fmtN(whaleThr)}</span>
        </div>
        <Note>Min trade size to flag as whale</Note>
      </SettingsGroup>

      {/* Theme */}
      <SettingsGroup label="THEME">
        <div className="flex gap-1.5">
          {(['cyber', 'matrix', 'dark'] as const).map(t => (
            <button key={t} className={`wr-btn ${theme === t ? 'active' : ''}`} onClick={() => onThemeChange(t)}>
              {t.toUpperCase()}
            </button>
          ))}
        </div>
      </SettingsGroup>
    </div>
  );
}

function SettingsGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-[190px]">
      <div className="text-[8px] text-wr-green-dim tracking-[2px] pb-0.5 border-b border-wr-border">{label}</div>
      {children}
    </div>
  );
}

function Note({ children, cls = '' }: { children: React.ReactNode; cls?: string }) {
  return <div className={`text-[8px] text-wr-muted tracking-widest leading-relaxed ${cls}`}>{children}</div>;
}
