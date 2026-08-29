# Roadmap

This roadmap describes the work required to move Whale Radar from an advanced beta analytics platform toward a verifiable production system. Dates are intentionally omitted; completion depends on test results, deployment verification and operational readiness rather than calendar targets.

## Current status

The project is feature-rich and suitable for controlled beta analytics and dry-run experimentation. The frontend builds successfully, the Express backend has a reproducible TypeScript build, and the critical client-side flow suite covers protection gates, signal persistence and rate limits. Live-funded trading remains gated behind the hardening work below.

## Phase 0 — Release hygiene

**Goal:** make every release reproducible and auditable.

| Workstream | Definition of done |
|---|---|
| Canonical package manager | One installation path and one authoritative lockfile policy are enforced in CI. |
| Build gates | Frontend type-check, backend build, lint and tests are mandatory checks. |
| Secrets | Secret scanning rejects env files, exchange credentials, service-role keys and bearer tokens in commits and artifacts. |
| Documentation | README, changelog and roadmap are updated as part of each release. |
| Dependency maintenance | High and critical dependency advisories have an owner, upgrade plan or documented exception. |

## Phase 1 — Test and contract coverage

**Goal:** verify business-critical behavior without placing live orders.

The next test tranche should add coverage for the Express authentication middleware, protected and public route behavior, request validation, database error handling, idempotent signal recording, migration smoke tests, WebSocket reconnect and stale-connection handling, circuit-breaker transitions, open-trade limits and exchange adapter contracts. Playwright smoke tests should cover dashboard startup, scanner loading, filtering, settings, protection banners and dry-run bot flows.

All execution tests must use mocks, deterministic fixtures or exchange sandbox accounts. No CI job may require funded credentials.

## Phase 2 — Production security and resilience

**Goal:** reduce abuse and failure risk at public boundaries.

Add per-IP and per-client-key rate limits for public endpoints, bounded pagination, request timeouts, payload-size limits, structured error responses, security headers, correlation IDs and redaction of authorization data from logs. Review the intentionally unauthenticated whales and MCP surfaces for scraping and denial-of-service exposure.

Introduce health/readiness probes that distinguish process health from database, exchange, cache and worker health. Add metrics and alerts for stale market streams, reconnect storms, CoinGecko failures, database latency, queue growth, rejected orders and unexpected live-mode activation.

## Phase 3 — Durable state and worker model

**Goal:** make scheduled work safe in a multi-instance deployment.

Move price fillers and other periodic database work to one clearly owned scheduler or protect them with distributed/advisory locks. Define a singleton contract for the Nexus Bot worker. Every scheduled operation must be idempotent, observable and retry-safe. Add migration version tracking, pre-deploy backups, rollback procedures and schema drift checks.

Complete the Edge Function cutovers only after shadow testing and production verification. Every route must have one documented live owner, one fallback owner and an explicit retirement decision for legacy implementations.

## Phase 4 — Trading safety certification

**Goal:** establish evidence before enabling funded execution.

Create a formal execution checklist covering credential scope, withdrawal-permission denial, IP restrictions, dry-run defaults, exact live confirmation, maximum notional, maximum open trades, daily loss limits, slippage, stale prices, partial fills, cancel/replace behavior, exchange maintenance, network failure and emergency stop behavior.

Run the complete system against exchange testnets with recorded scenarios. Require human approval, two-person review for production configuration, a tested kill switch and a documented incident response procedure before enabling live orders.

## Phase 5 — Product expansion

**Goal:** expand intelligence capabilities after the foundation is stable.

Potential enhancements include richer historical data storage, server-side signal evaluation, configurable alert routing, user accounts and per-user portfolios, stronger model evaluation with out-of-sample validation, additional exchange adapters, improved order-book analytics, replayable market sessions and a versioned public API.

New predictive or AI features should expose data provenance, confidence, sample size, model version and invalidation conditions. Simulated, cached and live data must remain visibly distinct throughout the product.

## Exit criteria for production

The project should not be labeled production-ready for funded execution until all of the following are true:

1. Frontend and backend builds pass from clean environments.
2. Lint and type-check are clean or have explicitly reviewed exceptions.
3. Critical unit, integration, WebSocket and browser smoke tests pass in CI.
4. Dependency and secret scans pass the release policy.
5. Public endpoints have tested rate limits and abuse monitoring.
6. Database migrations, scheduled jobs and worker singleton behavior are verified in the target deployment.
7. Exchange sandbox scenarios cover order placement, rejection, timeout, partial fill, cancel and emergency stop.
8. Live trading remains disabled unless the reviewed production checklist is approved.

## Backlog principles

Reliability and safety take precedence over additional screens. Features that create or route orders require a threat model, deterministic tests, observability and a rollback path before they are merged. Historical performance must never be presented as a guarantee, and missing market data must never be replaced silently with fabricated values.
