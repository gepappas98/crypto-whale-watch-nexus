/* ══ WHALE RADAR v9 — ADVANCED FILTERS (v4 Multi-Token + Search + Recent) ═══
 *  Multi-select tokens • Searchable • Recent (localStorage) • Stable vs Alt split
 * ═══════════════════════════════════════════════════════════════════════════ */
import { useCallback, useMemo, useState, useEffect } from 'react';

export interface WhaleFilters {
  minThreshold: number;
  chain: string;
  txType: string;
  token: string[];              // [] = all tokens
}

export const DEFAULT_FILTERS: WhaleFilters = {
  minThreshold: 0,
  chain: 'all',
  txType: 'all',
  token: [],
};

// Σταθερές
const THRESHOLDS = [ /* ίδιο όπως πριν */ ] as const;
const CHAINS = [ /* ίδιο όπως πριν */ ] as const;
const TX_TYPES = [ /* ίδιο όπως πριν */ ] as const;

const STABLE_TOKENS = [
  { value: 'USDT', label: 'USDT' },
  { value: 'USDC', label: 'USDC' },
] as const;

const ALT_TOKENS = [
  { value: 'BTC', label: 'BTC' },
  { value: 'ETH', label: 'ETH' },
  { value: 'SOL', label: 'SOL' },
  { value: 'BNB', label: 'BNB' },
  { value: 'DOGE', label: 'DOGE' },
  { value: 'XRP', label: 'XRP' },
  { value: 'TON', label: 'TON' },
  { value: 'SUI', label: 'SUI' },
  { value: 'AVAX', label: 'AVAX' },
  { value: 'ADA', label: 'ADA' },
  { value: 'LINK', label: 'LINK' },
  { value: 'SHIB', label: 'SHIB' },
  { value: 'PEPE', label: 'PEPE' },
  { value: 'BONK', label: 'BONK' },
  { value: 'WIF', label: 'WIF' },
  { value: 'TRUMP', label: 'TRUMP' },
  { value: 'JUP', label: 'JUP' },
  { value: 'POPCAT', label: 'POPCAT' },
  { value: 'MOODENG', label: 'MOODENG' },
  { value: 'FARTCOIN', label: 'FARTCOIN' },
] as const;

interface WRAdvancedFiltersProps {
  filters: WhaleFilters;
  onChange: (filters: WhaleFilters) => void;
  compact?: boolean;
}

export function WRAdvancedFilters({ filters, onChange, compact = false }: WRAdvancedFiltersProps) {
  const update = useCallback((patch: Partial<WhaleFilters>) => {
    onChange({ ...filters, ...patch });
  }, [filters, onChange]);

  // Token states
  const [searchTerm, setSearchTerm] = useState('');
  const [customInput, setCustomInput] = useState('');
  const [recentTokens, setRecentTokens] = useState<string[]>([]);

  // Load recent from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('wr-recent-tokens');
    if (saved) setRecentTokens(JSON.parse(saved));
  }, []);

  const saveToRecent = useCallback((token: string) => {
    if (!token) return;
    const updated = [token, ...recentTokens.filter(t => t !== token)].slice(0, 8);
    setRecentTokens(updated);
    localStorage.setItem('wr-recent-tokens', JSON.stringify(updated));
  }, [recentTokens]);

  const toggleToken = useCallback((token: string) => {
    const newTokens = filters.token.includes(token)
      ? filters.token.filter(t => t !== token)
      : [...filters.token, token];
    update({ token: newTokens });
  }, [filters.token, update]);

  const addCustomToken = useCallback(() => {
    const trimmed = customInput.trim().toUpperCase();
    if (!trimmed) return;
    if (!filters.token.includes(trimmed)) {
      update({ token: [...filters.token, trimmed] });
    }
    saveToRecent(trimmed);
    setCustomInput('');
  }, [customInput, filters.token, update, saveToRecent]);

  const isDefault = useMemo(() => 
    filters.minThreshold === 0 && 
    filters.chain === 'all' && 
    filters.txType === 'all' && 
    filters.token.length === 0,
    [filters]
  );

  const btnCls = (active: boolean) =>
    `text-[8px] px-1.5 py-0.5 border cursor-pointer font-mono tracking-widest transition-all min-h-[28px] min-w-[28px] rounded-md
     ${active ? 'bg-wr-green-ghost border-wr-green text-wr-green shadow-inner' : 'border-wr-border text-wr-muted hover:border-wr-green-dim hover:text-wr-green hover:bg-wr-green-ghost/30'}`;

  // ===================== COMPACT MODE =====================
  if (compact) {
    const selectedToken = filters.token.length > 0 ? filters.token[0] : 'all';
    return (
      <div className="flex gap-1 items-center flex-wrap">
        {/* ... ίδια selects για minThreshold, chain, txType όπως πριν ... */}
        <select
          className="wr-input text-[8px] h-7 py-0 px-2 min-w-[70px] bg-wr-bg border-wr-border text-wr-white rounded-md"
          value={selectedToken}
          onChange={e => update({ token: e.target.value === 'all' ? [] : [e.target.value] })}
          aria-label="Token"
        >
          <option value="all">ALL TOKENS</option>
          {[...STABLE_TOKENS, ...ALT_TOKENS].map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>
    );
  }

  // ===================== FULL MODE =====================
  return (
    <div className="space-y-4 p-3 bg-wr-bg border border-wr-border rounded-xl">
      {/* Min Threshold, Chain, TX Type — ίδια όπως v3 */}

      {/* TOKEN FILTER — MULTI SELECT */}
      <div>
        <div className="text-[7px] text-wr-muted tracking-[0.2em] mb-2 font-medium flex justify-between items-baseline">
          <span>TOKENS (multi-select)</span>
          {filters.token.length > 0 && (
            <span className="text-xs bg-wr-green/10 text-wr-green px-2 py-px rounded">
              {filters.token.length} selected
            </span>
          )}
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search tokens..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="wr-input w-full text-[10px] h-8 font-mono bg-wr-bg border-wr-border text-wr-white rounded-md px-3 mb-3"
        />

        {/* Selected chips */}
        {filters.token.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {filters.token.map(t => (
              <div
                key={t}
                className="flex items-center gap-1 bg-wr-green-ghost text-wr-green text-[9px] font-mono px-2.5 py-1 rounded-md"
              >
                {t}
                <button
                  onClick={() => toggleToken(t)}
                  className="ml-1 text-wr-green hover:text-red-400 text-base leading-none"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Recent */}
        {recentTokens.length > 0 && (
          <div className="mb-3">
            <div className="text-[7px] text-wr-muted mb-1">RECENT</div>
            <div className="flex gap-1 flex-wrap">
              {recentTokens.map(t => (
                <button
                  key={t}
                  className={btnCls(filters.token.includes(t))}
                  onClick={() => toggleToken(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Stablecoins */}
        <div className="mb-3">
          <div className="text-[7px] text-wr-muted mb-1">STABLECOINS</div>
          <div className="flex gap-1 flex-wrap">
            {STABLE_TOKENS
              .filter(t => t.label.toLowerCase().includes(searchTerm.toLowerCase()))
              .map(t => (
                <button
                  key={t.value}
                  className={btnCls(filters.token.includes(t.value))}
                  onClick={() => toggleToken(t.value)}
                >
                  {t.label}
                </button>
              ))}
          </div>
        </div>

        {/* Altcoins & Memes */}
        <div>
          <div className="text-[7px] text-wr-muted mb-1">ALTCOINS &amp; MEMES</div>
          <div className="flex gap-1 flex-wrap">
            {ALT_TOKENS
              .filter(t => t.label.toLowerCase().includes(searchTerm.toLowerCase()))
              .map(t => (
                <button
                  key={t.value}
                  className={btnCls(filters.token.includes(t.value))}
                  onClick={() => toggleToken(t.value)}
                >
                  {t.label}
                </button>
              ))}
          </div>
        </div>

        {/* Custom Token */}
        <div className="mt-4 flex items-center gap-2">
          <span className="text-[8px] text-wr-muted font-mono whitespace-nowrap">CUSTOM:</span>
          <input
            type="text"
            placeholder="MOODENG or NEW"
            value={customInput}
            onChange={e => setCustomInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addCustomToken()}
            className="wr-input flex-1 text-[10px] h-8 font-mono bg-wr-bg border-wr-border text-wr-white rounded-md px-2 uppercase"
            maxLength={12}
          />
          <button
            onClick={addCustomToken}
            className="text-[8px] px-4 py-1 bg-wr-green text-black font-medium rounded-md hover:brightness-110 transition"
          >
            ADD
          </button>
        </div>
      </div>

      {/* Reset Button */}
      {!isDefault && (
        <button
          onClick={() => onChange(DEFAULT_FILTERS)}
          className="w-full mt-2 text-[9px] py-1.5 border border-wr-border hover:border-red-500 hover:text-red-400 text-wr-muted font-mono tracking-widest transition-all rounded-lg"
        >
          RESET ALL FILTERS
        </button>
      )}
    </div>
  );
}