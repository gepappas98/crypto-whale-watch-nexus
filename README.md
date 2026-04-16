# Whale Radar - Kronos AI 🔮

AI-powered crypto price prediction using the Kronos time-series foundation model.

## Lovable Setup

1. Import this repo into [Lovable.dev](https://lovable.dev)
2. Set environment variable in Lovable:
   - `VITE_KRONOS_URL`: Your Railway backend URL
3. Deploy backend separately (see below)

## Backend Deployment (Railway)

```bash
cd kronos-service
railway login
railway up
```

Required env vars:
- `PORT=8000`

## Project Structure

```
├── src/                 # Frontend (Lovable handles this)
│   ├── components/
│   ├── api/
│   └── hooks/
└── kronos-service/      # Backend (Deploy to Railway)
    ├── main.py
    ├── Dockerfile
    └── requirements.txt
```

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: FastAPI + Kronos Model + Railway
- **Data**: Binance API
