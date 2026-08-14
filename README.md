# 🐋 Whale Radar (crypto-whale-watch-nexus) — v9.15

![Version](https://img.shields.io/badge/version-9.15-blue)
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
- [Connecting a Trading Bot](#-connecting-a-trading-bot)
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

- **Push notifications and the install prompt were both documented, both fake** (v9.15): two separate findings while working the Roadmap's `subscribeToPush()`/`triggerBackgroundSync()` item. First, the deeper one: `public/sw.js` wasn't a real service worker — it was a "kill switch" that unregistered itself immediately on every activation (a deliberate rollback of an earlier real caching worker whose `fetch` handler had served stale post-deploy JS chunks and broken React in production, not just in Lovable previews). That meant push/sync could never have worked no matter what backend existed, because there was never a persistent worker around to receive those events, and no `push` handler existed anyway. Rewrote `sw.js` as a real persistent worker with `push`/`notificationclick`/`sync`/`message` handlers — but deliberately **no `fetch` handler and no Cache Storage writes at all**, so it structurally cannot reintroduce the stale-chunk bug; see the long comment at the top of the file before touching it. Added the actual backend that was missing: `server/services/pushService.ts` (VAPID web push via the `web-push` package), `server/routes/push.ts` (`/api/push/{vapid-public-key,subscribe,unsubscribe,send}`), `supabase/functions/push-proxy` (same never-expose-the-token pattern as `nexus-bot-proxy`), `server/migrations/004_push_subscriptions.sql`, and a `🔔 PUSH NOTIFICATIONS` group in Settings (enable/disable + send-test-push). No per-user targeting — subscriptions aren't tied to an account, because there's no login system (see the open item below); `/send` broadcasts to everyone subscribed. Second, smaller finding: the README had described a `useInstallPrompt()` hook and a `📲 APP` Settings group since v9.10 that plainly didn't exist anywhere in the code — same "documented but never built" pattern as v9.13's Strategy Trader server. Built it for real this time: `useInstallPrompt()` in `src/lib/pwa.ts`, a `📲 INSTALL` button in the header, and a `📲 APP` Settings group with install status and a **CLEAR APP CACHE** button (wired to the cache-clear message handler `sw.js` already had).
- **Strategy Trader's server-side gating was sloppy in a few real ways** (v9.14): a follow-up audit of v9.13 found four things worth fixing before this touches real money. (1) `checkAndLockCooldown()`'s SELECT-then-INSERT had a genuine race — two concurrent requests for the same pair could both see "no lock" and both proceed; rewritten as a single atomic `INSERT ... ON CONFLICT ... WHERE locked_until <= now() ... RETURNING`, which Postgres can only let one concurrent caller win. This is shared code, so it also fixes the same race for arbitrage/grid/volume-maker admission, not just Strategy Trader. (2) That same gate failed *open* on a DB outage — it now fails *closed* (503, trade refused) instead, again across all of nexus-bot, not just this route. (3) `/enter` recorded a trade as `status: 'open'` before checking whether freqtrade's response was actually an error; a failed forceentry could show up in the ledger as an open position. Now recorded as `'error'` when freqtrade returns a `detail` error, and `/exit` gets the equivalent check for freqtrade's occasional HTTP-200-with-an-error-string responses. (4) A failed order used to always log `dryRun: true` in the ledger regardless of whether freqtrade was actually in live mode; dry-run status is now resolved once up front and reused, with a genuine `'unknown'` state (via `meta.executionMode`) when freqtrade itself couldn't be reached to ask. Also added: a hard server-side stake cap (`NEXUS_STRATEGY_MAX_STAKE_USD`, default 500) and a pair-format check on `/enter`, neither of which existed before. **Not fixed, and worth being upfront about:** the mlConfidence floor is not a real security boundary — the ML model runs client-side with no server copy and no signed provenance, so the floor can only reject a bad number the client chose to report, not enforce that a real one was computed. See the comment at the top of `server/routes/strategyTrader.ts` for what closing that properly would take. Also unaddressed: `supabase/functions/nexus-bot-proxy` (and every other Edge Function in this app) is reachable by anyone holding the public Supabase anon key — there's no per-user authentication layer, because this app has no login system at all. That's a pre-existing, app-wide design, not something new to Strategy Trader, but it matters more now that a real trading action sits behind it. Adding real auth is a bigger feature than a patch.
- **Strategy Trader had no server behind it at all** (v9.13): this is a different shape of gap than the previous few — not "logic exists with no UI consumer," but the reverse: the client bridge (`src/lib/nexus/strategyTraderBridge.ts`) and its UI (the STRATEGY TRADER group in Settings, the 🎯 forward button on CRITICAL alerts) have called a `/strategy-trader/*` path since v9.4, and the README described a working `server/services/freqtradeClient.ts` and forceentry integration since that version too — but neither ever actually existed in the repo, and `supabase/functions/nexus-bot-proxy`'s `ALLOWED_PATHS` allowlist didn't even include the path, so every call was being rejected before it reached the (missing) server route. Every "connect to freqtrade" attempt has been failing since v9.4. This adds the real pieces: `server/services/freqtradeClient.ts` (HTTP Basic Auth against freqtrade's REST API — `show_config`/`status`/`profit`/`locks`/`forceenter`/`forceexit`, per `FREQTRADE_API_URL`/`FREQTRADE_API_USERNAME`/`FREQTRADE_API_PASSWORD` in `server/.env`, already documented in `.env.example` but unused until now), `server/routes/strategyTrader.ts` (mounted at `/api/nexus-bot/strategy-trader`, re-checking the cooldown lock and a 50%-ML-confidence floor server-side on `/enter`, same "never just trust the client" posture as the rest of `nexusBot.ts`), and the missing entries in the proxy's allowlist. Along the way, closed the one real UI gap that *was* just a missing consumer: `exitStrategyTraderPosition()` had a working client function and server route with nothing calling it — Settings now lists open freqtrade trades with a per-trade **EXIT** button. `server/migrations/003_strategy_trader.sql` widens `nexus_bot_trades.kind` to record these alongside ccxt-bot trades. freqtrade's own dry-run setting (from `show_config`) governs whether `/enter`/`/exit` place real orders — this bridge doesn't add a second dry-run layer on top of freqtrade's.
- **The "✦ AI ASSESSMENT" in Market Sentiment was never actually AI** (v9.12): a different flavor of the gaps above — this one wasn't unreachable, it was a fake. `src/lib/analyzeToken.ts` has had a complete, working `analyzeSentiment()` since early on — same Claude call pattern as the per-coin "AI ANALYZE" button in `WRScanner` (`analyzeToken()`), just summarizing the whole scanned list instead of one token — and it had no caller. Meanwhile `Index.tsx`'s Sentiment modal (`SentimentContent`, opened via the ✦ SENT button) rendered a hardcoded `Market shows {critCount > 3 ? 'ELEVATED' : ...}` template string under an "✦ AI ASSESSMENT" label, and even gated that fake text behind requiring an AI key to be entered — implying a real call was happening when there wasn't one. `SentimentContent` now calls `analyzeSentiment()` for real, with a loading state and a ↻ REGENERATE button; `analyzeSentiment()` itself gained a cache keyed on the actual risk-count signature (crit/high/wash/pump/rug counts + scanned total, not just time) so reopening the modal on an unchanged scan doesn't spend a second API call on a prompt that would come out the same. The three CRITICAL/HIGH/WASH count tiles above it were already real counts and are untouched.
- **Pinning an alert now actually survives a reload** (v9.11): `server/routes/alerts.ts` has had a working `PATCH /api/alerts/:id/pin` endpoint (and a client wrapper, `toggleAlertPin()` in `src/lib/db.ts`) with no caller — `WRRightPanel`'s pin toggle only ever flipped local React state. Root cause: `saveAlert()` discarded the id the server returns on insert, so there was never an id to call `toggleAlertPin()` with, and `loadAlerts()` dropped the id on the read side too. Both now carry it through (`AlertItem.dbId`, populated once the save round-trips or on load from history); `Index.tsx`'s pin handler still flips local state immediately (so the UI never waits on the network) and fires `toggleAlertPin()` alongside it when a `dbId` is available. Alerts saved while offline, or where the save is still in flight, stay local-only until a `dbId` shows up — same honest degrade-to-local pattern the rest of `db.ts` already uses.
- **PWA install prompt and cache clearing are wired up now** (v9.10): `src/lib/pwa.ts` had `setupInstallPrompt()`, `isStandalone()`, and `clearAppCache()` fully implemented with no consumer anywhere in the app — the "Add to Home Screen" flow (browser fires `beforeinstallprompt`, app calls `.prompt()`) and the manual cache-clear-for-a-stuck-old-version escape hatch both existed, unreachable. New `useInstallPrompt()` hook (also in `pwa.ts`) wraps the same `beforeinstallprompt`/`appinstalled` events in a React-friendly form — `setupInstallPrompt()`'s original `window.installPWA` global stays in place for any non-React caller, the hook is just the actual path a component uses. `WRHeader` now shows a **📲 INSTALL** button when the browser offers it (renders nothing on Safari/Firefox, which never fire the event, and nothing once already installed) and `WRSettingsPanel` gets a new **📲 APP** group with install-status text and a **🗑 CLEAR APP CACHE** button. Note: `subscribeToPush()` and `triggerBackgroundSync()` in the same file are left unwired — they need a VAPID key pair and a server-side push-sending endpoint that don't exist yet, a materially bigger backend project than a UI-only fix, so they're called out here rather than half-wired.
- **Scan history is now actually browsable** (v9.9): `src/lib/db.ts` has had a fully working scan-history read API for a while — `getScanSessions()`, `getTokenHistory()`, `getTopThreats()` — backed by real `server/routes/scans.ts` endpoints (`GET /api/scans`, `/api/scans/symbol/:sym`, `/api/scans/threats/top`) and a `scan_coins`/`scan_sessions` table that's been populated on every scan since `saveScan()` was wired into `useMarketData.ts`. Nothing ever called the read side — a "logic existed but never reached the UI" gap, same shape as the v9.6 wallet-tracker and ML-confidence fixes. New `WRHistoryPanel.tsx` closes it: a per-symbol history lookup (score/threat/price across past scans for one token), an all-time top-threats table, and a recent-sessions list. Wired in as a new **📜 HISTORY** tab in `WRRightPanel`, alongside Whale Trades / Wallets / HL — fetched on tab-open and on manual refresh, not polled, since this is backward-looking data that doesn't need a live loop.
- **Roadmap closed: AI Council expanded with a QUANT persona and a structured desk track-record score** (v9.8): the two remaining Roadmap items — additional agent personas, and longer-horizon memory scoring — are both closed. New **QUANT DESK** agent (`quant`, `⌁`→`∑`) reads pure orderflow/derivatives positioning (perp funding rate, OI trend, buy/sell $ imbalance from `recentWhaleTrades`) with an explicit "NO EDGE — insufficient orderflow data" fallback rather than a guessed take; it's gated to `deep` depth only, so `deep` finally has a genuinely different roster from `standard` instead of the same five agents at a higher word limit (`supabase/functions/agent-council/index.ts`'s `DEPTH_AGENTS`). Separately, `buildReflection()`'s longest-horizon grading logic (hits/graded-calls, NEUTRAL excluded) had a structured-data twin added: `computeDeskTrackRecord()` in `src/lib/council/api.ts` produces the same numbers as a `DeskTrackRecord` (hit rate, avg realized return, confidence-discounted 0-100 score pulled toward 50 — the no-information baseline for a binary direction call — when a token has under 5 graded calls) — this existed only as text folded into the PM's prompt before, with no UI consumer; `WRCouncilPanel` now shows it as a 🎯 badge next to the MEMORY button and inside the memory panel. Also fixed along the way: `council-persist`'s `VERDICTS` allow-list (`supabase/functions/council-persist/index.ts`) had drifted to a stale enum (`HOLD`/`WAIT` instead of the real `STRONG_LONG`/`NEUTRAL`/`STRONG_SHORT`) — every decision except plain `LONG`/`SHORT`/`AVOID` was silently rejected at save time, so memory (and therefore the whole track-record feature) never actually accumulated for the majority of verdicts. Confirmed no DB-level `CHECK` constraint on `final_verdict` needed updating alongside it.
- **Smart-money wallet skill scoring** (v9.7): the Roadmap item — "rank tracked wallets by trading skill, not just raw balance/activity" — is closed. New `src/lib/walletSkillScoring.ts` pulls each tracked wallet's last 12 signatures, parses `getTransaction`'s `preBalances`/`postBalances` + `preTokenBalances`/`postTokenBalances` to find unambiguous SOL↔SPL-token swaps (a tx where more than one token balance moves at once is skipped — no honest way to attribute the SOL delta to one mint), then FIFO-matches buys against sells per mint using the same cost-basis convention `server/services/gridPnl.ts` already established for grid fills. Only a *fully* cost-basis-matched sell counts as a scored closed trade — a sell of tokens acquired before the tracked window has no honest cost basis, so it's excluded rather than counted as pure profit, mirroring how `gridPnl.ts` handles a grid's unseeded sell side. Wallets get a confidence-discounted 0-100 skill score (thin sample sizes are pulled toward the middle, same reasoning `pairPerformance.ts`'s score already uses) plus win rate and avg realized SOL profit per closed trade. New `useWalletSkillScoring` hook polls this every 3 minutes, sequentially across wallets with a stagger — separate from the 45s `useWalletActivity` balance poll, since this one makes real `getTransaction` calls and public Solana RPC 429s hard on bursts. `WRRightPanel`'s wallet list now sorts by skill score (unscored wallets stay at the bottom, same "rank, don't hide" convention as `rankByPerformance()`) and shows a 🎯 score / win-rate / avg-SOL badge once a wallet has at least one closed trade.
- **The wallet tracker is actually live now** (v9.6): `WRRightPanel`'s "🐳 WALLETS" tab let you add a Solana address + label since long before this work started, but `WalletEntry.lastActivity` was a field that never got populated — no balance, no activity, just a static labeled list. `src/lib/solanaWallet.ts` now fetches real SOL balance and recent-transaction data via public Solana RPC (no key needed), refreshed every 45s by the new `useWalletActivity` hook. Also: `WRTracker.tsx`'s watchlist bar and this wallet list both benefit from the existing `rankByPerformance()`/real-activity work already in this codebase rather than reading as decoration.
- **Grid maintenance, Volume Maker's trading loop, and real grid PNL — all shipped** (v9.5): `server/services/nexusBotWorker.ts`'s poll loop now does what it previously only stubbed. Grid maintenance: when a level fills (`ccxt.fetchOrder` status check), the opposite order gets re-placed one grid-step away automatically. Volume Maker: `VolumeMakerOpts` gained `exchange`/`symbol` fields (the missing piece that blocked this before), and the worker runs a small, honestly-scoped "ping-pong" tick (`NEXUS_VOLUME_MAKER_TICK_USD`, default $10 — alternating tiny market buy/sell pairs, not a sophisticated market-maker). Grid PNL: `server/services/gridPnl.ts` does FIFO cost-basis matching — sells consume the oldest unmatched buys first — so `GET /grids` reports a real running total instead of a hardcoded 0.
- **Strategy Trader — a second, complementary bot** (v9.4): `server/services/freqtradeClient.ts` bridges to a running freqtrade instance's REST API (`/api/v1/forceentry` etc.), closing the loop from whale-radar's own detection (score + ML confidence + sizing hint) into a real freqtrade position with freqtrade's own stoploss/ROI/protections as a second, independent layer on top of Nexus's own. Same secret-handling pattern as the ccxt bridge — routes through `nexus-bot-proxy`, never a client-held token. A CRITICAL alert's new 🎯 button forwards it manually (never automatically); the server enforces its own cooldown lock and a hard 50%-ML-confidence floor before anything reaches freqtrade. Also new: `mcp-nexus-bot/`, an MCP server wrapping the same `/api/nexus-bot/*` routes so Claude Desktop, Claude Code, or any MCP client can drive Nexus directly — `nexus_scan_arbitrage`, `nexus_create_grid`, `nexus_execute_arbitrage`, and read-only status tools, all through the exact same server-side gates as the browser.
- **A real trading-bot execution bridge** (v9.3) — `registerBot()` previously had no shipped implementation to plug in. `src/lib/nexus/restBridgeBot.ts` now provides one: browser → `nexus-bot-proxy` Edge Function (holds the real server token as a Supabase secret, never client-side) → Express `server/routes/nexusBot.ts` (its own independent dry-run + Postgres-backed cooldown gate, never just trusting the client) → `server/services/ccxtExecutor.ts` (real order placement via [ccxt](https://github.com/ccxt/ccxt) across Binance/OKX/Hyperliquid). Arbitrage execution and grid open/close place real orders end-to-end; grid *maintenance* and Volume Maker's trading loop are explicitly scoped out for now rather than faked — see [Connecting a Trading Bot](#-connecting-a-trading-bot) for exactly what's real today. Also new: `src/lib/nexus/nexusManifest.ts`, a machine-readable manifest of every guarded action and its live gate thresholds, meant to be handed to an LLM-driven caller as context before it acts.
- **Whale-radar side gets its own round of freqtrade concept ports** (v9.2), separate from the earlier Nexus Bot batch: `src/lib/alertCooldown.ts` (StoplossGuard/MaxDrawdownProtection — per-symbol + global circuit breaker on the alert feed itself, not just bot trades), `src/lib/notifyChannels.ts` (Discord webhook + Telegram bot push for alerts that clear the cooldown gate, configurable severity floor), `src/lib/mlScoring.ts` (FreqAI-lite — a from-scratch logistic-regression model trained on this app's own recorded signal outcomes, surfaced in `WRSignalEval`'s "🧠 ML Confidence Model" section with a train/retrain button and honest baseline-vs-high-confidence win-rate comparison), `src/lib/sizingHint.ts` (Edge-Positioning-lite — turns each signal category's real backtested expectancy into a short sizing note shown right on the live alert, not just in the eval panel), and a small multi-exchange abstraction (`src/lib/exchanges/{types,binance,bybit,okx,kraken,registry}.ts` + `src/hooks/useExchangeFeed.ts`) that added OKX and Kraken as live whale-feed sources alongside Binance/Bybit.
- **Three "logic existed but never reached the UI" gaps closed**: `src/lib/nexus/remotePairList.ts` previously fetched and displayed a curated symbol list in Settings but never actually used it to filter anything — it now gates the whale-radar scan for real via a new `remoteWhitelistFilter` in `pairFilters.ts`. The Kraken exchange adapter was fully written but never instantiated anywhere — it's now a live feed source next to OKX. And `pairFilters.ts`'s rejection reasons (why a coin didn't fire an alert) used to go straight to `console.debug` — they're now exposed through the hook and shown as a "🔍 N FILTERED" badge (hover for the reasons) next to the alert feed header.
- **Known remaining gap, called out rather than hidden**: `src/lib/nexus/pairPerformance.ts`'s `rankByPerformance()` export has no consumer yet (nothing re-sorts a symbol list by it), and `mlScoring.ts`'s `predictConfidence()` isn't surfaced per-coin in the live scanner table — only in `WRSignalEval`'s aggregate comparison. Tracked in [Roadmap](#-roadmap).
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
- **Whale transaction scanner** (`WRScanner`, `useWhaleStream`, `useWhaleWebSocket`, `useExchangeFeed`) — streams large trades from Binance and Bybit WebSockets (hardened, hand-tuned reconnect/circuit-breaker logic), plus OKX and Kraken via a generic adapter-driven hook (`src/lib/exchanges/`) — with an HTTP-seed fallback and exponential backoff + jitter reconnect if a socket drops.
- **Advanced filters** (`WRAdvancedFilters`) — filter the whale feed by exchange, size, side, symbol, etc.
- **Alert quality & delivery** (`src/lib/pairFilters.ts`, `alertCooldown.ts`, `notifyChannels.ts`, `sizingHint.ts`) — freqtrade-pattern pre-filters (dead pairs, implausible ticks, illiquid DEX pools, poor-track-record symbols, remote whitelist) keep noise out before an alert ever fires; a StoplossGuard/MaxDrawdown-style cooldown throttles what's left; alerts that clear both gates optionally push to Discord/Telegram and carry a real backtested-expectancy sizing note.
- **Stats bar, tracker & portfolio** (`WRStatsBar`, `WRTracker`) — running session stats and a watchlist/portfolio with local persistence, ordered by historical performance (`rankByPerformance()`).
- **Solana wallet tracker** (`WRRightPanel`'s 🐳 WALLETS tab, `src/lib/solanaWallet.ts`, `useWalletActivity`) — add any Solana address + a label; real SOL balance and recent-transaction activity refresh every 45s via public Solana RPC, no key required.
- **Alerts** (`WRAlertBell`) — configurable alert conditions with in-app notification bell.
- **Signal evaluation** (`WRSignalEval`, `src/lib/signalStore.ts`, `backtestMetrics.ts`, `mlScoring.ts`) — stores emitted signals, fills in realized outcome prices, and reports win-rate/profit-factor/Sharpe/Sortino/Calmar/SQN plus an optional FreqAI-lite confidence model trained on that same history.
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
- **Nexus Bot** (`useNexusBot`, `src/lib/nexus/bot.ts`) — connects a real execution backend via `RestBridgeBot` (see [Connecting a Trading Bot](#-connecting-a-trading-bot)) and reports connection state in the UI. Grid and Volume Maker executions go through the [protection engine](#-protection-engine) rather than calling the bot directly.

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

## 🔌 Connecting a Trading Bot

`registerBot()` (`src/lib/nexus/bot.ts`) accepts anything implementing the `TradingBot` interface — the app ships one real implementation, `RestBridgeBot`, rather than hardcoding a specific exchange or bot product into the frontend.

**Why the browser can't execute trades directly:** real exchange API keys must never reach client JS — authenticated exchange endpoints generally block browser CORS anyway, and shipping a secret to every visitor's tab is a straightforward compromise. Execution has to happen server-side.

**Architecture:**

```
Browser (RestBridgeBot)
  → supabase.functions.invoke('nexus-bot-proxy')   — browser only ever holds the public anon key
    → Edge Function (supabase/functions/nexus-bot-proxy)
        holds API_AUTH_TOKEN as a Supabase secret, never in client code
      → Express server  POST/GET/DELETE /api/nexus-bot/*  (server/routes/nexusBot.ts)
          re-checks dry-run + a Postgres-backed cooldown independently —
          never trusts that the browser's own gate already passed
        → server/services/ccxtExecutor.ts — real order placement via ccxt
            (binance, okx, hyperliquid; backpack once ccxt supports it)
```

This mirrors the same "browser → edge function → real secret held server-side" pattern already used for `coingecko-proxy`, `hyperliquid-cache`, and `whale-stream` — nothing new architecturally, just applied to order execution instead of market data.

**Setup:**
1. `npm install` inside `server/` (adds `ccxt`).
2. `psql $DATABASE_URL -f server/migrations/002_nexus_bot.sql`.
3. In `server/.env` (never committed): exchange credentials per exchange you want live (`BINANCE_API_KEY`/`BINANCE_API_SECRET`, `OKX_API_KEY`/`OKX_API_SECRET`/`OKX_API_PASSPHRASE`, ...). Only configured exchanges are usable — others fail with a clear error, not a silent no-op.
4. `supabase secrets set NEXUS_BOT_API_URL=https://your-express-server.example.com API_AUTH_TOKEN=<same value as server/.env>`, then `supabase functions deploy nexus-bot-proxy`.
5. In the app, Settings → 🐋 NEXUS BOT → **CONNECT BOT**.
6. For Strategy Trader (freqtrade bridge), also run `psql $DATABASE_URL -f server/migrations/003_strategy_trader.sql` and set `FREQTRADE_API_URL`/`FREQTRADE_API_USERNAME`/`FREQTRADE_API_PASSWORD` in `server/.env` — see [What's New](#-whats-new) for what was actually missing before this version.
7. For real push notifications, run `psql $DATABASE_URL -f server/migrations/004_push_subscriptions.sql`, set `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` in `server/.env` (generate with `npx web-push generate-vapid-keys`), and `supabase functions deploy push-proxy`.

**Dry-run is on by default, in two independent places.** The client-side toggle in Settings only affects the browser's own gate chain; the server enforces its own `NEXUS_DRY_RUN` flag regardless of what the client sends, and only turns off when **both** `NEXUS_DRY_RUN=false` **and** `NEXUS_LIVE_TRADING_CONFIRM=I_UNDERSTAND_THE_RISK` are set — a deliberately exact phrase, not a plain boolean, so it can't flip on from a stray typo.

**Scope, stated plainly:** arbitrage execution and grid open/close place real orders end-to-end. Grid *maintenance* (noticing a level filled and re-placing the opposite order one step away) and Volume Maker's trading loop are both implemented — `server/services/nexusBotWorker.ts` polls every `NEXUS_GRID_POLL_MS` (default 30s) and drives both. Grid PNL is real too: `server/services/gridPnl.ts` does FIFO cost-basis matching (sells consume the oldest unmatched buys first) rather than reporting a hardcoded 0. Volume Maker is deliberately a small "ping-pong" reference loop (`NEXUS_VOLUME_MAKER_TICK_USD`, default $10 — alternating tiny market buy/sell pairs), not a sophisticated market-maker.

**For AI agents:** `src/lib/nexus/nexusManifest.ts` exports `getManifest()` — a structured, machine-readable description of every guarded action, its exact gate thresholds (read live from `protections.ts`/`openTradesLimit.ts`, not hardcoded text), and its input/output shape. Hand this to an LLM-driven caller as context before it acts, the same way a human would read this section first.

**Or let an AI agent drive it directly:** `mcp-nexus-bot/` is an MCP server wrapping the same `/api/nexus-bot/*` routes — point Claude Desktop, Claude Code, or any other MCP client at it and it gets `nexus_scan_arbitrage`, `nexus_create_grid`, `nexus_execute_arbitrage`, and read-only status tools, all going through the exact same server-side gates as the browser. See [`mcp-nexus-bot/README.md`](mcp-nexus-bot/README.md) for setup.

### Strategy Trader — a second, complementary bot

`RestBridgeBot` (ccxt) covers what freqtrade genuinely isn't built for — cross-exchange arbitrage, grid trading. `server/services/freqtradeClient.ts` covers the reverse: single-exchange, strategy-signal-driven entries with freqtrade's own mature stoploss/ROI/protections engine as a **second, independent** layer of risk management on top of anything Nexus already does.

This closes the loop: whale-radar detects a signal (score + `mlScoring.ts` confidence + `sizingHint.ts` expectancy) → a human clicks **🎯 Send to Strategy Trader** on a CRITICAL alert (never automatic) → the same `nexus-bot-proxy` Edge Function forwards to `server/routes/strategyTrader.ts` → freqtrade's `/api/v1/forceentry`, gated by the server's own cooldown lock and a hard 50%-ML-confidence floor, independent of whatever freqtrade's own config decides.

**Setup:** requires a freqtrade instance already running with `api_server.enabled: true`. On the Express server (`server/.env`): `FREQTRADE_API_URL`, `FREQTRADE_API_USERNAME`, `FREQTRADE_API_PASSWORD` (from freqtrade's own `config.json`). Check connection status in Settings → 🎯 STRATEGY TRADER.

**Honesty note:** `server/services/freqtradeClient.ts` is written against freqtrade's documented REST API shape, not verified against a live instance in this environment — confirm each endpoint against your freqtrade version's own `/docs` (Swagger UI) before trusting it with a funded account.

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

`WRCouncilPanel` + `src/lib/council/` — a multi-agent "council" that debates a symbol and produces a final verdict + conviction score. `quick`/`standard` run five agents (Bull, Bear, Risk Desk, Trader, PM); `deep` adds a sixth, **QUANT DESK**, reading pure orderflow/derivatives positioning (funding rate, OI trend, whale buy/sell imbalance). Decisions are persisted to Supabase (`council_decisions` table) with a running memory of past calls; performance is back-filled against live price at 1h/4h/24h/7d/30d checkpoints, and a confidence-discounted 0-100 desk track-record score (`computeDeskTrackRecord()`, graded at each call's longest available horizon) is shown right in the panel next to the memory list.

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

All non-public routes require a shared bearer token (`API_AUTH_TOKEN` on the server, `VITE_API_TOKEN` on the client — they must match). Postgres schema lives in `server/schema.sql` (`npm run db:migrate`).

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
│   ├── hooks/                   # useMarketData, useWhaleStream/WebSocket, useExchangeFeed,
│   │                             # useHyperliquid, useHLManipulationScanner,
│   │                             # useHLOpportunities, useOrderflowEngine,
│   │                             # useNexusBot, useNexusMarkets, useProtections, ...
│   ├── integrations/supabase/   # Generated Supabase client + DB types
│   ├── lib/
│   │   ├── exchanges/            # OKX/Kraken/Binance/Bybit adapters (whale-feed WS) + registry
│   │   ├── council/              # AI council engine + persistence
│   │   ├── nexus/                # Arbitrage engine, bot connector + guarded execution,
│   │   │                         # protections.ts (risk engine), botTradeStore.ts (ledger),
│   │   │                         # pairPerformance.ts, openTradesLimit.ts, protectionOptimizer.ts,
│   │   │                         # remotePairList.ts, pairQuality.ts, exchanges.ts (aggregate market data)
│   │   ├── pairFilters.ts, alertCooldown.ts, notifyChannels.ts, sizingHint.ts, mlScoring.ts,
│   │   │                         # backtestMetrics.ts, signalStore.ts — whale-radar alert pipeline
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
| `API_AUTH_TOKEN` | Only if self-hosting `server/` | Bearer token required by protected `/api/*` routes. |
| `VITE_API_TOKEN` | Only if self-hosting `server/` | Must exactly match `API_AUTH_TOKEN`. |

In **Lovable**, set these under Project Settings → Environment Variables (not `.env.local`). In **Vercel**, set them under Project Settings → Environment Variables and trigger a redeploy. Supabase URL/key can also be overridden at runtime per-browser from the in-app Settings panel — no rebuild required.

---

## 🚢 Deployment Notes

- Frontend: Vercel or Lovable, static Vite build.
- Backend (`server/`): Railway/Fly.io via `Procfile` (`npm run build:server && node server/dist/index.js`).
- Hyperliquid data: deploy the `hyperliquid-cache` Supabase Edge Function + run the DB migration — see `HYPERLIQUID_DEPLOY.md`.
- If the deployed site ever shows a **blank page**: open DevTools Console first. As of this version, `src/integrations/supabase/client.ts` no longer crashes on missing env vars, so a blank screen now points to a genuine runtime error rather than a silent import-time crash — the console will show it.
- If a build **fails to deploy** right after touching anything in [Connecting a Trading Bot](#-connecting-a-trading-bot): `WRSettingsPanel.tsx` and `WRRightPanel.tsx` import `src/lib/nexus/bot.ts`, `restBridgeBot.ts`, and `strategyTraderBridge.ts` directly — a partial upload (some of those files updated, others not) fails the build with a "Cannot resolve module" or type error, not a runtime crash. Check the actual build log for the missing/mismatched module name before assuming the newest file is at fault; it's usually one of the three not being in sync with it.

---

## 🗺️ Roadmap

Both previously-open roadmap items are closed as of v9.7/v9.8 — see ✅ Done below. v9.9-v9.15 were separately-found gaps, not roadmap items: v9.9-v9.11 were "logic exists, no UI consumer," v9.12 was a fake-output variant of the same pattern, v9.13 was the inverse (a documented, UI-wired feature with no server behind it at all), v9.14 was a hardening pass on v9.13's own gating logic, and v9.15 found the same "documented but never built" pattern as v9.13 twice more (push notifications, the install prompt) while working this section's own `subscribeToPush()` item below — see [What's New](#-whats-new) for both. Two real, currently-open items, flagged honestly rather than silently left: **(1)** the Strategy Trader mlConfidence floor has no real provenance — closing it needs either server-side signal recomputation or HMAC-signed client tokens; **(2)** none of Whale Radar's Supabase Edge Functions (`nexus-bot-proxy`, `push-proxy`, and the rest) have per-user authentication — only the public anon key — because the app has no login system at all; adding one is a real feature, not a patch. Otherwise, next candidates would need a new gap identified (e.g. via a fresh pass over `freqtrade-develop` or a fresh look at what's stubbed vs. real in Nexus/Council).

✅ Done (were previously listed here as roadmap items):
- **Strategy Trader's server side actually exists now** — see [What's New](#-whats-new) above.
- **Market Sentiment now calls real AI instead of a canned template** — see [What's New](#-whats-new) above.
- **Alert pin persistence** — see [What's New](#-whats-new) above.
- **PWA install prompt and cache clearing** — the v9.10 entry describing this was itself inaccurate (no `useInstallPrompt()` or `📲 APP` group ever existed in the code); actually built in v9.15 — see [What's New](#-whats-new) above.
- **Real web push notifications** — `subscribeToPush()`/`triggerBackgroundSync()` existed since early versions but could never deliver anything, because `public/sw.js` was a self-unregistering kill switch with no `push` handler; both fixed in v9.15 — see [What's New](#-whats-new) above.
- **Scan history is now actually browsable** — see [What's New](#-whats-new) above.
- **Expand AI Council with additional agent personas and longer-horizon memory scoring** — new QUANT DESK agent persona (orderflow/derivatives positioning, `deep` depth only); `computeDeskTrackRecord()` gives the existing longest-horizon grading logic a structured, UI-visible form (0-100 score, hit rate, avg realized return) shown as a badge in `WRCouncilPanel`, where previously it was only text folded into the PM's prompt. Also fixed a latent bug found along the way: `council-persist`'s verdict allow-list had drifted from the real `CouncilVerdict` enum and was silently rejecting most decisions before they ever reached memory.
- **Smart-money wallet skill scoring** — `src/lib/walletSkillScoring.ts` parses each tracked wallet's recent swaps (SOL↔SPL-token balance deltas from `getTransaction`) and FIFO-matches buys/sells per mint into a win-rate + avg-profit-SOL skill score, polled by `useWalletSkillScoring`. See [What's New](#-whats-new) above for the exact scope and its honest limitations.
- **Live wallet tracking is now actually live** — `src/lib/solanaWallet.ts` fetches real SOL balance + recent transaction count/timing via public Solana RPC (`getBalance`/`getSignaturesForAddress`), polled every 45s by `useWalletActivity`. `WalletEntry.lastActivity` existed as a field since before this work started and was never populated; the tracker tab showed a static labeled address list with no real activity behind it.
- `src/lib/nexus/pairPerformance.ts`'s `rankByPerformance()` now orders the watchlist bar (`WRTracker.tsx`) by historical performance.
- `src/lib/mlScoring.ts`'s `predictConfidence()` is now a live per-coin "🧠N%" badge in the scanner table (`WRScanner.tsx`), alongside a win-rate badge from `getSymbolPerformance()`.
- `mcp-nexus-bot/` — an MCP server wrapping `/api/nexus-bot/*`, so an MCP-compatible AI client (Claude Desktop, Claude Code, ...) can drive Nexus directly with the same server-side gates the browser bridge goes through. See its own [README](mcp-nexus-bot/README.md).
- A Freqtrade REST API bridge as a second, complementary bot — see [Strategy Trader](#strategy-trader--a-second-complementary-bot).
- freqtrade's own pair-lock list is now visible in Settings → 🎯 STRATEGY TRADER, with a per-lock CLEAR action (`GET`/`DELETE /strategy-trader/locks`).
- Grid *maintenance* (re-placing an order once a level fills) — implemented in `server/services/nexusBotWorker.ts`, polling every `NEXUS_GRID_POLL_MS`.
- Volume Maker's real trading loop — `VolumeMakerOpts` now carries `exchange`/`symbol`; the worker runs a small "ping-pong" tick against them (`NEXUS_VOLUME_MAKER_TICK_USD`).
- Real grid PNL — `server/services/gridPnl.ts` FIFO-matches sells against the oldest unmatched buys; `GET /grids` reports the running total instead of a hardcoded 0.
- Pairlist-style pre-filters already exist: `src/lib/pairFilters.ts` (whale-feed) and `src/lib/nexus/pairQuality.ts` (bot gate) — ports of freqtrade's RangeStabilityFilter/VolatilityFilter/SpreadFilter/AgeFilter/PerformanceFilter/RemotePairList, the last two reusing `pairPerformance.ts` and `remotePairList.ts` directly rather than re-deriving the logic.
- Sortino/Calmar/SQN now computed in `src/lib/backtestMetrics.ts` alongside profit-factor/Sharpe/drawdown.
- `src/lib/nexus/pairPerformance.ts` — PerformanceFilter-style ranking of pairs by historical signal performance.
- `src/lib/nexus/openTradesLimit.ts` — FullTradesFilter-style gate that shrinks available trade slots when the bot's concurrent-position cap is reached.
- `src/lib/nexus/protectionOptimizer.ts` — hyperopt-style local grid-search that suggests protection thresholds from the bot's own closed-trade history.
- `src/lib/nexus/remotePairList.ts` — RemotePairList-style fetch of a curated/shared symbol list from an external JSON URL, now actually gating the whale-radar scan (`remoteWhitelistFilter`) rather than just displaying a fetched count.
- Dry-run mode for the Nexus Bot guarded-execution wrappers (`bot.ts`) — simulates protection gating without placing real orders.
- Multi-channel alerts (Telegram, Discord) beyond the in-app bell — `src/lib/notifyChannels.ts`, configurable per-channel severity floor, wired into `WRSettingsPanel`.
- `src/lib/alertCooldown.ts` — StoplossGuard/MaxDrawdownProtection-style per-symbol and global circuit breaker on the whale-radar alert feed itself (separate from the Nexus Bot's own `protections.ts`).
- `src/lib/mlScoring.ts` — FreqAI-lite adaptive confidence scoring trained on this app's own recorded outcomes.
- `src/lib/sizingHint.ts` — Edge-Positioning-lite expectancy-based sizing hints, shown on live alerts.
- OKX and Kraken added as live whale-feed exchange sources (`src/lib/exchanges/`), both wired into the exchange filter tabs.

---

## ⚠️ Disclaimer

Educational and informational purposes only. Not financial or trading advice. Do your own research before making any trading decisions.
