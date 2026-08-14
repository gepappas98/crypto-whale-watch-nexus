/* ══ WHALE RADAR v9 — SETTINGS PANEL ═════════════════════════════════════════
 *  v9.1: Added Hyperliquid Scanner settings group.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { useState, useEffect } from 'react';
import { toast } from '@/hooks/use-toast';
import { fmtN } from '@/lib/whaleRadarState';
import { isHLConfigured } from '@/lib/hyperliquid';
import {
  getNotifyConfig, setNotifyConfig, sendTestNotification, type NotifyLevel,
} from '@/lib/notifyChannels';
import { isDryRun, setDryRun, isBotConnected, registerBot, unregisterBot } from '@/lib/nexus/bot';
import { RestBridgeBot } from '@/lib/nexus/restBridgeBot';
import { getStrategyTraderStatus, getStrategyTraderLocks, clearStrategyTraderLock, exitStrategyTraderPosition, type StrategyTraderStatus } from '@/lib/nexus/strategyTraderBridge';
import { getMaxOpenTrades, setMaxOpenTrades } from '@/lib/nexus/openTradesLimit';
import {
  getRemotePairListUrl, setRemotePairListUrl, fetchRemotePairList,
} from '@/lib/nexus/remotePairList';
import { useInstallPrompt, isStandalone, clearAppCache } from '@/lib/pwa';
import { enablePush, disablePush, getCurrentPushSubscription, sendTestPush } from '@/lib/pushBridge';

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

  // ── Alert notification channels (self-contained — see lib/notifyChannels.ts) ──
  const [notifyCfg, setNotifyCfgState] = useState(() => getNotifyConfig());
  const [testSent, setTestSent] = useState(false);
  const patchNotify = (patch: Parameters<typeof setNotifyConfig>[0]) => {
    setNotifyCfgState(setNotifyConfig(patch));
  };

  // ── Nexus Bot: dry-run, open-trade cap, remote pairlist (self-contained,
  // same pattern as notifyCfg above — see lib/nexus/bot.ts / openTradesLimit.ts / remotePairList.ts) ──
  const [dryRunOn, setDryRunOn] = useState(() => isDryRun());
  const [botConnected, setBotConnected] = useState(() => isBotConnected());
  const [botBusy, setBotBusy] = useState(false);
  const [botError, setBotError] = useState<string | null>(null);
  const [stStatus, setStStatus] = useState<StrategyTraderStatus | null>(null);
  const [stChecking, setStChecking] = useState(false);

  const checkStrategyTrader = () => {
    setStChecking(true);
    getStrategyTraderStatus()
      .then((s) => {
        setStStatus(s);
        if (s.configured && s.reachable) refreshLocks();
      })
      .catch((err) => setStStatus({ configured: false, reachable: false, error: (err as Error).message }))
      .finally(() => setStChecking(false));
  };
  useEffect(() => { checkStrategyTrader(); }, []);

  const [stLocks, setStLocks] = useState<Array<{ id: number; pair: string; lock_end_time: string; reason: string }>>([]);
  const [stLocksBusy, setStLocksBusy] = useState<number | null>(null); // lock id currently being cleared, if any
  const refreshLocks = () => {
    getStrategyTraderLocks()
      .then((r) => setStLocks(r.locks ?? []))
      .catch(() => setStLocks([])); // locks are supplementary info — a failed fetch shouldn't block the rest of the panel
  };
  const handleClearLock = (id: number) => {
    setStLocksBusy(id);
    clearStrategyTraderLock(id)
      .then(refreshLocks)
      .catch((err) => toast({ title: 'Could not clear lock', description: (err as Error).message, variant: 'destructive' }))
      .finally(() => setStLocksBusy(null));
  };
  const [stExitBusy, setStExitBusy] = useState<number | null>(null); // trade_id currently being closed, if any
  const handleExitTrade = (tradeId: number) => {
    setStExitBusy(tradeId);
    exitStrategyTraderPosition(tradeId)
      .then(() => {
        toast({ title: 'Exit sent', description: `Trade #${tradeId} — forceexit accepted` });
        checkStrategyTrader();
      })
      .catch((err) => toast({ title: 'Exit failed', description: (err as Error).message, variant: 'destructive' }))
      .finally(() => setStExitBusy(null));
  };
  const [maxOpen, setMaxOpen] = useState(() => getMaxOpenTrades());
  const [remoteUrl, setRemoteUrlState] = useState(() => getRemotePairListUrl() ?? '');
  const [remoteStatus, setRemoteStatus] = useState<string | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);

  const refreshRemotePairList = async () => {
    setRemoteBusy(true);
    setRemoteStatus(null);
    const result = await fetchRemotePairList({ forceRefresh: true });
    setRemoteBusy(false);
    if (result.error) {
      setRemoteStatus(`⚠ ${result.error}${result.source === 'cache' ? ' — using cached list' : ''}`);
    } else {
      setRemoteStatus(`✓ ${result.pairs.length} pairs loaded from remote`);
    }
  };

  // ── PWA install + cache (self-contained, same pattern as the others above) ──
  const { canInstall, isInstalled, promptInstall } = useInstallPrompt();
  const [cacheClearBusy, setCacheClearBusy] = useState(false);
  const handleClearCache = () => {
    setCacheClearBusy(true);
    clearAppCache()
      .then(() => toast({ title: 'Cache cleared', description: 'Reload the page to fetch a fresh copy.' }))
      .catch((err) => toast({ title: 'Could not clear cache', description: (err as Error).message, variant: 'destructive' }))
      .finally(() => setCacheClearBusy(false));
  };

  // ── Push notifications ──
  const [pushSub, setPushSub] = useState<PushSubscription | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  useEffect(() => {
    getCurrentPushSubscription().then(setPushSub).catch(() => setPushSub(null));
  }, []);
  const handleTogglePush = async () => {
    setPushBusy(true); setPushError(null);
    try {
      if (pushSub) {
        await disablePush();
        setPushSub(null);
      } else {
        const sub = await enablePush();
        setPushSub(sub);
        if (!sub) setPushError('Permission denied or push not supported in this browser');
      }
    } catch (e) {
      setPushError((e as Error)?.message ?? 'Push setup failed');
    } finally {
      setPushBusy(false);
    }
  };
  const [pushTestBusy, setPushTestBusy] = useState(false);
  const handleSendTestPush = () => {
    setPushTestBusy(true);
    sendTestPush()
      .then((r) => toast({ title: 'Test push sent', description: `Delivered to ${r.sent} subscription(s)${r.pruned ? `, pruned ${r.pruned} dead` : ''}` }))
      .catch((err) => toast({ title: 'Test push failed', description: (err as Error).message, variant: 'destructive' }))
      .finally(() => setPushTestBusy(false));
  };

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

      {/* ── Alert Notification Channels (Discord/Telegram) ──────────────────── */}
      <SettingsGroup label="📡 ALERT NOTIFICATIONS">
        <input
          className="wr-input text-[8px]"
          type="password"
          placeholder="Discord webhook URL"
          value={notifyCfg.discordWebhookUrl}
          onChange={e => patchNotify({ discordWebhookUrl: e.target.value })}
        />
        <input
          className="wr-input text-[8px] mt-1"
          type="password"
          placeholder="Telegram bot token"
          value={notifyCfg.telegramBotToken}
          onChange={e => patchNotify({ telegramBotToken: e.target.value })}
        />
        <input
          className="wr-input text-[8px] mt-1"
          type="text"
          placeholder="Telegram chat ID"
          value={notifyCfg.telegramChatId}
          onChange={e => patchNotify({ telegramChatId: e.target.value })}
        />
        <div className="flex gap-1.5 items-center mt-1">
          <span className="text-[8px] text-wr-muted">Min level</span>
          <select
            className="wr-input text-[8px] w-auto"
            value={notifyCfg.minLevel}
            onChange={e => patchNotify({ minLevel: e.target.value as NotifyLevel })}
          >
            <option value="info">INFO+</option>
            <option value="medium">MEDIUM+</option>
            <option value="high">HIGH+</option>
            <option value="critical">CRITICAL only</option>
          </select>
        </div>
        <button
          className="wr-btn text-[8px] mt-1"
          onClick={() => { sendTestNotification(); setTestSent(true); setTimeout(() => setTestSent(false), 2000); }}
        >
          {testSent ? '✓ SENT' : '▶ SEND TEST ALERT'}
        </button>
        <Note cls={notifyCfg.discordWebhookUrl || (notifyCfg.telegramBotToken && notifyCfg.telegramChatId) ? 'text-wr-green' : 'text-wr-muted'}>
          {notifyCfg.discordWebhookUrl || (notifyCfg.telegramBotToken && notifyCfg.telegramChatId)
            ? '✓ Alerts that clear the cooldown gate will also be pushed here'
            : 'Configure at least one channel to enable push alerts'}
        </Note>
        <Note cls="text-wr-amber">Stored in localStorage only — same as your other API keys.</Note>
      </SettingsGroup>

      <SettingsGroup label="🐋 NEXUS BOT">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[8px] text-wr-muted">Execution bridge</span>
          <button
            disabled={botBusy}
            className={`wr-btn text-[8px] px-2 ${botConnected ? 'text-wr-green border-wr-green' : ''}`}
            onClick={async () => {
              if (botConnected) { unregisterBot(); setBotConnected(false); setBotError(null); return; }
              // Preflight: the bridge is useless (and throws on every action)
              // unless the proxy has NEXUS_BOT_API_URL + API_AUTH_TOKEN set.
              setBotBusy(true); setBotError(null);
              const probe = new RestBridgeBot();
              try {
                await probe.getPortfolio();
                registerBot(probe);
                setBotConnected(true);
              } catch (e) {
                setBotError((e as Error)?.message ?? 'Bridge unreachable');
              } finally {
                setBotBusy(false);
              }
            }}
          >
            {botBusy ? '… CHECKING' : botConnected ? '● CONNECTED (RestBridgeBot)' : '○ CONNECT BOT'}
          </button>
        </div>
        <Note cls={botError ? 'text-wr-red' : 'text-wr-muted'}>
          {botError
            ? `Bridge not available — ${botError}`
            : botConnected
              ? 'Routes through supabase/functions/nexus-bot-proxy → your Express server → ccxt.'
              : 'No bot connected — grid/arbitrage/volume-maker actions will throw until you connect one.'}
        </Note>
        <div className="flex items-center justify-between gap-2 mt-1.5">
          <span className="text-[8px] text-wr-muted">Dry-run mode</span>
          <button
            className={`wr-btn text-[8px] px-2 ${dryRunOn ? 'text-wr-green border-wr-green' : ''}`}
            onClick={() => { const next = !dryRunOn; setDryRunOn(next); setDryRun(next); }}
          >
            {dryRunOn ? '● ON — no real orders' : '○ OFF — live trading'}
          </button>
        </div>
        <Note cls="text-wr-amber">Client-side only — the server enforces its own separate NEXUS_DRY_RUN flag independently.</Note>
        <div className="flex items-center gap-1.5 mt-1.5">
          <span className="text-[8px] text-wr-muted shrink-0">Max open trades</span>
          <input
            className="wr-input text-[8px] w-14"
            type="number"
            min={1}
            value={maxOpen}
            onChange={e => {
              const n = Math.max(1, parseInt(e.target.value, 10) || 1);
              setMaxOpen(n);
              setMaxOpenTrades(n);
            }}
          />
        </div>
        <input
          className="wr-input text-[8px] mt-1.5"
          type="text"
          placeholder="Remote pairlist JSON URL (optional)"
          value={remoteUrl}
          onChange={e => { setRemoteUrlState(e.target.value); setRemotePairListUrl(e.target.value || null); }}
        />
        <button
          className="wr-btn text-[8px] mt-1"
          disabled={!remoteUrl || remoteBusy}
          onClick={refreshRemotePairList}
        >
          {remoteBusy ? '▶ FETCHING…' : '▶ REFRESH REMOTE LIST'}
        </button>
        {remoteStatus && (
          <Note cls={remoteStatus.startsWith('✓') ? 'text-wr-green' : 'text-wr-amber'}>{remoteStatus}</Note>
        )}
        <Note>Dry-run and open-trade cap apply to Grid/Volume Maker executions across all Nexus pages.</Note>
      </SettingsGroup>

      <SettingsGroup label="🎯 STRATEGY TRADER (freqtrade)">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[8px] text-wr-muted">Bridge status</span>
          <button className="wr-btn text-[8px] px-2" onClick={checkStrategyTrader} disabled={stChecking}>
            {stChecking ? '▶ CHECKING…' : '↻ RECHECK'}
          </button>
        </div>
        {!stStatus ? (
          <Note cls="text-wr-muted">Checking…</Note>
        ) : !stStatus.configured ? (
          <Note cls="text-wr-muted">
            Not configured — set FREQTRADE_API_URL/USERNAME/PASSWORD on the Express server and NEXUS_BOT_API_URL/API_AUTH_TOKEN as Supabase secrets.
          </Note>
        ) : !stStatus.reachable ? (
          <Note cls="text-wr-amber">Configured but unreachable{stStatus.error ? `: ${stStatus.error}` : ''} — is freqtrade's api_server running?</Note>
        ) : (
          <>
            <Note cls="text-wr-green">
              ✓ Connected · freqtrade dry-run: {stStatus.freqtradeDryRun ? 'ON' : 'OFF'} · max trades {stStatus.maxOpenTrades} · {stStatus.stakeCurrency}
            </Note>
            {stStatus.profit && (
              <Note cls="text-wr-muted">
                Win rate {(stStatus.profit.winrate * 100).toFixed(1)}% · closed P/L {stStatus.profit.profit_closed_percent.toFixed(2)}%
              </Note>
            )}
            <div className="mt-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[8px] text-wr-muted">Open trades</span>
              </div>
              {!stStatus.openTrades || stStatus.openTrades.length === 0 ? (
                <Note cls="text-wr-muted">No open trades.</Note>
              ) : (
                <div className="mt-1 space-y-1">
                  {stStatus.openTrades.map((t) => (
                    <div key={t.trade_id} className="flex items-center justify-between gap-1.5 text-[8px] bg-wr-bg2 border border-wr-border px-1.5 py-1 rounded">
                      <div className="min-w-0">
                        <div className="text-wr-white truncate">#{t.trade_id} · {t.pair}</div>
                        <div className={`truncate ${t.profit_ratio >= 0 ? 'text-wr-green' : 'text-wr-red'}`}>
                          {(t.profit_ratio * 100).toFixed(2)}%
                        </div>
                      </div>
                      <button
                        className="wr-btn text-[7px] px-1.5 shrink-0"
                        disabled={stExitBusy === t.trade_id}
                        onClick={() => handleExitTrade(t.trade_id)}
                        title="Force-exit this position via freqtrade's forceexit"
                      >
                        {stExitBusy === t.trade_id ? '…' : 'EXIT'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[8px] text-wr-muted">freqtrade's own pair locks</span>
                <button className="wr-btn text-[7px] px-1.5" onClick={refreshLocks}>↻</button>
              </div>
              {stLocks.length === 0 ? (
                <Note cls="text-wr-muted">No active locks.</Note>
              ) : (
                <div className="mt-1 space-y-1">
                  {stLocks.map((lock) => (
                    <div key={lock.id} className="flex items-center justify-between gap-1.5 text-[8px] bg-wr-bg2 border border-wr-border px-1.5 py-1 rounded">
                      <div className="min-w-0">
                        <div className="text-wr-white truncate">{lock.pair}</div>
                        <div className="text-wr-muted truncate" title={lock.reason}>
                          {lock.reason} · until {new Date(lock.lock_end_time).toLocaleTimeString()}
                        </div>
                      </div>
                      <button
                        className="wr-btn text-[7px] px-1.5 shrink-0"
                        disabled={stLocksBusy === lock.id}
                        onClick={() => handleClearLock(lock.id)}
                      >
                        {stLocksBusy === lock.id ? '…' : 'CLEAR'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        <Note cls="text-wr-muted">
          Manually forward a CRITICAL alert via the 🎯 button in the alert feed — never sent automatically. Server enforces a 50% ML-confidence floor and its own cooldown lock, independent of freqtrade's own protections.
        </Note>
      </SettingsGroup>

      <SettingsGroup label="📲 APP">
        {isInstalled ? (
          <Note cls="text-wr-green">✓ Installed — running standalone</Note>
        ) : canInstall ? (
          <button className="wr-btn text-[8px]" onClick={() => promptInstall()}>📲 ADD TO HOME SCREEN</button>
        ) : (
          <Note cls="text-wr-muted">Install prompt not offered by this browser (Safari/Firefox never fire it) or already dismissed.</Note>
        )}
        <button className="wr-btn text-[8px] mt-1" disabled={cacheClearBusy} onClick={handleClearCache}>
          {cacheClearBusy ? '▶ CLEARING…' : '🗑 CLEAR APP CACHE'}
        </button>
        <Note cls="text-wr-muted">If the app looks stuck on an old version after a deploy, clear cache then reload.</Note>
      </SettingsGroup>

      <SettingsGroup label="🔔 PUSH NOTIFICATIONS">
        <button className={`wr-btn text-[8px] ${pushSub ? 'active text-wr-green border-wr-green' : ''}`} disabled={pushBusy} onClick={handleTogglePush}>
          {pushBusy ? '▶ …' : pushSub ? '● ENABLED' : '○ ENABLE PUSH'}
        </button>
        {pushError && <Note cls="text-wr-red">{pushError}</Note>}
        {pushSub && (
          <button className="wr-btn text-[8px] mt-1" disabled={pushTestBusy} onClick={handleSendTestPush}>
            {pushTestBusy ? '▶ SENDING…' : '▶ SEND TEST PUSH'}
          </button>
        )}
        <Note cls="text-wr-muted">Delivered via the browser's Push API even when this tab is closed. Requires the server's VAPID keys to be configured — see .env.example.</Note>
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
