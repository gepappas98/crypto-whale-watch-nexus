# 🐳 Whale Radar Nexus Pro

> Unified crypto intelligence terminal — whale detection, arbitrage, grid trading, volume making & portfolio tracking.

## Structure

```
├── src/
│   ├── pages/
│   │   ├── Index.tsx          ← Whale Radar v9 (existing)
│   │   └── NexusPro.tsx       ← NEW: Nexus Pro trading terminal
│   ├── components/
│   │   ├── whale-radar/       ← Existing Whale Radar components
│   │   └── hyperliquid/       ← Hyperliquid components
│   └── App.tsx                ← Routes: / → WhaleRadar, /pro → NexusPro
│
├── server/
│   ├── index.ts               ← Express API server
│   └── routes/
│       └── bot.ts             ← NEW: Bot bridge proxy routes
│
├── bridge.py                  ← NEW: FastAPI bot microservice
├── requirements.txt           ← Python deps for bridge.py
├── supabase/migrations/
│   └── 004_nexus_pro_bot.sql  ← NEW: Grid, arb, volume, alert tables
└── .env.example               ← All env vars documented
```

## Quick Start

### Frontend
```bash
npm install
npm run dev
# → http://localhost:8080
# → http://localhost:8080/pro  (Nexus Pro)
```

### Backend (Express)
```bash
cd server && npm install
DATABASE_URL=... npm run dev
```

### Bot Bridge (FastAPI)
```bash
pip install -r requirements.txt
uvicorn bridge:app --host 0.0.0.0 --port 8000 --reload
```

## Real Data Sources

| Feature | API |
|---------|-----|
| Whale feed | Binance WebSocket aggTrade |
| Perp prices / funding / OI | Hyperliquid REST |
| Spot prices | Binance 24hr ticker |
| Arbitrage spreads | Calculated: HL perp vs Binance spot |
| Grid / Volume execution | FastAPI bridge → your Python bot |

## Routes

| Path | Page |
|------|------|
| `/` | Whale Radar v9 |
| `/pro` | Nexus Pro Terminal |

## Deploy

- **Frontend**: Vercel (`npm run build` → `dist/`)
- **Backend**: Railway (Node.js, `server/`)
- **Bot Bridge**: Railway / EC2 (Python, `bridge.py`)
- **Database**: Supabase PostgreSQL

Set `VITE_BOT_BRIDGE_URL` to your Railway bridge URL to enable live execution.
