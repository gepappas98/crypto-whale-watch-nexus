#!/usr/bin/env node
/* ══ NEXUS BOT — MCP SERVER ═══════════════════════════════════════════════════
 *
 *  Lets any MCP-compatible AI client (Claude Desktop, Claude Code, etc.)
 *  drive the Nexus bot directly — as another trusted caller of the SAME
 *  Express server the browser's RestBridgeBot talks to (see
 *  src/lib/nexus/restBridgeBot.ts and server/routes/nexusBot.ts). Every
 *  gate the server enforces for the browser (dry-run default, cooldown
 *  lock, pair plausibility) applies exactly the same way here — this is
 *  not a separate, less-guarded path.
 *
 *  CONFIGURATION (environment variables):
 *    NEXUS_BOT_API_URL   — base URL of the Express server, e.g. http://localhost:3001
 *    NEXUS_BOT_API_TOKEN — the same token as server/.env's API_AUTH_TOKEN
 *
 *  Example claude_desktop_config.json entry:
 *    {
 *      "mcpServers": {
 *        "nexus-bot": {
 *          "command": "node",
 *          "args": ["/absolute/path/to/mcp-nexus-bot/dist/index.js"],
 *          "env": {
 *            "NEXUS_BOT_API_URL": "http://localhost:3001",
 *            "NEXUS_BOT_API_TOKEN": "<same as server/.env API_AUTH_TOKEN>"
 *          }
 *        }
 *      }
 *    }
 *
 *  UNTESTED DISCLOSURE: written against the documented @modelcontextprotocol/sdk
 *  API surface, but not run against a live SDK install/MCP Inspector session in
 *  this environment (no network access to npm install here). Sanity-check with
 *  `npx @modelcontextprotocol/inspector node dist/index.js` before trusting it
 *  end-to-end, same as any other new MCP server.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE_URL = process.env.NEXUS_BOT_API_URL;
const TOKEN = process.env.NEXUS_BOT_API_TOKEN;

if (!BASE_URL || !TOKEN) {
  console.error('[nexus-bot-mcp] NEXUS_BOT_API_URL and NEXUS_BOT_API_TOKEN must both be set. Exiting.');
  process.exit(1);
}

async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}/api/nexus-bot${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown;
  try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = text; }
  if (!res.ok) {
    const message = (parsed as { error?: string } | undefined)?.error ?? `HTTP ${res.status}`;
    throw new Error(message);
  }
  return parsed as T;
}

function textResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown) {
  return {
    content: [{ type: 'text' as const, text: `Nexus bot error: ${(err as Error).message}` }],
    isError: true,
  };
}

const server = new McpServer({ name: 'nexus-bot', version: '1.0.0' });

// ── Read-only tools ────────────────────────────────────────────────────────
server.registerTool(
  'nexus_get_safety_model',
  {
    title: 'Get Nexus bot safety model',
    description:
      'Explains the server-side safety defaults before you call any mutating tool: dry-run is on unless the server operator explicitly opted into live trading with two separate env vars, every mutating action re-checks a cooldown lock independently of anything the caller already verified, and destructive tools are marked below. Call this first if you have not already read it in this session.',
    inputSchema: {},
  },
  async () => textResult({
    dryRunDefault: true,
    liveTradeRequirement: 'Server operator must set NEXUS_DRY_RUN=false AND NEXUS_LIVE_TRADING_CONFIRM=I_UNDERSTAND_THE_RISK — both, exactly.',
    cooldown: 'Server enforces its own per-pair cooldown lock independent of anything the caller already checked.',
    scopeLimits: [
      'Grid open/close and arbitrage execution place real orders end-to-end when dry-run is off.',
      'Grid maintenance (re-placing an order once a level fills) is not implemented yet — grids will not self-heal after a fill.',
      'Volume Maker only tracks start/stop state — there is no real trading loop behind it yet.',
      'nexus_scan_arbitrage results are NOT pre-vetted against historical spread plausibility the way the app\'s own browser scan is — treat them as leads, not verified opportunities.',
    ],
  }),
);

server.registerTool(
  'nexus_get_portfolio',
  {
    title: 'Get Nexus portfolio summary',
    description: 'Read-only. Total AUM, win rate, active strategy count, and per-exchange balances/connection status.',
    inputSchema: {},
  },
  async () => {
    try { return textResult(await call('GET', '/portfolio')); }
    catch (err) { return errorResult(err); }
  },
);

server.registerTool(
  'nexus_list_grids',
  {
    title: 'List Nexus grids',
    description: 'Read-only. Every grid (active or stopped) with its config and current order count.',
    inputSchema: {},
  },
  async () => {
    try { return textResult(await call('GET', '/grids')); }
    catch (err) { return errorResult(err); }
  },
);

server.registerTool(
  'nexus_scan_arbitrage',
  {
    title: 'Scan for arbitrage opportunities',
    description:
      'Read-only. Scans configured exchanges (those with API credentials set server-side) for cross-exchange price spreads on BTC/ETH/SOL/AVAX/LINK. Returns [] if fewer than two exchanges are configured. See nexus_get_safety_model — these are unverified leads, not pre-vetted opportunities.',
    inputSchema: {},
  },
  async () => {
    try { return textResult(await call('GET', '/arbitrage/scan')); }
    catch (err) { return errorResult(err); }
  },
);

server.registerTool(
  'nexus_get_volume_maker_stats',
  {
    title: 'Get Volume Maker status',
    description: 'Read-only. Whether Volume Maker is active and its cumulative counters. See nexus_get_safety_model — there is no real trading loop behind this yet.',
    inputSchema: {},
  },
  async () => {
    try { return textResult(await call('GET', '/volume-maker/stats')); }
    catch (err) { return errorResult(err); }
  },
);

// ── Mutating tools — every one of these can place a real order once the
// server operator has opted into live trading. Call nexus_get_safety_model
// first if you have not already, and re-read a fresh nexus_scan_arbitrage/
// nexus_get_portfolio result before acting on stale data. ──────────────────

server.registerTool(
  'nexus_execute_arbitrage',
  {
    title: 'Execute an arbitrage trade',
    description:
      'DESTRUCTIVE when live trading is enabled server-side. Executes a two-leg trade against an opportunity object — pass one exactly as returned by nexus_scan_arbitrage, not hand-constructed. Blocked by the server\'s cooldown lock if this pair traded too recently.',
    inputSchema: {
      pair: z.string().describe('e.g. "BTC-USD" — from a nexus_scan_arbitrage result'),
      exchanges: z.tuple([z.string(), z.string()]).describe('the two exchange ids from the opportunity'),
      direction: z.enum(['long_short', 'short_long']),
      prices: z.record(z.string(), z.number()).describe('exchange id -> last price, from the same opportunity'),
      estimatedProfitUsd: z.number().optional(),
      plausible: z.boolean().optional(),
    },
  },
  async (args) => {
    try { return textResult(await call('POST', '/arbitrage/execute', args)); }
    catch (err) { return errorResult(err); }
  },
);

server.registerTool(
  'nexus_create_grid',
  {
    title: 'Create a grid-trading position',
    description:
      'DESTRUCTIVE when live trading is enabled server-side. Opens a new grid: places gridCount limit orders spread between lowerPrice and upperPrice, split across totalInvestment. Blocked if the pair fails the liquidity check, the open-trade-slot cap is reached, or the cooldown lock is active.',
    inputSchema: {
      id: z.string().describe('caller-chosen unique id for this grid'),
      exchange: z.enum(['binance', 'okx', 'hyperliquid', 'backpack']),
      symbol: z.string().describe('base asset, e.g. "BTC" — quote is assumed USDT'),
      marketType: z.enum(['spot', 'perpetual']).default('spot'),
      mode: z.string().default('normal'),
      upperPrice: z.number(),
      lowerPrice: z.number(),
      gridCount: z.number().int().positive(),
      totalInvestment: z.number().positive().describe('USD'),
      feeRate: z.number().default(0.001),
    },
  },
  async (args) => {
    try { return textResult(await call('POST', '/grids', args)); }
    catch (err) { return errorResult(err); }
  },
);

server.registerTool(
  'nexus_stop_grid',
  {
    title: 'Stop a grid',
    description: 'Cancels every remaining open order for this grid and marks it stopped. Risk-reducing, not risk-increasing — not subject to the cooldown/liquidity gates the way opening a position is.',
    inputSchema: { id: z.string().describe('the grid id from nexus_list_grids') },
  },
  async ({ id }) => {
    try { return textResult(await call('DELETE', `/grids/${encodeURIComponent(id)}`)); }
    catch (err) { return errorResult(err); }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[nexus-bot-mcp] connected, bridging to ${BASE_URL}`);
