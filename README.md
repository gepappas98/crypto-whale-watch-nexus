# 🐋 Whale Radar (crypto-whale-watch-nexus) — v9

![Version](https://img.shields.io/badge/version-9.0-blue)
![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript)
![Vite](https://img.shields.io/badge/Vite-5.4-646CFF?logo=vite)

Real-time crypto intelligence platform: whale-transaction tracking, market-manipulation detection, Hyperliquid perps analytics, orderflow scanning, and an AI "council" of trading agents — built as a React/TypeScript SPA with an optional Express + Postgres backend.

**Live:**
- Lovable: https://crypto-whale-watch-nexus.lovable.app
- Vercel: https://crypto-whale-watch-nexusv9.vercel.app

---

## 📑 Table of Contents

- [What's New](#-whats-new)
- [Core Features](#-core-features)
- [Nexus Suite](#-nexus-suite-nexus)
- [Protection Engine](#-protection-engine)
- [Trading Hub](#-trading-hub-trading-hub)
- [Hyperliquid Module](#-hyperliquid-module)
- [AI Council](#-ai-council)
- [Reliability & Resilience Engineering](#-reliability--resilience-engineering)
- [PWA & Performance](#-pwa--performance)
- [Backend (optional)](#-backend-optional)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [Deployment Notes](#-deployment-notes)
- [Roadmap](#-roadmap)
- [Disclaimer](#-disclaimer)

---

## 🆕 What's New

- **Six more freqtrade-concept ports** (v9.1): `pairPerformance.ts` (PerformanceFilter — ranks tradeable symbols by historical signal outcome instead of just gating them), Sortino/Calmar/SQN added to `backtestMetrics.ts` next to Sharpe/profit-factor (now shown in `WRSignalEval`'s risk table), `openTradesLimit.ts` (FullTradesFilter — blocks new grids once the concurrent-position cap is hit, checked before the risk-based protection gate), `protectionOptimizer.ts` (hyperopt-style local grid-search that suggests protection thresholds from real closed-trade history — never auto-applied), `remotePairList.ts` (RemotePairList — fetch a curated symbol list from an external JSON URL with cache/TTL fallback), and a **dry-run mode** for the Nexus Bot's guarded execution wrappers (`isDryRun()`/`setDryRun()` in `bot.ts`) that runs the full gate chain without placing real orders.
- **UI for all of the above**: `NexusBotStatusBar` (dry-run badge + live open-trade-slot count, mounted on Grid Studio/Volume Maker/Portfolio), `ProtectionOptimizerPanel` (shows the optimizer's top suggestion with an explicit Apply/Dismiss — mounted on Portfolio), and a new **🐋 NEXUS BOT** group in the Settings panel (dry-run toggle, max open trades, remote pairlist URL + manual refresh). Protection thresholds are now persisted (`getProtectionConfig`/`setProtectionConfig` in `protections.ts`) so the optimizer's "Apply" button has something durable to write to instead of the hardcoded default.
- **Protection engine for Nexus Bot** (`src/lib/nexus/protections.ts`, `botTradeStore.ts`) — four risk-control checks (cooldown, stoploss guard, max drawdown, low-profit-pairs) now gate every grid/volume-maker execution before it reaches the connected bot, with real closed-trade outcomes fed back into the ledger and an in-app banner (`ProtectionBanner`) showing active locks with a manual clear. See [Protection Engine](#-protection-engine) below.
- **Fixed white-screen crash on Vercel/Lovable** — `src/integrations/supabase/client.ts` used to call `createClient()` unguarded at module import time; a missing/misnamed `VITE_SUPABASE_*` env var crashed the whole app before React could mount, and no `ErrorBoundary` could catch it (import-time errors aren't render errors). It now falls back to inert placeholder credentials and accepts either `VITE_SUPABASE_PUBLISHABLE_KEY` or `VITE_SUPABASE_ANON_KEY`, so a missing key just disables Supabase-backed features instead of blanking the whole app.
- **Debug/startup diagnostics** (`src/lib/startupDiagnostics.ts`, `src/lib/debugOverlay.ts`) — installed before any other import in `main.tsx` specifically to surface bootstrap failures instead of a silent blank page.
- **Chunk-recovery** (`src/lib/chunkRecovery.ts`) — auto-reloads the app if a lazy-loaded chunk fails to fetch (stale deploy after a new build goes live).
- **`safeInvoke` wrapper** for all Supabase Edge Function calls — pre-flight config check + try/catch so a bad/localhost Supabase URL in production degrades gracefully instead of throwing.
- **Hyperliquid data pipeline moved server-side** — all Hypurrscan calls now go through a Supabase Edge Function (`hyperliquid-cache`) with a Postgres-backed cache + rate counter, instead of calling `api.hypurrscan.io` directly from the browser (see `HYPERLIQUID_DEPLOY.md`).
- **SEO overhaul** — full Open Graph / Twitter Card / JSON-LD structured data, canonical URL, PWA manifest, and a strict `Content-Security-Policy` meta tag whitelisting every external host the app talks to (Binance, Bybit, Supabase, CoinGecko, DexScreener, Birdeye, Etherscan, Helius, Hyperliquid, Backpack, and CORS proxies).
- **21+ confirmed bugs fixed** across multiple systematic audit passes (real-data pipeline correctness, Hyperliquid perps integration, WebSocket reconnect logic).

---

## 📊 Core Features

- **Live market ticker** — real-time prices/volumes across tracked assets.
- **Whale transaction scanner** (`WRScanner`, `useWhaleStream`, `useWhaleWebSocket`) — streams large trades from Binance and Bybit WebSockets, with an HTTP-seed fallback and exponential backoff + jitter reconnect if the socket drops.
- **Advanced filters** (`WRAdvancedFilters`) — filter the whale feed by exchange, size, side, symbol, etc.
- **Stats bar, tracker & portfolio** (`WRStatsBar`, `WRTracker`) — running session stats and a watchlist/portfolio with local persistence.
- **Alerts** (`WRAlertBell`) — configurable alert conditions with in-app notification bell.
- **Signal evaluation** (`WRSignalEval`, `src/lib/signalStore.ts`) — stores emitted signals and fills in their realized outcome price later for backtesting signal quality.
- **Onboarding & keyboard shortcuts** (`WROnboarding`, `WRKeyboardHelp`) — first-run walkthrough and a shortcuts cheat-sheet.
- **Mobile filter sheet & responsive layout** (`WRMobileFilterSheet`, `use-mobile`) — full mobile-first UI, not just a scaled-down desktop view.
- **CoinGecko status indicator** (`WRCoinGeckoStatus`) — shows live/degraded/rate-limited state of the price-data source.
- **Insider-risk scanner** (`WRInsiderRiskScanner`, `WRInsiderRiskSettings`, `WRInsiderProgress`) — screens tokens for insider-trading-style risk signals with configurable thresholds.
- **Settings panel** (`WRSettingsPanel`) — runtime configuration, including optional per-browser Supabase URL/key override (no rebuild needed to point at your own project).

## 🐋 Nexus Suite (`/nexus/*`)

- **Whale Watch** — accumulation/distribution visualization.
- **Arbitrage** (`useNexusMarkets`, `src/lib/nexus/arbitrage.ts`) — cross-exchange arbitrage opportunity scanner over live aggregated market data.
- **Crystal Ball** (`NexusCrystalBallV5`, `WRCrystalBallPro`) — predictive trend/probability modeling.
- **Grid Studio** — grid-trading strategy builder.
- **Volume Maker** — synthetic volume/market-making strategy tooling.
- **Portfolio** — P&L and risk tracking.
- **Nexus Bot** (`useNexusBot`, `src/lib/nexus/bot.ts`) — connects to a configurable automated trading bot backend and reports connection state in the UI. Grid and Volume Maker executions go through the [protection engine](#-protection-engine) rather than calling the bot directly.

## 🛡️ Protection Engine

Concept ported from freqtrade's `plugins/protections/*` and re-implemented from scratch in TypeScript against this app's own bot trade ledger — nothing here places trades, it only decides whether the bot is allowed to open new exposure right now.

- **Bot trade ledger** (`src/lib/nexus/botTradeStore.ts`) — a `localStorage`-backed record of every trade the bot actually closed (grid session, volume-maker run). A trade is only ever recorded after a real close with a known PnL; nothing synthetic is logged.
- **Four checks** (`src/lib/nexus/protections.ts`), each independently configurable:
  - **Cooldown** — blocks new entries on a pair right after it closes.
  - **Stoploss Guard** — too many stopped-out/error closes in a lookback window → lock.
  - **Max Drawdown** — equity-curve drawdown across recent trades exceeds a threshold → lock all pairs.
  - **Low Profit Pairs** — a pair's net PnL over a lookback window is negative → lock that pair.
- **`canTrade(pair, side)`** — the single gate every guarded action calls; locks persist across reloads and expire on their own schedule.
- **Guarded execution wrappers** in `bot.ts` (`executeArbitrageGuarded`, `createGridGuarded`, `startVolumeMakerGuarded`) replace the raw `TradingBot` calls in Grid Studio and Volume Maker; a blocked attempt throws `ProtectionBlockedError` with the human-readable reason, surfaced via the existing toast error handling.
- **Real outcome reporting** — Grid Studio detects an `active → stopped/error` transition and reports `closeProfit = pnl / totalInvestment` (both real, bot-reported values); Volume Maker reports the fee/rebate margin (`(rebatesUsd - feesUsd) / totalVolumeUsd`) when a run stops. No fabricated numbers feed the ledger.
- **`ProtectionBanner`** (`src/components/nexus/ProtectionBanner.tsx`) — renders nothing when there are no active locks; otherwise shows each locked scope, the reason, time remaining, and a manual "Clear" action. Mounted on Grid Studio, Volume Maker, and Portfolio.

## 🧠 Trading Hub (`/trading-hub/*`)

Dashboard, Screener, Technical Analysis, Patterns, Sentiment, Backtest, and Timeframes (1m–1W) pages under a shared layout (`TradingHubLayout`), with a technical-context badge component shared across views.

## ⚡ Hyperliquid Module

- **Explorer** (`HLExplorer`, `HLBlockTable`) — blocks/txs/wallets browsing.
- **Manipulation Scanner** (`useHLManipulationScanner`, `HLManipulationScanner`) — flags spoofing/layering-style patterns on Hyperliquid perps.
- **Opportunity Panel** (`useHLOpportunities`, `HLOpportunityPanel`) — 8 detection strategies: funding-rate arbitrage, basis trade, long/short squeeze, whale impact, and more, exposed both as a dedicated panel and indexed by symbol so the main scanner can flag matching rows.
- **Wallet Tracker** (`HLWalletTracker`) — watch specific on-chain wallets.
- **Config banner** (`HLConfigBanner`) — warns in-app if Hyperliquid/Supabase config is incomplete instead of failing silently.
- Server-cached via Supabase Edge Function with a 500ms TTL Postgres cache + rate counter (see `HYPERLIQUID_DEPLOY.md`).

## 🏛️ AI Council

`WRCouncilPanel` + `src/lib/council/` — a multi-agent "council" that debates a symbol and produces a final verdict + conviction score. Decisions are persisted to Supabase (`council_decisions` table) with a running memory of past calls, and performance is back-filled against live price at 1h/4h/24h/7d checkpoints to score how each past verdict actually played out.

## 📡 Order Flow Scanner (`/orderflow`)

`useOrderflowEngine` streams Binance spot orderbook depth (`@depth20@100ms`), aggregated trades, and futures liquidations (`@forceOrder`) directly over WebSocket for live bid/ask imbalance and large-block-trade visualization.

## 🛡️ Reliability & Resilience Engineering

This app has been through multiple hardening passes — worth calling out because it's most of what separates v9 from a typical dashboard demo:

- **Error boundaries** wrapped around every route individually, so one broken page doesn't blank the whole app.
- **Startup diagnostics + debug overlay** installed before any other code runs, to catch and surface bootstrap-time failures.
- **Chunk recovery** — reloads automatically on a stale/failed lazy-chunk fetch after a redeploy.
- **`safeInvoke`** — every Supabase Edge Function call is pre-checked and try/caught so misconfiguration degrades gracefully.
- **`db.ts` offline fallback** — all persistence (portfolio, tracked tokens, alerts) falls back to `localStorage` with retry/backoff + toast notifications if the backend API is unreachable, so the app stays usable offline.
- **Rate-limit handling** (`src/lib/rateLimit.ts`) — tracks and surfaces active cooldowns per data source instead of silently failing requests.
- **Network resilience helpers** (`src/lib/networkResilience.ts`, `src/lib/cachedFetch.ts`) — shared retry/backoff/caching layer used across data hooks.
- **Perf budget monitor** (`src/lib/perfBudget.ts`) — tracks runtime performance budgets.
- **Strict CSP** in `index.html` whitelisting only the exact external hosts the app needs.

## 📲 PWA & Performance

- Installable PWA via `manifest.json` + service worker (`registerServiceWorker`), with offline no-JS fallback messaging.
- Manual Vite chunk-splitting (vendor / charts / query / full Radix UI bundle) for faster first paint.
- `esnext` build target, dev-only sourcemaps.

## 🖥️ Backend (optional)

A companion Express + TypeScript API in `server/` (deployed separately, e.g. Railway — see `Procfile`):

| Route | Purpose |
|---|---|
| `GET /api/health`, `/api/health/db` | Liveness + DB connectivity checks (public) |
| `/api/scan` | Scan endpoint (public) |
| `/api/scans` | Scan history |
| `/api/portfolio` | Portfolio persistence |
| `/api/tracked` | Tracked-token watchlist persistence |
| `/api/alerts` | Alert persistence |
| `/api/whale-events` | Whale event log |
| `/api/signal-outcomes` | Signal outcome backfill (`npm run fill-prices`) |

All non-public routes require a shared bearer token (`API_AUTH_TOKEN`, server-side only). This token must never be exposed to the browser — call protected routes from a server-side proxy/edge function that holds the secret. The browser sends no bearer token and falls back to localStorage persistence. Postgres schema lives in `server/schema.sql` (`npm run db:migrate`).

---

## 🛠️ Tech Stack

| Category | Technology |
|---|---|
| Frontend | React 18 + TypeScript, Vite 5 (SWC) |
| Styling | Tailwind CSS + shadcn/ui (Radix primitives) |
| Data/State | TanStack React Query, custom hooks |
| Realtime | Native WebSocket (Binance, Bybit), Supabase Edge Functions |
| Backend (optional) | Express + TypeScript, PostgreSQL |
| Backend-as-a-Service | Supabase (Postgres + Edge Functions + Auth client) |
| Charts | Recharts |
| Forms/Validation | react-hook-form + Zod |
| Testing | Vitest, Testing Library, Playwright |
| PWA | Workbox-style manual service worker |
| Deployment | Vercel, Lovable, Railway/Fly.io (backend) |

---

## 📁 Project Structure

```
crypto-whale-watch-nexus-main/
├── server/                     # Optional Express + Postgres API (Procfile deploy)
├── public/                     # manifest.json, favicons, robots.txt, sitemap.xml
├── src/
│   ├── assets/
│   ├── components/
│   │   ├── whale-radar/        # WR* — core dashboard UI
│   │   ├── nexus/               # Nexus suite UI + ProtectionBanner.tsx
│   │   ├── hyperliquid/         # HL* — Hyperliquid module UI
│   │   ├── trading/             # Trading Hub shared UI
│   │   └── ui/                  # shadcn/ui primitives
│   ├── hooks/                   # useMarketData, useWhaleStream/WebSocket,
│   │                             # useHyperliquid, useHLManipulationScanner,
│   │                             # useHLOpportunities, useOrderflowEngine,
│   │                             # useNexusBot, useNexusMarkets, useProtections, ...
│   ├── integrations/supabase/   # Generated Supabase client + DB types
│   ├── lib/
│   │   ├── council/              # AI council engine + persistence
│   │   ├── nexus/                # Arbitrage engine, bot connector + guarded execution,
│   │   │                         # protections.ts (risk engine), botTradeStore.ts (ledger),
│   │   │                         # exchanges
│   │   ├── db.ts                 # Frontend persistence client (offline fallback)
│   │   ├── safeInvoke.ts         # Guarded Supabase Edge Function calls
│   │   ├── supabase.ts           # Lazy, override-friendly Supabase client
│   │   ├── startupDiagnostics.ts, debugOverlay.ts, chunkRecovery.ts
│   │   ├── rateLimit.ts, networkResilience.ts, cachedFetch.ts, perfBudget.ts
│   │   └── detection.ts, analyzeToken.ts, insiderRisk*.ts, ...
│   ├── pages/
│   │   ├── Index.tsx             # Main dashboard ("/")
│   │   ├── Orderflow.tsx
│   │   ├── nexus/                # 6 Nexus pages
│   │   └── trading-hub/          # 7 Trading Hub pages
│   ├── services/                 # api.ts, signals.ts
│   ├── test/
│   ├── App.tsx, main.tsx
├── HYPERLIQUID_DEPLOY.md         # Edge Function + DB migration deploy guide
├── Procfile                      # Backend deploy (Railway-style)
├── vite.config.ts
└── package.json
```

---

## 🚀 Getting Started

```bash
git clone <your-repo-url>
cd crypto-whale-watch-nexus-main
npm install
npm run dev            # frontend only, http://localhost:8080
npm run dev:all        # frontend + local Express API together
```

Build for production:

```bash
npm run build
```

Run tests:

```bash
npm run test           # or: npm run test:watch
```

---

## 🔐 Environment Variables

| Variable | Required? | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | Optional | Supabase project URL. Missing → Supabase features disabled, rest of app still works. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` or `VITE_SUPABASE_ANON_KEY` | Optional | Supabase anon/publishable key (either name works). |
| `API_AUTH_TOKEN` | Only if self-hosting `server/` | Bearer token required by protected `/api/*` routes. **Server-side only — never expose it as a `VITE_` variable.** |

In **Lovable**, set these under Project Settings → Environment Variables (not `.env.local`). In **Vercel**, set them under Project Settings → Environment Variables and trigger a redeploy. Supabase URL/key can also be overridden at runtime per-browser from the in-app Settings panel — no rebuild required.

---

## 🚢 Deployment Notes

- Frontend: Vercel or Lovable, static Vite build.
- Backend (`server/`): Railway/Fly.io via `Procfile` (`npm run build:server && node server/dist/index.js`).
- Hyperliquid data: deploy the `hyperliquid-cache` Supabase Edge Function + run the DB migration — see `HYPERLIQUID_DEPLOY.md`.
- If the deployed site ever shows a **blank page**: open DevTools Console first. As of this version, `src/integrations/supabase/client.ts` no longer crashes on missing env vars, so a blank screen now points to a genuine runtime error rather than a silent import-time crash — the console will show it.

---

## 🗺️ Roadmap

- Full-featured wallet tracking and smart-money wallet scoring.
- Multi-channel alerts (Telegram, Discord, email) beyond the in-app bell.
- Expand AI Council with additional agent personas and longer-horizon memory scoring.

✅ Done (were previously listed here as roadmap items):
- Pairlist-style pre-filters already exist: `src/lib/pairFilters.ts` (whale-feed) and `src/lib/nexus/pairQuality.ts` (bot gate) — ports of freqtrade's RangeStabilityFilter/VolatilityFilter/SpreadFilter/AgeFilter.
- Sortino/Calmar/SQN now computed in `src/lib/backtestMetrics.ts` alongside profit-factor/Sharpe/drawdown.
- `src/lib/nexus/pairPerformance.ts` — PerformanceFilter-style ranking of pairs by historical signal performance.
- `src/lib/nexus/openTradesLimit.ts` — FullTradesFilter-style gate that shrinks available trade slots when the bot's concurrent-position cap is reached.
- `src/lib/nexus/protectionOptimizer.ts` — hyperopt-style local grid-search that suggests protection thresholds from the bot's own closed-trade history.
- `src/lib/nexus/remotePairList.ts` — RemotePairList-style fetch of a curated/shared symbol list from an external JSON URL.
- Dry-run mode for the Nexus Bot guarded-execution wrappers (`bot.ts`) — simulates protection gating without placing real orders.

---

## ⚠️ Disclaimer

Educational and informational purposes only. Not financial or trading advice. Do your own research before making any trading decisions.
