# Whale Radar — Crypto Whale Watch Nexus

[![Version](https://img.shields.io/badge/version-9.43-blue)](CHANGELOG.md)
[![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5.4-646CFF?logo=vite)](https://vitejs.dev/)

Whale Radar is a real-time crypto intelligence platform for whale-transaction monitoring, market and order-flow analysis, Hyperliquid perps analytics, signal evaluation, and guarded trading-bot execution. It is implemented as a React/TypeScript SPA with Supabase Edge Functions and an optional Express/Postgres backend.

> **Important:** Analytics and signal outputs are informational. Any live trading capability must be tested in dry-run or exchange sandbox environments before it is connected to funded accounts.

## Product links

| Environment | Link |
|---|---|
| Lovable | [crypto-whale-watch-nexus.lovable.app](https://crypto-whale-watch-nexus.lovable.app) |
| Vercel | [crypto-whale-watch-nexusv9.vercel.app](https://crypto-whale-watch-nexusv9.vercel.app) |
| Changelog | [`CHANGELOG.md`](CHANGELOG.md) |
| Roadmap | [`ROADMAP.md`](ROADMAP.md) |
| MCP bot | [`mcp-nexus-bot/README.md`](mcp-nexus-bot/README.md) |
| Hyperliquid deployment | [`HYPERLIQUID_DEPLOY.md`](HYPERLIQUID_DEPLOY.md) |

## Capabilities

### Whale Radar

The main dashboard provides a live market ticker and large-trade streams from Binance and Bybit WebSockets, with OKX and Kraken support through the adapter registry in `src/lib/exchanges/`. The stream layer includes HTTP seeding, reconnect backoff, jitter, stale-connection detection, and degraded-state reporting.

The feed supports exchange, symbol, side, trade-size and advanced filters. Alert quality is improved by pair filters, illiquidity checks, implausible-tick checks, remote allowlists, cooldowns, historical expectancy hints, and optional Discord or Telegram delivery. The dashboard also includes session statistics, a locally persisted tracker/portfolio, configurable alerts, onboarding, keyboard shortcuts, responsive mobile filters, a CoinGecko status indicator, Solana wallet activity, and an insider-risk scanner.

Signal evaluation stores emitted signals locally, fills forward prices from CoinGecko at 1h/4h/24h horizons, and reports win rate, profit factor, Sharpe, Sortino, Calmar, SQN and related risk metrics. The optional confidence layer uses the same recorded history and does not treat simulated data as real outcomes.

### Nexus Suite

The `/nexus/*` routes provide:

- Whale Watch accumulation/distribution views.
- Cross-exchange arbitrage scanning over aggregated market data.
- Crystal Ball trend and probability analysis.
- Grid Studio strategy configuration.
- Volume Maker reference strategy tooling.
- Portfolio and P&L views.
- Nexus Bot connectivity and guarded execution.

### Protection Engine

The protection engine in `src/lib/nexus/protections.ts` decides whether new exposure may be opened. It does not place trades itself. It evaluates four independently configurable protections:

| Protection | Behavior |
|---|---|
| Cooldown | Blocks a pair shortly after a trade closes. |
| Stoploss Guard | Locks after too many stop-loss exits in the lookback window. |
| Max Drawdown | Locks all pairs when recent equity-curve drawdown exceeds the threshold. |
| Low Profit Pairs | Locks a pair whose recent net P&L is below the configured requirement. |

`canTrade(pair, side)` is the common gate used by the guarded wrappers `executeArbitrageGuarded`, `createGridGuarded`, and `startVolumeMakerGuarded`. Locks persist in browser storage, expire automatically, and are shown through the protection banner. The bot trade ledger records only closed trades with known P&L.

### Trading Hub and Hyperliquid

The Trading Hub includes Dashboard, Screener, Technical Analysis, Patterns, Sentiment, Backtest and Timeframes views under a shared layout. The Hyperliquid module includes explorer views, wallet tracking, manipulation-pattern scanning, opportunity detection, server-side caching and rate counters.

### AI Council

The AI Council debates a symbol through Bull, Bear, PM, Regime, Risk, Trader and optional Quant desks. Quick, standard and deep modes provide different levels of analysis. Decisions can be persisted to Supabase, evaluated against future price checkpoints, and summarized through desk-level track-record metrics.

### MCP and AI-agent access

The project exposes read-only market intelligence through MCP tools. The tools cover asset search, snapshots, OHLCV history, movers, cross-exchange comparisons, whale trades, trade flow, order-book pressure, funding/open interest, Hyperliquid markets and wallets, technical indicators, market sentiment and Council decisions. These read-only tools do not place trades or write data.

The separate `mcp-nexus-bot/` server exposes guarded Nexus Bot operations for MCP clients. It uses the same server-side gates as the browser and should be configured only against a protected backend.

## Trading execution architecture

The browser never receives exchange API secrets. The execution path is:

```text
Browser / RestBridgeBot
  -> Supabase Edge Function: nexus-bot-proxy
  -> Express API: /api/nexus-bot/*
  -> ccxt exchange adapter
  -> configured exchange
```

The server independently checks authentication, dry-run configuration, database-backed cooldowns and execution safeguards. Live trading requires both `NEXUS_DRY_RUN=false` and the exact confirmation phrase `NEXUS_LIVE_TRADING_CONFIRM=I_UNDERSTAND_THE_RISK`. Keep dry-run enabled until sandbox testing, monitoring and rollback procedures are complete.

The optional Strategy Trader bridge forwards human-triggered signals to a running Freqtrade REST API. It is independent from the ccxt bot and requires its own Freqtrade dry-run configuration.

## Architecture

| Layer | Responsibility |
|---|---|
| React/Vite SPA | UI, visualization, local fallback state and user controls. |
| `src/lib` and hooks | Market integrations, signal logic, protection gates and client services. |
| Supabase Edge Functions | Public data proxies, caching, streaming, agent access, persistence bridges and secret-held execution proxy. |
| Express backend | Persistent workers, ccxt execution, Freqtrade bridge, web push and database-backed API routes. |
| PostgreSQL / Supabase | Durable state, views, RPCs, migrations, signal outcomes and Council memory. |

The repository contains both legacy Express routes and target Edge Function implementations. A function described as “ready to adopt” in the changelog is not necessarily the live client path; verify deployment and cutover status before removing the legacy route.

## Getting started

### Prerequisites

Install Node.js 20 or newer, npm, a Supabase project for hosted persistence and optionally PostgreSQL for the Express backend. Bun lockfiles are present for historical compatibility, but npm is the canonical installation path used by the current scripts.

### Frontend

```bash
npm ci
cp .env.example .env.local
npm run dev
```

The Vite development server starts the frontend. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local` or in the deployment provider’s environment settings.

### Frontend checks

```bash
npm run lint
npm test
npm run build
npm run preview
```

The production build also runs the postbuild route-shell generation script.

### Express backend

```bash
cd server
npm ci
npm run build
npm start
```

For concurrent local development from the repository root:

```bash
npm run dev:all
```

The API listens on port `3001` by default. Set `API_PORT` to override it.

### Database

Apply the base schema and migrations with the appropriate database connection:

```bash
psql "$DATABASE_URL" -f server/schema.sql
# Apply server/migrations/*.sql in order when using the Express backend.
# Apply supabase/migrations/*.sql through the Supabase migration workflow.
```

Do not run migrations against production without a backup, a reviewed diff and a rollback plan.

## Environment variables

Never commit `.env.local`, `server/.env`, service-role keys, exchange secrets or bearer tokens. The browser may contain only public Supabase values.

| Variable | Location | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | Frontend | Public Supabase project URL. |
| `VITE_SUPABASE_ANON_KEY` | Frontend | Public/anon Supabase key. |
| `DATABASE_URL` | Express | PostgreSQL connection string. |
| `API_AUTH_TOKEN` | Express and Supabase secret | Bearer token for protected backend routes. |
| `CORS_ORIGIN` | Express | Comma-separated permitted origins in production. |
| `NEXUS_BOT_API_URL` | Supabase secret | URL of the protected Express execution service. |
| `NEXUS_DRY_RUN` | Express | Keep `true` unless live trading is explicitly approved. |
| `NEXUS_LIVE_TRADING_CONFIRM` | Express | Exact phrase required to disable dry-run. |
| `BINANCE_API_KEY/SECRET` | Express | Optional Binance execution credentials. |
| `OKX_API_KEY/SECRET/PASSPHRASE` | Express | Optional OKX execution credentials. |
| `HYPERLIQUID_API_KEY/SECRET` | Express | Optional Hyperliquid credentials. |
| `FREQTRADE_API_URL/USERNAME/PASSWORD` | Express | Optional Strategy Trader bridge. |
| `VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT` | Express | Optional web-push notifications. |

See [`.env.example`](.env.example) for the complete list and deployment notes.

## Testing and quality

The current suite is intentionally focused on high-risk client-side flows. It includes tests for protection gates, stop-loss and drawdown locks, signal deduplication, signal evaluation, price filling and rate-limit expiry. Run the full suite with:

```bash
npm test
```

Trading tests must remain deterministic and must not place live orders. Backend route and exchange integration tests should use mocked services or exchange sandbox accounts.

## Deployment notes

Deploy the frontend through the selected static hosting provider and set environment variables in the provider dashboard. Deploy Supabase Edge Functions with the Supabase CLI and configure secrets separately. Deploy the Express backend as a long-running service because ccxt execution, grid maintenance, Volume Maker and price fillers may require persistent workers.

After deployment, verify health endpoints, direct route-shell serving, CORS behavior, Edge Function authentication, WebSocket reconnect behavior, database migrations, scheduled fillers and backend worker singleton behavior. Confirm that production logs do not contain credentials or full authorization headers.

## Security and operational rules

Use least-privilege exchange keys, disable withdrawal permissions, restrict IPs where supported, keep live execution disabled by default, and set explicit backend rate limits. Public agent-facing endpoints must be monitored for scraping and denial-of-service abuse. Treat all AI-generated signals as untrusted suggestions and require human review before forwarding a signal to Strategy Trader.

## Project layout

```text
src/
  components/        UI and feature components
  hooks/             React data and stream hooks
  lib/               integrations, signals, protections and services
  pages/             application routes
  test/              Vitest tests
server/
  routes/            Express API routes
  services/          ccxt, Freqtrade, workers and push services
  migrations/        Express/Postgres migrations
  schema.sql         base PostgreSQL schema
supabase/
  functions/         Edge Functions
  migrations/        Supabase migrations
mcp-nexus-bot/       MCP server for guarded bot actions
public/              PWA, OpenAPI and crawler assets
```

## Versioning and project status

The current documented release line is **v9.43**. See [`CHANGELOG.md`](CHANGELOG.md) for shipped changes and [`ROADMAP.md`](ROADMAP.md) for planned work. The project is suitable for controlled beta analytics and dry-run experimentation; production-funded execution requires completion of the release-hardening items in the roadmap.

## License and disclaimer

MIT License

Copyright (c) [year] [fullname or organization]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
This software is provided for research and informational purposes. Cryptocurrency markets are volatile, exchange APIs can fail, and historical signal performance is not a guarantee of future results. The project authors are not responsible for financial losses arising from use of the software.
