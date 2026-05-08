# Crypto Whale Watch Nexus — Whale Radar v9

**Real-time crypto whale tracker, market manipulation detector, and Hyperliquid explorer.**

Live: https://crypto-whale-watch-nexus.lovable.app

## What it does

Whale Radar v9 monitors large trades and unusual market behavior across major crypto venues in real time, surfacing actionable signals for traders who care about whale flows and manipulation patterns.

## Features

- **Real-time whale trades** — Binance & Bybit WebSocket feeds with configurable size thresholds
- **Solana DEX whale scanner** — Birdeye + DexScreener enrichment for memecoin and gem hunting
- **Hyperliquid explorer** — Live perpetuals markets, funding, L2 books, opportunity scanner
- **AI manipulation radar** — Detects pumps, dumps, wash trading, squeezes, insider risk
- **Order flow panel** — User-selectable symbols on `/orderflow`
- **Wallet tracker, portfolio, alerts, sound notifications**
- **Free** — no Whale Alert-style subscription required

## Tech stack

React 18 · Vite 5 · TypeScript · Tailwind · shadcn/ui · TanStack Query · Supabase (Lovable Cloud) · Recharts

## Run locally

```bash
bun install
bun run dev
```

Open http://localhost:8080.

## Deploy

Push to the connected Lovable project, then click **Publish** in the editor. Backend changes (edge functions, migrations) deploy automatically.

## License

MIT
