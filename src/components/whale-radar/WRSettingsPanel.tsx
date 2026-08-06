/* ══ WHALE RADAR v9 — SETTINGS PANEL ═════════════════════════════════════════
 *  v9.1: Added Hyperliquid Scanner settings group.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { fmtN } from '@/lib/whaleRadarState';
import { isHLConfigured } from '@/lib/hyperliquid';

interface WRSettingsPanelProps {
  apiKey: string; onApiKeyChange: (v: string) => void;
  aiKey: string; onAiKeyChange: (v: string) => void;
  birdKey: string; onBirdKeyChange: (v: string) => void;
  heliusKey: string; onHeliusKeyChange: (v: string) => void;
  theme: 'cyber' | 'matrix' | 'dark'; onThemeChange: (v: 'cyber' | 'matrix' | 'dark') => void;
  aggressiveMode: boolean; onAggressiveModeChange: (v: boolean) => void;
  whaleThr: number; onWhaleThrChange: (v: number) => void;
  // ── Hyperliquid ──
  hlScannerEnabled: boolean; onHlScannerEnabledChange: (v: boolean) => void;
  hlMegaTxUsd: number; onHlMegaTxUsdChange: (v: number) => void;
  supabaseUrl: string; onSupabaseUrlChange: (v: string) => void;
  supabaseAnonKey: string; onSupabaseAnonKeyChange: (v: string) => void;
  // ── Agent Council ──
  councilEnabled?: boolean; onCouncilEnabledChange?: (v: boolean) => void;
  councilProvider?: string; councilKey?: string; councilModel?: string; councilBaseUrl?: string;
  onCouncilLlmChange?: (patch: { provider?: string; apiKey?: string; model?: string; baseUrl?: string }) => void;
}

export function WRSettingsPanel({
  apiKey, onApiKeyChange,
  aiKey, onAiKeyChange,
  birdKey, onBirdKeyChange,
  heliusKey, onHeliusKeyChange,
  theme, onThemeChange,
  aggressiveMode, onAggressiveModeChange,
  whaleThr, onWhaleThrChange,
  hlScannerEnabled, onHlScannerEnabledChange,
  hlMegaTxUsd, onHlMegaTxUsdChange,
  supabaseUrl, onSupabaseUrlChange,
  supabaseAnonKey, onSupabaseAnonKeyChange,
  councilEnabled = true, onCouncilEnabledChange,
  councilProvider = 'lovable', councilKey = '', councilModel = '', councilBaseUrl = '',
  onCouncilLlmChange,
}: WRSettingsPanelProps) {
  const hlOk = isHLConfigured();

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

      {/* ── Hyperliquid Settings ─────────────────────────────────────────────── */}
      <SettingsGroup label="🔗 HYPERLIQUID SCANNER">
        <div className="flex gap-1.5 items-center">
          <button
            className={`wr-btn ${hlScannerEnabled ? 'active' : ''} cyan text-[8px]`}
            onClick={() => onHlScannerEnabledChange(!hlScannerEnabled)}
          >
            {hlScannerEnabled ? '● ON' : '○ OFF'}
          </button>
          <span className={`text-[8px] font-mono ${hlOk ? 'text-wr-cyan' : 'text-wr-amber'}`}>
            {hlOk ? '✓ Supabase connected' : '⚠ Set Supabase URL below'}
          </span>
        </div>
        <div className="flex gap-2 items-center mt-0.5">
          <span className="text-[8px] text-wr-muted">Mega TX ≥</span>
          <input
            type="range"
            className="w-16 accent-wr-cyan"
            min={100000}
            max={5000000}
            step={100000}
            value={hlMegaTxUsd}
            onChange={e => onHlMegaTxUsdChange(+e.target.value)}
          />
          <span className="text-[8px] text-wr-cyan">${fmtN(hlMegaTxUsd)}</span>
        </div>
        <Note cls="text-wr-muted">On-chain manipulation detector · 300ms poll</Note>
      </SettingsGroup>

      <SettingsGroup label="🗄 SUPABASE (HL CACHE)">
        <input
          className="wr-input text-[8px]"
          type="text"
          placeholder="https://xxxx.supabase.co"
          value={supabaseUrl}
          onChange={e => onSupabaseUrlChange(e.target.value)}
        />
        <input
          className="wr-input text-[8px] mt-1"
          type="password"
          placeholder="Supabase anon key (eyJ…)"
          value={supabaseAnonKey}
          onChange={e => onSupabaseAnonKeyChange(e.target.value)}
        />
        <Note cls={hlOk ? 'text-wr-cyan' : 'text-wr-muted'}>
          {hlOk ? '✓ HL cache active — 200 req/min server-side' : 'Required for Hyperliquid Explorer & Scanner'}
        </Note>
        <Note cls="text-wr-amber">Stored locally · Run: supabase functions deploy hyperliquid-cache</Note>
      </SettingsGroup>

      {/* ── Agent Council ────────────────────────────────────────────────── */}
      <SettingsGroup label="★ AGENT COUNCIL (AI DESK)">
        <div className="flex gap-1.5 items-center">
          <button
            className={`wr-btn ${councilEnabled ? 'active' : ''} ai text-[8px]`}
            onClick={() => onCouncilEnabledChange?.(!councilEnabled)}
          >
            {councilEnabled ? '● ON' : '○ OFF'}
          </button>
          <span className="text-[8px] font-mono text-wr-purple">
            {councilProvider === 'lovable' ? '✓ Built-in AI (no key)' : `${councilProvider} key`}
          </span>
        </div>
        <select
          className="wr-input text-[8px]"
          value={councilProvider}
          onChange={e => onCouncilLlmChange?.({ provider: e.target.value })}
        >
          <option value="lovable">Built-in (Lovable AI)</option>
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI</option>
          <option value="openrouter">OpenRouter</option>
          <option value="groq">Groq</option>
          <option value="custom">Custom OpenAI-compatible</option>
        </select>
        {councilProvider !== 'lovable' && (
          <>
            <input
              className="wr-input text-[8px]"
              type="password"
              placeholder="Provider API key"
              value={councilKey}
              onChange={e => onCouncilLlmChange?.({ apiKey: e.target.value })}
            />
            {councilProvider === 'custom' && (
              <input
                className="wr-input text-[8px]"
                type="text"
                placeholder="https://your-endpoint/v1"
                value={councilBaseUrl}
                onChange={e => onCouncilLlmChange?.({ baseUrl: e.target.value })}
              />
            )}
          </>
        )}
        <input
          className="wr-input text-[8px]"
          type="text"
          placeholder="Model (optional override)"
          value={councilModel}
          onChange={e => onCouncilLlmChange?.({ model: e.target.value })}
        />
        <Note cls="text-wr-muted">5-agent debate · memory + reflection per token</Note>
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
