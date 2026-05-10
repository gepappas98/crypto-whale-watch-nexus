
```markdown
# 🐋 Crypto Whale Watch Nexus

![Version](https://img.shields.io/badge/version-9.0-blue)
![React](https://img.shields.io/badge/React-18.0-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript)
![License](https://img.shields.io/badge/license-MIT-green)
![Deployment](https://img.shields.io/badge/deployment-Lovable-success)

A next-generation, real-time crypto intelligence platform designed to track whale movements, detect market manipulation, and provide actionable trading signals. Built with a modern React stack, it features live WebSocket feeds, advanced analytics, and a modular architecture for professional crypto traders and enthusiasts.

---

## 📑 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [Live Demo](#-live-demo)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Usage Guide](#-usage-guide)
- [API Integration](#-api-integration)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)
- [Disclaimer](#-disclaimer)
- [Author](#-author)

---

## 🔭 Overview

Crypto Whale Watch Nexus is a frontend-focused application that transforms raw blockchain and market data into a unified, real-time command center. It empowers users to monitor high-value transactions, analyze order flow, and uncover market patterns. While originally designed for visualization, the project now includes a suite of advanced modules for trading, backtesting, and sentiment analysis, serving as a foundation for a complete crypto intelligence ecosystem.

---

## ✨ Key Features

### 📊 Core Dashboard
*   **Live Market Data:** Real-time display of cryptocurrency prices, volumes, and market caps.
*   **Whale Transaction Visibility:** Dedicated feed highlighting large, impactful transactions across multiple assets.
*   **Responsive UI:** A mobile-first design that adapts seamlessly to any screen size for on-the-go monitoring.

### 🐋 Nexus Intelligence Suite
*   **Nexus Whale Watch:** Advanced visualization of whale accumulation and distribution patterns.
*   **Nexus Arbitrage:** Real-time cross-exchange arbitrage opportunity scanner.
*   **Nexus Crystal Ball:** Predictive market trend analysis and probability modeling.
*   **Nexus Grid Studio:** Visual grid-based trading strategy builder and backtester.
*   **Nexus Portfolio:** Comprehensive portfolio tracking with real-time P&L and risk metrics.
*   **Nexus Volume Maker:** Synthetic volume generation for market making strategies.

### 🧠 Trading Hub
*   **Dashboard:** Centralized trading command center with configurable widgets.
*   **Screener:** Advanced multi-timeframe market screener with customizable filters.
*   **Technical Analysis:** Integrated charting with popular indicators (MA, RSI, MACD, Bollinger Bands).
*   **Patterns:** Automated recognition of bullish and bearish candlestick patterns.
*   **Sentiment Analysis:** AI-driven social media and news sentiment aggregation.
*   **Backtest Engine:** Historical strategy testing with detailed performance reports.
*   **Timeframes:** Support for 1m, 5m, 15m, 1h, 4h, 1D, and 1W intervals.

### 📡 Real-Time Order Flow Scanner
*   **Orderflow Page:** Live visualization of bid/ask imbalances and large block trades.
*   **Manipulation Detection:** Algorithms to flag potential market manipulation (spoofing, layering).
*   **Hyperliquid Integration:** Dedicated hooks and services for deep Hyperliquid exchange analytics.

### 🔔 Signals & Alerts (Planned/In Progress)
*   **Signal Engine:** Customizable alert conditions based on whale activity or technical breakouts.
*   **Multi-Channel Notifications:** Browser, Email, Telegram, and Discord alerts.

---

## 🌐 Live Demo

The application is deployed and can be accessed via two endpoints:

*   **Primary Domain (Lovable):** [https://crypto-whale-watch-nexus.lovable.app](https://crypto-whale-watch-nexus.lovable.app)
*   **Alternative (Vercel):** [https://crypto-whale-watch-nexus.vercel.app](https://crypto-whale-watch-nexus.vercel.app)

> Note: The application requires JavaScript enabled to deliver live data via WebSocket connections.

---

## 🛠️ Tech Stack

| Category | Technology | Purpose |
|----------|------------|---------|
| **Frontend** | React 18 + TypeScript | Core UI and type safety |
| **Build Tool** | Vite | Fast development and bundling |
| **Styling** | Tailwind CSS, shadcn/ui | Utility-first design system |
| **State Management** | React Context + Hooks | Component-level reactive state |
| **Real-Time Data** | WebSocket Client | Live market feeds and order flow |
| **Data Sources** | External Crypto APIs, Hyperliquid, Supabase | Multi-source data aggregation |
| **Testing** | Vitest | Unit and integration testing |
| **Deployment** | Lovable, Vercel | Cloud hosting with continuous deployment |
| **Service Worker** | Workbox | Offline caching and performance |

---

## 📁 Project Structure

```

crypto-whale-watch-nexus/
├── public/
│   ├── favicon.ico
│   ├── manifest.json
│   ├── og-image.png
│   ├── robots.txt
│   ├── sitemap.xml
│   └── sw.js
├── src/
│   ├── assets/             # Static images and fonts
│   ├── components/         # Reusable UI components (shadcn)
│   ├── hooks/              # Custom React hooks
│   │   ├── useMarketData.ts        # Core market data fetching
│   │   ├── useHyperliquid.ts       # Hyperliquid exchange API
│   │   ├── useOrderflowEngine.ts   # Real-time order flow analysis
│   │   ├── useHLManipulationScanner.ts  # Market manipulation detection
│   │   ├── useHLOpportunities.ts   # Hyperliquid opportunity finder
│   │   ├── useNexusBot.ts          # Automated trading bot logic
│   │   ├── useNexusMarkets.ts      # Cross-exchange market data
│   │   ├── use-mobile.tsx          # Responsive breakpoint hook
│   │   └── use-toast.ts           # Toast notification handler
│   ├── integrations/
│   │   └── supabase/        # Backend-as-a-service configuration
│   ├── lib/                 # Utility functions and helpers
│   ├── pages/
│   │   ├── Index.tsx               # Main entry dashboard
│   │   ├── Orderflow.tsx           # Order flow scanner page
│   │   ├── NotFound.tsx            # 404 error page
│   │   ├── nexus/                  # Nexus intelligence modules
│   │   │   ├── NexusWhaleWatch.tsx
│   │   │   ├── NexusArbitrage.tsx
│   │   │   ├── NexusCrystalBall.tsx
│   │   │   ├── NexusGridStudio.tsx
│   │   │   ├── NexusPortfolio.tsx
│   │   │   └── NexusVolumeMaker.tsx
│   │   └── trading-hub/            # Advanced trading tools
│   │       ├── Dashboard.tsx
│   │       ├── Screener.tsx
│   │       ├── Technical.tsx
│   │       ├── Patterns.tsx
│   │       ├── Sentiment.tsx
│   │       ├── Backtest.tsx
│   │       ├── Timeframes.tsx
│   │       └── Layout.tsx
│   ├── services/
│   │   ├── api.ts           # Generic API client
│   │   └── signals.ts       # Signal generation service
│   ├── test/                # Unit and integration tests
│   ├── types/               # TypeScript type definitions
│   ├── App.css
│   ├── App.tsx
│   ├── index.css
│   └── main.tsx
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── README.md

```

---

## 🚀 Getting Started

### Prerequisites
*   Node.js (v16.x or later)
*   npm (v7.x or later) or yarn

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/gepappas98/crypto-whale-watch-nexus.git
    cd crypto-whale-watch-nexus
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Run the development server:**
    ```bash
    npm run dev
    ```
    The app will be available at `http://localhost:5173`.

4.  **Build for production:**
    ```bash
    npm run build
    ```

---

## 📘 Usage Guide

Once the application is running, navigate through the main sections:

*   **Main Dashboard (`/`):** View live market tickers and recent whale transactions. Use the sidebar to switch between different views.
*   **Nexus Modules (`/nexus/*`):** Explore dedicated tools like Whale Watch for large-transaction visualization or Arbitrage for cross-exchange opportunities.
*   **Trading Hub (`/trading-hub/*`):** Access the complete suite of trading tools, including the Market Screener, Technical Analysis charts, and the Strategy Backtester.
*   **Order Flow (`/orderflow`):** Monitor real-time bid/ask flows and manipulation alerts. This page is highly interactive and uses WebSocket streams.

---

## 🔗 API Integration

The application is designed to be API-driven. It aggregates data from multiple external sources. To configure your own API keys or endpoints, modify the `src/services/api.ts` file. The current integration points include:

*   Cryptocurrency price and volume APIs
*   Hyperliquid exchange-specific endpoints
*   Supabase for optional user authentication and data persistence
*   Social media sentiment analysis APIs (planned)

---

## 🗺️ Roadmap

The project is actively being developed. Future improvements include:

*   **Short Term:**
    *   Enhanced real-time WebSocket streams for all market data.
    *   User-configurable whale alert thresholds.
*   **Mid Term:**
    *   Full-featured wallet tracking and labeling.
    *   Smart money detection and wallet scoring.
    *   Backend integration for persistent user preferences.
*   **Long Term:**
    *   AI-driven trade signal generation.
    *   Automated trading strategy execution.
    *   Community-driven indicator and strategy marketplace.

---

## 🤝 Contributing

Contributions are what make the open-source community an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

1.  Fork the Project
2.  Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request

---

## ⚠️ Disclaimer

This project is for **educational and informational purposes only**. It does not provide financial, investment, or trading advice. Always do your own research before making any trading decisions. The developers are not responsible for any financial losses incurred from the use of this software.

---

## 👤 Author

**Gepappas98**

*   GitHub: [https://github.com/gepappas98](https://github.com/gepappas98)
*   Project Link: [https://github.com/gepappas98/crypto-whale-watch-nexus](https://github.com/gepappas98/crypto-whale-watch-nexus)
```

