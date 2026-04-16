# 🔮 Whale RADAR × Crystal Ball PRO — Deployment Guide

Complete instructions to go from this repo to a live, production deployment.

---

## Architecture

```
Vercel (React/Vite frontend)
  └─ POST /forecast ──► Railway (Kronos FastAPI microservice)
                            └─ HuggingFace (NeoQuasar/Kronos-mini weights)
                            └─ Binance REST (live OHLCV data)
```

---

## Step 1 — Deploy the Kronos Inference Service (Railway)

The backend lives in `kronos_service/`. It must be deployed **first** so you have a URL to give to the frontend.

### Prerequisites
- [Railway account](https://railway.app) (free Hobby plan = $5/mo, enough for CPU/mini)
- [Railway CLI](https://docs.railway.app/develop/cli): `npm install -g @railway/cli`

### Deploy

```bash
# 1. Login
railway login

# 2. Create a new project
railway new whale-radar-kronos

# 3. Deploy from the kronos_service folder
cd kronos_service
railway up
```

Railway auto-detects the `Dockerfile` and builds the image.

### Environment Variables (Railway Dashboard)

In your Railway project → **Variables** tab, add:

| Variable | Value | Notes |
|---|---|---|
| `PORT` | _(auto-set by Railway)_ | Do not override |
| `HF_TOKEN` | `hf_xxx...` | Only needed if model is gated |

### Get your service URL

Railway → your service → **Settings** → **Networking** → Generate Domain.

It will look like: `https://whale-radar-kronos-production.up.railway.app`

### Verify

```bash
curl https://your-service.up.railway.app/health
# → {"status":"ok","model_loaded":true,"model":"mini"}
```

> **First cold start takes ~30–60s** — the model weights (~800MB) download from HuggingFace.
> Subsequent requests are fast. The `/health` endpoint pre-warms the model.

---

## Step 2 — Deploy the Frontend (Vercel)

### Prerequisites
- [Vercel account](https://vercel.com)
- Repo pushed to GitHub (or use `vercel --prod` CLI)

### Environment Variables (Vercel Dashboard)

Project → **Settings** → **Environment Variables**:

| Variable | Value |
|---|---|
| `VITE_KRONOS_URL` | Your Railway service URL from Step 1 |
| `VITE_BIRDEYE_KEY` | Your Birdeye API key (optional) |
| `VITE_SUPABASE_URL` | Supabase URL (optional) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (optional) |

### Deploy

```bash
# Option A — push to GitHub, Vercel auto-deploys on merge to main

# Option B — CLI
npm install -g vercel
vercel --prod
```

Build settings (auto-detected from `vite.config.ts`):
- **Framework**: Vite
- **Build command**: `npm run build`
- **Output directory**: `dist`

---

## Step 3 — Verify End-to-End

1. Open your Vercel URL
2. In Whale RADAR, click **🔮 CBP** button in the scanner toolbar (or press `C`)
3. Select a coin + timeframe → click **▶ FORECAST**
4. You should see the purple forecast chart appear within 4–9s (CPU) or <1s (GPU)

---

## Resource Guide

| Need | Config | Cost |
|---|---|---|
| Demo / dev | Railway Hobby, CPU, Kronos-mini | ~$5/mo |
| Production (low traffic) | Railway Pro, CPU, Kronos-mini | ~$20/mo |
| Production (fast) | Railway Pro, GPU T4, Kronos-mini | ~$34/mo |
| Max accuracy | Railway Pro, GPU T4, Kronos-small | ~$34/mo |

GPU cuts latency from 4–9s → ~0.7s. Upgrade when usage justifies it.

---

## Local Development

```bash
# 1. Frontend
cp .env.example .env
# Set VITE_KRONOS_URL=http://localhost:8000 for local backend
npm install
npm run dev   # → http://localhost:5173

# 2. Backend (requires Python 3.11+, CUDA optional)
cd kronos_service
pip install -r requirements.txt

# Clone Kronos model code
git clone https://github.com/shiyu-coder/Kronos.git /tmp/Kronos
export PYTHONPATH="/tmp/Kronos:$PYTHONPATH"

uvicorn main:app --host 0.0.0.0 --port 8000 --reload
# → http://localhost:8000/health
```

---

## Tighten CORS for Production

In `kronos_service/main.py`, change:

```python
# Development (permissive)
allow_origins=["*"],

# Production (specific)
allow_origins=["https://your-app.vercel.app"],
```

---

## File Map — What Was Added

```
whale-radar-kronos/
├── .env.example                              ← copy to .env, fill values
├── src/
│   ├── api/
│   │   └── kronosClient.ts                  ← NEW: API client + types
│   ├── hooks/
│   │   └── useKronos.ts                     ← NEW: React hook
│   └── components/whale-radar/
│       └── WRCrystalBallPro.tsx             ← NEW: Crystal Ball PRO tab
│
│   (patched files)
│   ├── src/pages/Index.tsx                  ← +import, +modal, +kbd shortcut C
│   ├── src/components/whale-radar/
│   │   ├── WRScanner.tsx                    ← +🔮 CBP toolbar button
│   │   └── WRKeyboardHelp.tsx               ← +C shortcut entry
│
└── kronos_service/                          ← NEW: Railway microservice
    ├── main.py                              ← FastAPI app, /forecast, /health
    ├── predictor.py                         ← KronosPredictor singleton
    ├── data_fetcher.py                      ← Binance OHLCV + signal logic
    ├── models.py                            ← Pydantic schemas
    ├── requirements.txt
    ├── Dockerfile
    └── railway.json                         ← Railway config
```
