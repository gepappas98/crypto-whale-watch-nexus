/* ══ NEXUS — CAPABILITY MANIFEST ═══════════════════════════════════════════════
 *
 *  A structured, machine-readable description of every guarded action
 *  bot.ts exposes — what it does, what gates protect it, and what a caller
 *  needs to provide. Built for two audiences at once:
 *
 *    1. Humans debugging "why was my action blocked" — describeGates()
 *       gives a plain-English answer without reading source.
 *    2. AI agents (an MCP client, a custom script, another LLM) deciding
 *       whether and how to call a Nexus action — getManifest() is meant to
 *       be handed to a model as context so it knows the safety rails exist
 *       *before* it tries something, not after a rejection.
 *
 *  This file describes behavior; it doesn't implement any of it. Source of
 *  truth for the gates themselves stays in bot.ts/protections.ts/
 *  pairQuality.ts/openTradesLimit.ts — if those change, update the
 *  descriptions here to match, the same discipline as keeping a docstring
 *  in sync with its function.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { getProtectionConfig } from './protections';
import { isDryRun } from './bot';
import { getMaxOpenTrades } from './openTradesLimit';

export interface ActionGate {
  name: string;
  appliesWhen: string;
  blocksBy: string;
}

export interface ActionManifestEntry {
  action: string;
  description: string;
  destructive: boolean;   // places/modifies a real order when not in dry-run
  idempotent: boolean;
  gates: ActionGate[];
  inputSchema: Record<string, string>;  // field -> human-readable type/constraint, not a formal JSON Schema — see mcp server for that
  outputSchema: Record<string, string>;
}

export interface NexusManifest {
  version: string;
  dryRun: boolean;
  maxOpenTrades: number;
  actions: ActionManifestEntry[];
  notes: string[];
}

const SHARED_GATES = {
  cooldown: (): ActionGate => ({
    name: 'CooldownPeriod',
    appliesWhen: 'always, per pair',
    blocksBy: 'a short universal lock after ANY trade on that pair — prevents immediate re-entry',
  }),
  stoplossGuard: (): ActionGate => {
    const c = getProtectionConfig().stoplossGuard;
    return {
      name: 'StoplossGuard',
      appliesWhen: `${c.tradeLimit}+ stop-outs within ${c.lookbackMinutes}m`,
      blocksBy: `locks ${c.onlyPerPair ? 'that pair' : 'ALL pairs'} for ${c.lockMinutes}m`,
    };
  },
  maxDrawdown: (): ActionGate => {
    const c = getProtectionConfig().maxDrawdown;
    return {
      name: 'MaxDrawdownProtection',
      appliesWhen: `drawdown exceeds ${(c.maxAllowedDrawdown * 100).toFixed(0)}% over ${c.lookbackMinutes}m (min ${c.tradeLimit} trades)`,
      blocksBy: `locks ALL pairs for ${c.lockMinutes}m — likely sign of a systemically bad market/strategy, not one bad pair`,
    };
  },
  lowProfitPairs: (): ActionGate => {
    const c = getProtectionConfig().lowProfitPairs;
    return {
      name: 'LowProfitPairs',
      appliesWhen: `net profit below ${(c.requiredProfit * 100).toFixed(0)}% over ${c.lookbackMinutes}m (min ${c.tradeLimit} trades)`,
      blocksBy: `locks that pair for ${c.lockMinutes}m`,
    };
  },
  openTradeSlot: (): ActionGate => ({
    name: 'FullTradesFilter',
    appliesWhen: `active grids >= ${getMaxOpenTrades()} (current cap)`,
    blocksBy: 'refuses new grids until a slot frees up — does not affect arbitrage or volume-maker',
  }),
  pairQuality: (): ActionGate => ({
    name: 'PairQuality (liquidity/plausibility)',
    appliesWhen: 'symbol has live ticker coverage on binance/backpack/okx',
    blocksBy: 'rejects illiquid pairs (<$50k 24h quote volume) and implausible 24h moves (>500%, likely bad data)',
  }),
  arbitragePlausibility: (): ActionGate => ({
    name: 'Spread plausibility (arbitrage.ts)',
    appliesWhen: 'the offered spread is a statistical outlier vs. its own rolling baseline',
    blocksBy: 'rejects — treated as a stale/bad tick, not a real dislocation',
  }),
};

export function getManifest(): NexusManifest {
  return {
    version: '1.0',
    dryRun: isDryRun(),
    maxOpenTrades: getMaxOpenTrades(),
    notes: [
      isDryRun()
        ? 'DRY RUN IS ON: every action below runs its full gate chain but places no real order. Safe to explore freely.'
        : '⚠ DRY RUN IS OFF: gated actions that pass every check WILL place real orders. Call setDryRun(true) first if you are not certain.',
      'No bot is "connected" until registerBot() has been called with a concrete TradingBot implementation (see bot.ts) — before that, every action throws.',
      'Every gate below can reject an action; a rejection is not an error to work around — it is the system doing its job. Do not retry a blocked action without addressing the reason.',
    ],
    actions: [
      {
        action: 'executeArbitrageGuarded',
        description: 'Execute a two-leg arbitrage trade against a previously-scanned opportunity from arbitrage.ts.',
        destructive: true,
        idempotent: false,
        gates: [
          SHARED_GATES.arbitragePlausibility(),
          SHARED_GATES.pairQuality(),
          SHARED_GATES.cooldown(), SHARED_GATES.stoplossGuard(),
          SHARED_GATES.maxDrawdown(), SHARED_GATES.lowProfitPairs(),
        ],
        inputSchema: { opp: 'ArbitrageOpportunity — must come from a fresh scanArbitrage() call, not hand-constructed' },
        outputSchema: { ok: 'boolean', txHash: 'string?', error: 'string?', dryRun: 'boolean?' },
      },
      {
        action: 'createGridGuarded',
        description: 'Open a new grid-trading position on one exchange/symbol.',
        destructive: true,
        idempotent: false,
        gates: [
          SHARED_GATES.pairQuality(), SHARED_GATES.openTradeSlot(),
          SHARED_GATES.cooldown(), SHARED_GATES.stoplossGuard(),
          SHARED_GATES.maxDrawdown(), SHARED_GATES.lowProfitPairs(),
        ],
        inputSchema: {
          exchange: 'one of: hyperliquid | backpack | binance | okx',
          symbol: 'base asset symbol, e.g. "BTC"',
          marketType: 'spot | perpetual',
          mode: 'normal | martingale | moving | scalping | capital_protection',
          upperPrice: 'number', lowerPrice: 'number', gridCount: 'integer',
          totalInvestment: 'number (USD)', feeRate: 'number (fraction, e.g. 0.001)',
        },
        outputSchema: { status: 'active|stopped|error', pnl: 'number', filledGrids: 'number', activeOrders: 'number' },
      },
      {
        action: 'stopGrid (via getBot()?.stopGrid(id) — no guarded wrapper; stopping isn\'t risk-increasing)',
        description: 'Stop an active grid by id.',
        destructive: true,
        idempotent: true,
        gates: [],
        inputSchema: { id: 'string — the grid id from a prior createGrid/listGrids call' },
        outputSchema: { '(none)': 'resolves void on success, throws on failure' },
      },
      {
        action: 'startVolumeMakerGuarded',
        description: 'Start a background volume-making strategy. No single-pair scope — see pairQuality note below.',
        destructive: true,
        idempotent: false,
        gates: [SHARED_GATES.cooldown(), SHARED_GATES.stoplossGuard(), SHARED_GATES.maxDrawdown(), SHARED_GATES.lowProfitPairs()],
        inputSchema: { mode: 'string', signalSource: 'string' },
        outputSchema: { active: 'boolean', totalVolumeUsd: 'number', feesUsd: 'number', rebatesUsd: 'number', trades: 'number' },
      },
      {
        action: 'getPortfolio / listGrids / getVolumeStats (via getBot()?.xxx() — plain TradingBot interface methods, no guard wrapper)',
        description: 'Read-only status calls — no gates, safe to call anytime, never mutate state.',
        destructive: false,
        idempotent: true,
        gates: [],
        inputSchema: {},
        outputSchema: { '(varies)': 'see PortfolioSummary / GridStatus[] / VolumeStats in bot.ts' },
      },
    ],
  };
}

/** Plain-English summary, e.g. for logging or a chat-facing "why was this blocked" answer. */
export function describeManifest(): string {
  const m = getManifest();
  const lines = [
    `Nexus bot manifest v${m.version} — dry-run ${m.dryRun ? 'ON' : 'OFF'}, max open trades ${m.maxOpenTrades}`,
    ...m.notes.map((n) => `  ⚠ ${n}`),
  ];
  for (const a of m.actions) {
    lines.push(`\n${a.action}${a.destructive ? ' [DESTRUCTIVE]' : ' [read-only]'} — ${a.description}`);
    for (const g of a.gates) lines.push(`  · ${g.name}: blocks when ${g.appliesWhen} → ${g.blocksBy}`);
  }
  return lines.join('\n');
}
