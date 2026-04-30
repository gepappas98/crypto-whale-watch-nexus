"""
NEXUS PRO — FastAPI Bot Bridge
Wraps your crypto trading bot functions and exposes them via HTTP.
Deploy this on Railway / AWS EC2 alongside your Python bot.

Install:
    pip install fastapi uvicorn websockets python-dotenv

Run:
    uvicorn bridge:app --host 0.0.0.0 --port 8000 --reload
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Literal, List
import asyncio
import json
import os

app = FastAPI(title="Nexus Pro Bot Bridge", version="1.0.0")

# Allow requests from your frontend (Vercel / localhost)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],           # Restrict to your Vercel domain in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── WebSocket connection manager ─────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        self.active.remove(ws)

    async def broadcast(self, data: dict):
        dead = []
        for ws in self.active:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.active.remove(ws)

manager = ConnectionManager()

# ─── Models ────────────────────────────────────────────────────────────────────

class ArbitrageConfig(BaseModel):
    symbol: str
    direction: str                          # "short_hl_long_bin" | "long_hl_short_bin"
    spreadPercent: float
    maxSize: Optional[float] = 1000         # USD position size
    exchange1: Optional[str] = "hyperliquid"
    exchange2: Optional[str] = "binance"

class GridConfig(BaseModel):
    exchange: str                           # "hyperliquid" | "backpack" | "lighter"
    symbol: str                             # e.g. "BTC/USDC"
    marketType: str                         # "spot" | "perpetual"
    mode: str                               # "normal" | "martingale" | "moving" | "scalping" | "capital_protection"
    upperPrice: float
    lowerPrice: float
    gridCount: int
    totalInvestment: float
    feeRate: Optional[float] = 0.02
    takeProfit: Optional[float] = None
    stopLoss: Optional[float] = None

class VolumeConfig(BaseModel):
    exchange: str                           # "backpack" | "lighter"
    symbol: str
    signalSource: str                       # "backpack_rest" | "hyperliquid_ws"
    targetDailyVolume: float
    autoPauseOnWhale: Optional[bool] = True
    whaleThreshold: Optional[float] = 500_000

# ─── State (replace with actual bot references) ──────────────────────────────
active_grids: dict = {}      # grid_id → GridCoordinator instance
active_volume_bots: dict = {}  # symbol → VolumeMakerService instance
active_arb_jobs: dict = {}   # job_id → ArbitrageExecutor instance

# ─── Arbitrage Endpoints ──────────────────────────────────────────────────────

@app.get("/arbitrage/opportunities")
async def get_arbitrage_opportunities():
    """
    Returns live opportunities from your UnifiedDecisionEngine.
    Plug in: from your_bot import UnifiedDecisionEngine; engine = UnifiedDecisionEngine()
    """
    # TODO: Replace with: return engine.get_opportunities()
    return {"opportunities": [], "source": "UnifiedDecisionEngine", "status": "not_connected"}

@app.post("/arbitrage/execute")
async def execute_arbitrage(config: ArbitrageConfig):
    """Trigger ArbitrageExecutor for a detected opportunity."""
    job_id = f"{config.symbol}_{id(config)}"
    # TODO: executor = ArbitrageExecutor(config); await executor.execute()
    await manager.broadcast({"type": "arb_started", "job_id": job_id, "config": config.dict()})
    return {"job_id": job_id, "status": "queued", "message": "Connect ArbitrageExecutor to activate"}

@app.get("/arbitrage/status/{job_id}")
async def arb_status(job_id: str):
    job = active_arb_jobs.get(job_id)
    if not job:
        raise HTTPException(404, f"Job {job_id} not found")
    return job

# ─── Grid Endpoints ────────────────────────────────────────────────────────────

@app.post("/grid/create")
async def create_grid(config: GridConfig):
    """Deploy a GridCoordinator instance."""
    grid_id = f"{config.exchange}_{config.symbol}_{len(active_grids)}"
    # TODO: coordinator = GridCoordinator(config); await coordinator.start()
    active_grids[grid_id] = {"config": config.dict(), "status": "active", "pnl": 0, "filled": 0}
    await manager.broadcast({"type": "grid_created", "grid_id": grid_id})
    return {"grid_id": grid_id, "status": "deployed", "message": "Connect GridCoordinator to activate"}

@app.post("/grid/{grid_id}/stop")
async def stop_grid(grid_id: str):
    if grid_id not in active_grids:
        raise HTTPException(404, f"Grid {grid_id} not found")
    # TODO: await active_grids[grid_id]["coordinator"].stop()
    active_grids.pop(grid_id)
    await manager.broadcast({"type": "grid_stopped", "grid_id": grid_id})
    return {"grid_id": grid_id, "status": "stopped"}

@app.get("/grid/list")
async def list_grids():
    return {"grids": [{"id": k, **v} for k, v in active_grids.items()]}

@app.get("/grid/{grid_id}/status")
async def grid_status(grid_id: str):
    if grid_id not in active_grids:
        raise HTTPException(404, f"Grid {grid_id} not found")
    return active_grids[grid_id]

# ─── Volume Making Endpoints ────────────────────────────────────────────────────

@app.post("/volume/start")
async def start_volume(config: VolumeConfig):
    """Start VolumeMakerService."""
    key = f"{config.exchange}_{config.symbol}"
    # TODO: bot = VolumeMakerService(config); await bot.start()
    active_volume_bots[key] = {"config": config.dict(), "status": "running", "volume": 0, "fees": 0}
    await manager.broadcast({"type": "volume_started", "key": key})
    return {"key": key, "status": "started", "message": "Connect VolumeMakerService to activate"}

@app.post("/volume/stop")
async def stop_volume(symbol: str, exchange: str):
    key = f"{exchange}_{symbol}"
    if key not in active_volume_bots:
        raise HTTPException(404, f"Volume bot {key} not found")
    active_volume_bots.pop(key)
    await manager.broadcast({"type": "volume_stopped", "key": key})
    return {"key": key, "status": "stopped"}

@app.get("/volume/stats")
async def volume_stats():
    return {"bots": list(active_volume_bots.values())}

# ─── Portfolio Endpoints ────────────────────────────────────────────────────────

@app.get("/portfolio/summary")
async def portfolio_summary():
    # TODO: aggregate from all active strategy P&L
    return {"totalAum": 0, "dailyPnl": 0, "winRate": 0, "strategies": []}

@app.get("/portfolio/history")
async def portfolio_history(limit: int = 100):
    # TODO: query from database
    return {"trades": [], "total": 0}

@app.get("/portfolio/performance")
async def portfolio_performance():
    # TODO: compute cumulative returns
    return {"cumulativeReturn": 0, "sharpe": 0, "maxDrawdown": 0, "data": []}

# ─── Alert Endpoints ────────────────────────────────────────────────────────────

@app.get("/alerts")
async def get_alerts(limit: int = 50):
    return {"alerts": [], "total": 0}

@app.post("/alerts/rules")
async def create_alert_rule(rule: dict):
    return {"id": "rule_1", "status": "created", "rule": rule}

# ─── Real-time WebSocket ────────────────────────────────────────────────────────

@app.websocket("/ws/live")
async def websocket_live(websocket: WebSocket):
    """
    Streams: bot status, fills, P&L updates, whale correlations.
    Connect from frontend: new WebSocket('ws://your-bridge:8000/ws/live')
    """
    await manager.connect(websocket)
    try:
        # Send initial state
        await websocket.send_json({
            "type": "connected",
            "grids": len(active_grids),
            "volume_bots": len(active_volume_bots),
        })
        # Keep alive + receive client messages
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=30)
                # Handle client commands
                if data.get("cmd") == "ping":
                    await websocket.send_json({"type": "pong"})
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "heartbeat"})
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# ─── Health check ──────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "grids": len(active_grids),
        "volume_bots": len(active_volume_bots),
        "ws_connections": len(manager.active),
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
