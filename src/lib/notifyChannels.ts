/* ══ WHALE RADAR — MULTI-CHANNEL ALERT NOTIFIER ═══════════════════════════════
 *
 *  Ported concept from freqtrade's rpc/webhook.py + rpc/telegram.py: freqtrade
 *  keeps one internal event (a trade fill, a stoploss hit) and fans it out to
 *  whichever channels the user configured (Telegram, Discord, generic
 *  webhook) without the strategy code knowing or caring which channels exist.
 *
 *  Here the "event" is a manipulation alert that already passed
 *  lib/alertCooldown.ts. dispatchNotification() is the fan-out point —
 *  call it once per alert, it silently no-ops for any channel that isn't
 *  configured.
 *
 *  SECURITY NOTE: like the app's existing aiKey/birdKey/apiKey fields, the
 *  Telegram bot token and Discord webhook URL are stored in localStorage and
 *  called directly from the browser. That matches this app's existing trust
 *  model (client-side, single-user, keys never leave the browser except to
 *  their respective APIs) but means anyone with access to the browser/device
 *  can read them. Don't reuse a bot token that has access to anything else.
 *
 *  Nothing here is copied from freqtrade's source — only the "one event,
 *  many channels, missing config = silent no-op" pattern is re-implemented.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type NotifyLevel = 'critical' | 'high' | 'medium' | 'info';

export interface NotifyConfig {
  discordWebhookUrl: string;
  telegramBotToken: string;
  telegramChatId: string;
  /** Only alerts at or above this severity get sent out. */
  minLevel: NotifyLevel;
}

const STORE_KEY = 'wr_notify_config';

const LEVEL_RANK: Record<NotifyLevel, number> = {
  info: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export const DEFAULT_NOTIFY_CONFIG: NotifyConfig = {
  discordWebhookUrl: '',
  telegramBotToken: '',
  telegramChatId: '',
  minLevel: 'high',
};

// ── Config persistence (mirrors the app's existing localStorage-key-store pattern) ──

export function getNotifyConfig(): NotifyConfig {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...DEFAULT_NOTIFY_CONFIG, ...(JSON.parse(raw) as Partial<NotifyConfig>) };
  } catch {
    // fall through to default
  }
  return DEFAULT_NOTIFY_CONFIG;
}

export function setNotifyConfig(patch: Partial<NotifyConfig>): NotifyConfig {
  const next = { ...getNotifyConfig(), ...patch };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable/full — config just won't persist across reloads
  }
  return next;
}

// ── Channel senders — each one is independent and fails silently ─────────────

async function sendDiscord(webhookUrl: string, level: NotifyLevel, tag: string, text: string): Promise<void> {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `**[${level.toUpperCase()}] ${tag}**\n${text}`,
      }),
    });
  } catch (err) {
    console.error('[notifyChannels] Discord send failed', (err as Error)?.message);
  }
}

async function sendTelegram(
  botToken: string,
  chatId: string,
  level: NotifyLevel,
  tag: string,
  text: string,
): Promise<void> {
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `[${level.toUpperCase()}] ${tag}\n${text}`,
      }),
    });
  } catch (err) {
    console.error('[notifyChannels] Telegram send failed', (err as Error)?.message);
  }
}

/**
 * Fan out one alert to every configured channel above the configured
 * severity floor. No-ops entirely if nothing is configured — safe to call
 * unconditionally from the alert pipeline.
 */
export function dispatchNotification(level: NotifyLevel, tag: string, text: string): void {
  const cfg = getNotifyConfig();
  if (LEVEL_RANK[level] < LEVEL_RANK[cfg.minLevel]) return;

  if (cfg.discordWebhookUrl) {
    void sendDiscord(cfg.discordWebhookUrl, level, tag, text);
  }
  if (cfg.telegramBotToken && cfg.telegramChatId) {
    void sendTelegram(cfg.telegramBotToken, cfg.telegramChatId, level, tag, text);
  }
}

/** For a settings-panel "send test alert" button. */
export function sendTestNotification(): void {
  dispatchNotification('high', 'TEST', 'Whale Radar notification channels are working.');
}
