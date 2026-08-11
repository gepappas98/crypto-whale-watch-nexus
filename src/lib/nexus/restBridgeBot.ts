/* ══ NEXUS — REST BRIDGE BOT ═══════════════════════════════════════════════════
 *
 *  A TradingBot implementation (see bot.ts) that does NOT execute anything
 *  itself — it's a thin client for the server-side bot living in
 *  server/routes/nexusBot.ts. This is the only safe way to "connect a
 *  trading bot": real exchange API keys must never reach browser JS.
 *
 *  IMPORTANT: this does NOT call the Express server directly with a bearer
 *  token — that token would end up baked into the public JS bundle the
 *  moment it's read from import.meta.env (see .env.example's own warning
 *  about VITE_-prefixed values). Instead it goes through
 *  supabase/functions/nexus-bot-proxy, the same "browser → edge function →
 *  real secret held server-side" pattern this app already uses everywhere
 *  else (coingecko-proxy, hyperliquid-cache, whale-stream). The proxy
 *  attaches the real API_AUTH_TOKEN — held only as a Supabase secret.
 *
 *  Usage (once per app load, e.g. in Index.tsx or a settings action):
 *
 *      import { registerBot } from '@/lib/nexus/bot';
 *      import { RestBridgeBot } from '@/lib/nexus/restBridgeBot';
 *      registerBot(new RestBridgeBot());
 * ═══════════════════════════════════════════════════════════════════════════ */

import { safeInvoke } from '@/lib/safeInvoke';
import type {
  TradingBot, GridConfig, GridStatus, VolumeStats, PortfolioSummary,
} from './bot';
import type { ArbitrageOpportunity } from './arbitrage';

async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, payload?: unknown): Promise<T> {
  const { data, error } = await safeInvoke<T>('nexus-bot-proxy', { body: { method, path, payload } });
  if (error) throw error;
  return data as T;
}

export class RestBridgeBot implements TradingBot {
  name = 'RestBridgeBot';
  version = '1.1';

  executeArbitrage(opp: ArbitrageOpportunity) {
    return call<{ ok: boolean; txHash?: string; error?: string }>('POST', '/arbitrage/execute', opp);
  }

  listGrids() {
    return call<GridStatus[]>('GET', '/grids');
  }

  createGrid(cfg: GridConfig) {
    return call<GridStatus>('POST', '/grids', cfg);
  }

  stopGrid(id: string) {
    return call<void>('DELETE', `/grids/${encodeURIComponent(id)}`);
  }

  startVolumeMaker(opts: { mode: string; signalSource: string; exchange: string; symbol: string }) {
    return call<VolumeStats>('POST', '/volume-maker/start', opts);
  }

  stopVolumeMaker() {
    return call<VolumeStats>('POST', '/volume-maker/stop');
  }

  getVolumeStats() {
    return call<VolumeStats>('GET', '/volume-maker/stats');
  }

  getPortfolio() {
    return call<PortfolioSummary>('GET', '/portfolio');
  }
}
