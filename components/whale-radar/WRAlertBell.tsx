/* ══ WHALE RADAR v9 — CUSTOM ALERT BELL ══════════════════════════════════════
 *  Bell icon for user-defined alerts with browser push notification support.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { WhaleTrade } from '@/lib/whaleRadarState';

export interface CustomAlert {
  id: string;
  token: string;       // e.g. "USDC", "BTC", or "*" for any
  chain: string;       // e.g. "ethereum", "all"
  minAmount: number;   // USD threshold
  enabled: boolean;
  triggeredCount: number;
}

interface WRAlertBellProps {
  whaleFeed: WhaleTrade[];
  onTriggered?: (alert: CustomAlert, trade: WhaleTrade) => void;
}

const STORE_KEY = 'wr_custom_alerts';

function loadAlerts(): CustomAlert[] {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; }
}
function saveAlerts(alerts: CustomAlert[]) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(alerts)); } catch { /* ignore */ }
}

async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

function sendBrowserNotification(title: string, body: string) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '🐳', tag: 'whale-alert' });
  }
}

export function WRAlertBell({ whaleFeed, onTriggered }: WRAlertBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [alerts, setAlerts] = useState<CustomAlert[]>(loadAlerts);
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [newToken, setNewToken] = useState('');
  const [newAmount, setNewAmount] = useState('1000000');
  const [newChain, setNewChain] = useState('all');
  const lastCheckedIdx = useRef(0);
  const [unreadCount, setUnreadCount] = useState(0);

  // Check notification permission
  useEffect(() => {
    if ('Notification' in window) {
      setNotifEnabled(Notification.permission === 'granted');
    }
  }, []);

  // Save alerts on change
  useEffect(() => { saveAlerts(alerts); }, [alerts]);

  // Check whale feed against custom alerts
  useEffect(() => {
    if (whaleFeed.length <= lastCheckedIdx.current) return;
    const newTrades = whaleFeed.slice(0, whaleFeed.length - lastCheckedIdx.current);
    lastCheckedIdx.current = whaleFeed.length;

    const enabledAlerts = alerts.filter(a => a.enabled);
    if (!enabledAlerts.length) return;

    newTrades.forEach(trade => {
      enabledAlerts.forEach(alert => {
        const tokenMatch = alert.token === '*' || trade.sym.toUpperCase() === alert.token.toUpperCase();
        const amountMatch = trade.usdt >= alert.minAmount;
        if (tokenMatch && amountMatch) {
          setUnreadCount(c => c + 1);
          setAlerts(prev => prev.map(a =>
            a.id === alert.id ? { ...a, triggeredCount: a.triggeredCount + 1 } : a
          ));
          const msg = `🐳 ${trade.sym} ${trade.side} $${(trade.usdt / 1e6).toFixed(2)}M`;
          toast.success(msg, { duration: 5000, id: `alert-${alert.id}-${trade.ts}` });
          if (notifEnabled) {
            sendBrowserNotification('Whale Alert', msg);
          }
          onTriggered?.(alert, trade);
        }
      });
    });
  }, [whaleFeed.length, alerts, notifEnabled, onTriggered]);

  const handleEnableNotifs = useCallback(async () => {
    const granted = await requestNotificationPermission();
    setNotifEnabled(granted);
    if (granted) toast.success('Browser notifications enabled');
    else toast.error('Notification permission denied');
  }, []);

  const handleAddAlert = useCallback(() => {
    const token = newToken.trim().toUpperCase() || '*';
    const amount = parseInt(newAmount) || 1_000_000;
    const id = `ca_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setAlerts(prev => [...prev, { id, token, chain: newChain, minAmount: amount, enabled: true, triggeredCount: 0 }]);
    setNewToken('');
    setNewAmount('1000000');
    toast.success(`Alert added: ${token === '*' ? 'ANY token' : token} > $${(amount / 1e6).toFixed(1)}M`);
  }, [newToken, newAmount, newChain]);

  const toggleAlert = useCallback((id: string) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, enabled: !a.enabled } : a));
  }, []);

  const removeAlert = useCallback((id: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  }, []);

  return (
    <div className="relative">
      <button
        className="wr-btn text-[9px] px-2 py-1 relative"
        onClick={() => { setIsOpen(p => !p); setUnreadCount(0); }}
        title="Custom Alerts"
      >
        🔔
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-wr-red text-[7px] text-wr-white flex items-center justify-center animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-wr-bg2 border border-wr-border shadow-lg z-50 max-h-96 overflow-y-auto scrollbar-thin">
          <div className="wr-panel-header">
            <span className="wr-panel-title text-[8px]">🔔 CUSTOM ALERTS</span>
            <button
              className={`text-[7px] px-1.5 py-0.5 border cursor-pointer font-mono ${notifEnabled ? 'border-wr-green text-wr-green' : 'border-wr-border text-wr-muted'}`}
              onClick={handleEnableNotifs}
            >
              {notifEnabled ? '🔔 ON' : '🔕 OFF'}
            </button>
          </div>

          {/* Add new alert */}
          <div className="p-2 border-b border-wr-border space-y-1.5">
            <div className="flex gap-1">
              <input
                className="wr-input flex-1 text-[9px]"
                placeholder="Token (e.g. USDC, * for any)"
                value={newToken}
                onChange={e => setNewToken(e.target.value)}
              />
              <select
                className="wr-input text-[8px] w-16 bg-wr-bg border-wr-border text-wr-white"
                value={newChain}
                onChange={e => setNewChain(e.target.value)}
              >
                <option value="all">ALL</option>
                <option value="ethereum">ETH</option>
                <option value="solana">SOL</option>
                <option value="bsc">BSC</option>
              </select>
            </div>
            <div className="flex gap-1">
              <select
                className="wr-input flex-1 text-[8px] bg-wr-bg border-wr-border text-wr-white"
                value={newAmount}
                onChange={e => setNewAmount(e.target.value)}
              >
                <option value="100000">{'>'} $100K</option>
                <option value="500000">{'>'} $500K</option>
                <option value="1000000">{'>'} $1M</option>
                <option value="5000000">{'>'} $5M</option>
                <option value="10000000">{'>'} $10M</option>
              </select>
              <button className="wr-btn text-[8px]" onClick={handleAddAlert}>+ ADD</button>
            </div>
          </div>

          {/* Alert list */}
          <div className="max-h-48 overflow-y-auto">
            {alerts.length === 0 ? (
              <div className="text-center text-wr-muted text-[9px] py-4 tracking-widest px-2">
                No custom alerts set.<br />Add one above to get notified.
              </div>
            ) : (
              alerts.map(a => (
                <div key={a.id} className="px-2 py-1.5 border-b border-wr-border/40 flex items-center gap-2 text-[9px]">
                  <button
                    className={`w-5 h-5 flex items-center justify-center border cursor-pointer transition-all ${a.enabled ? 'border-wr-green text-wr-green bg-wr-green-ghost' : 'border-wr-border text-wr-muted'}`}
                    onClick={() => toggleAlert(a.id)}
                  >
                    {a.enabled ? '✓' : '○'}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-wr-white truncate">
                      {a.token === '*' ? 'ANY' : a.token} {'>'} ${(a.minAmount / 1e6).toFixed(1)}M
                    </div>
                    <div className="text-[7px] text-wr-muted">
                      {a.chain.toUpperCase()} · {a.triggeredCount} triggers
                    </div>
                  </div>
                  <button
                    className="wr-btn red text-[7px] px-1 py-0 min-h-[22px] min-w-[22px]"
                    onClick={() => removeAlert(a.id)}
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
