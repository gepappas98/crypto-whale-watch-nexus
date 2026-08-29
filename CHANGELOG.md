# Changelog

All notable changes to Whale Radar are documented here. The project follows a practical release-history format rather than promising strict semantic versioning for every incremental Lovable-generated commit.

## [Unreleased]

### Quality and documentation

- Added deterministic critical-flow tests for the protection engine, trade-history locks, signal deduplication, signal evaluation, price filling and rate-limit expiration.
- Fixed the Express backend TypeScript build by repairing the server lockfile, fetch response types and ccxt type import.
- Reworked the repository README to document the current architecture, setup, environment variables, testing rules and production safety requirements.
- Added a prioritized roadmap for production hardening, observability and future feature work.

## [9.43] — 2026-08-29

### Supabase migration preparation

- Added target Edge Function implementations for whale events, the public whales mirror and scans.
- Replaced hand-built multi-row SQL placeholder arithmetic for scan coin inserts with structured array inserts.
- Added database views for whale-event summaries and top scan threats.
- Added PostgREST foreign-key embedding for scan-symbol lookups.
- Kept the existing Express routes active until a tested deployment cutover is completed.

## [9.42]

### Signal outcome persistence

- Added the `signal-outcomes` Edge Function as a target implementation for signal-fire recording and evaluation.
- Added an atomic database RPC for deduplication against the expression-based signal index.
- Added a scheduled price-filler path using database scheduling and network invocation.
- Preserved the existing Express implementation until the new path is deployed and verified.

## [9.41]

### Portfolio and tracked-token persistence

- Added target Edge Functions for portfolio and tracked-token operations.
- Added a portfolio view for latest scan data and P&L calculation.
- Added an atomic tracked-token upsert RPC that preserves an existing `coin_id` when the caller omits it.

## [9.40]

### Architecture and operational direction

- Established the target shape of browser → Supabase Edge → durable state/DB, with Express retained for persistent execution workers and trading bridges.
- Identified pure CRUD routes suitable for Edge migration and separated them from genuinely Express-only execution and worker paths.
- Added the alerts Edge Function target, including an atomic pin-toggle RPC and scheduled alert outcome price filling.
- Documented that target implementations are not automatically live until deployment, migrations and client cutover are verified.

## [9.39]

### Production hygiene

- Removed hidden fabricated-price fallback behavior from Crystal Ball analysis.
- Replaced hidden simulated Insider Risk fallback rows with explicit no-data/error states in real-data mode.
- Added explicit `dataSource` labeling for simulated Insider Risk records and CSV export.
- Hardened the whale-stream Edge Function lifecycle with runtime keep-alive, stale-instance protection, connection-attempt timeout and silent-death watchdog behavior.
- Removed the redundant legacy client-side Binance WebSocket path when the server stream is active.

## [9.25]

### Strategy and protection foundations

- Added the protection engine with cooldown, stop-loss guard, max drawdown and low-profit-pair checks.
- Added guarded Nexus Bot wrappers for arbitrage, Grid Studio and Volume Maker.
- Added dry-run defaults and an exact live-trading confirmation phrase.
- Added the bot trade ledger and real outcome reporting for closed trades.
- Added the Strategy Trader bridge for human-triggered Freqtrade entries.

## Earlier releases

Earlier incremental work introduced the Whale Radar dashboard, exchange adapters, Hyperliquid analytics, AI Council, MCP read-only tools, Trading Hub pages, PWA support, web push, wallet tracking, insider-risk analysis and the original Express/Supabase integrations. Consult the Git history for commit-level detail.

[Unreleased]: https://github.com/gepappas98/crypto-whale-watch-nexus/compare/main...HEAD
[9.43]: https://github.com/gepappas98/crypto-whale-watch-nexus/releases/tag/v9.43
[9.42]: https://github.com/gepappas98/crypto-whale-watch-nexus/commits/main/
[9.41]: https://github.com/gepappas98/crypto-whale-watch-nexus/commits/main/
[9.40]: https://github.com/gepappas98/crypto-whale-watch-nexus/commits/main/
[9.39]: https://github.com/gepappas98/crypto-whale-watch-nexus/commits/main/
[9.25]: https://github.com/gepappas98/crypto-whale-watch-nexus/commits/main/
