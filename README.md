# Welcome to your Lovable project
# 🚨 Crypto Whale Watch Nexus — Whale Radar v9

**Real-time Crypto Whale Tracker + Manipulation Radar + Hyperliquid Explorer**

[![GitHub stars](https://img.shields.io/github/stars/gepappas98/crypto-whale-watch-nexus)](https://github.com/gepappas98/crypto-whale-watch-nexus)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![Hyperliquid](https://img.shields.io/badge/Hyperliquid-00FF9F?logo=bitcoin&logoColor=white)

**Live Demo:** [crypto-whale-watch-nexus.vercel.app](https://crypto-whale-watch-nexus.vercel.app) (deploy your own fork)

## ✨ Features

- **🔴 Real-time Whale Trades** — Binance + Bybit large order detection
- **🚨 AI-Powered Manipulation Radar** — Detects pumps, dumps, wash trading, squeezes, and more
- **🌊 Hyperliquid Integration** — Live markets, funding rates, L2 books, positions (via Supabase Edge cache)
- **🐳 Wallet Tracker** — Monitor specific Solana whale/dev wallets
- **📊 Portfolio & Signals** — Track your holdings + CEO Signal outcomes with backtested performance
- **⚡ Auto-Scan + Alerts** — Custom thresholds, sound alerts, pinned notifications
- **📈 Advanced Analytics** — Volume spikes, vmcap filters, Birdeye/DexScreener enrichment
- **🎨 Cyber/Matrix/Dark Themes** — Beautiful terminal-style UI with virtual scrolling
- **🔌 WebSocket Powered** — Ultra-low latency live feeds
- **🛡️ Rate-Limited & Cached** — Respects APIs, uses Supabase for heavy lifting

## 🎯 Perfect For

- **Degens** hunting early gems via whale flows
- **Traders** avoiding rugs and manipulations
- **Hyperliquid** perpetuals traders
- **Researchers** analyzing market impact and signals

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ (Bun recommended)
- Supabase project (for Hyperliquid cache & backend)
- Optional: Birdeye API key, Helius, CoinGecko, etc.

### Installation

```bash
git clone https://github.com/gepappas98/crypto-whale-watch-nexus.git
cd crypto-whale-watch-nexus
npm install
# or
bun install
Development
# Frontend only
npm run dev

# With backend (recommended)
npm run dev:all
Backend Setup
Set up PostgreSQL (Railway / Supabase / local)
Run schema: npm run db:migrate
Configure environment variables (see .env.example or Supabase Edge functions)
Hyperliquid Setup
See HYPERLIQUID_DEPLOY.md for edge function deployment.
📖 How It Works
The scanner continuously monitors top coins, detects anomalous behavior using multiple signals:
Unusual volume spikes
Price action + vmcap analysis
DEX liquidity & Birdeye data
Whale trade correlation
Historical pattern matching
CEO Signals provide actionable bias (LONG / AVOID / SHORT) with confidence scores.
🛠️ Tech Stack
Frontend: React 18 + Vite + TypeScript + Shadcn/UI + Tailwind
State: TanStack Query + Zustand-like persistence
Backend: Node/Express + PostgreSQL + Supabase
Data: Birdeye, DexScreener, Hyperliquid API, Binance/Bybit WS
Styling: Cyberpunk terminal aesthetic
📁 Project Structure
├── src/
│   ├── components/whale-radar/     # Main UI components
│   ├── lib/                        # Core logic, detection engine, state
│   └── pages/Index.tsx             # Main app
├── server/                         # Backend API & schema
├── supabase/                       # Edge functions
├── public/
└── HYPERLIQUID_DEPLOY.md
⚠️ Legal Disclaimer & Risk Warning
IMPORTANT: This is NOT financial advice.
Cryptocurrency markets are highly volatile and involve substantial risk of loss.
Past performance (including backtested signals) is not indicative of future results.
Whale activity detection does not guarantee outcomes.
This tool is for educational and informational purposes only.
Always do your own research (DYOR).
The authors and contributors are not liable for any losses incurred from using this software.
Legal Notice: This project does not provide investment recommendations. Use at your own risk. No warranties expressed or implied.
🔮 Future Roadmap (SEO-Optimized)
Multi-chain whale tracking (Ethereum, Base, Solana advanced)
On-chain AI analysis with LLMs
Mobile PWA enhancements
Advanced backtesting dashboard
Telegram/Discord bot alerts
More perpetuals exchanges integration
Machine learning threat prediction
NFT & memecoin sniper mode
🤝 Contributing
Contributions welcome! Please fork and submit PRs. Focus areas: performance, new data sources, UI polish.
📄 License
MIT License — see LICENSE for details.
Built with ❤️ for the crypto community
Stay safe, trade smart, and may the whales be with you.
TODO: Document your project here
