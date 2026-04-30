from trading_bot.core.volume_maker_service import VolumeMakerService
from trading_bot.core.portfolio_manager import PortfolioManager

volume_svc = VolumeMakerService()
portfolio = PortfolioManager()

@app.get("/volume/stats")
async def volume_stats(user=Depends(verify_jwt)):
    # Real stats from VolumeMakerService
    stats = await volume_svc.get_stats()
    return {
        "volume_24h": stats.total_volume_24h,
        "fees_24h": stats.total_fees_24h,
        "rebates_24h": stats.total_rebates_24h,
        "hourly_volume": stats.hourly_breakdown  # [{hour: "14:00", volume: 45000}, ...]
    }

@app.get("/volume/status")
async def volume_status(user=Depends(verify_jwt)):
    return await volume_svc.get_status()  # {running: bool, pair: str, orders_per_min: int, auto_pause_enabled: bool}

@app.post("/volume/start")
async def start_volume(config: VolumeConfig, user=Depends(verify_jwt)):
    task_id = await volume_svc.start(config)
    return {"status": "started", "task_id": task_id}

@app.post("/volume/stop")
async def stop_volume(user=Depends(verify_jwt)):
    await volume_svc.stop()
    return {"status": "stopped"}

@app.get("/portfolio/summary")
async def portfolio_summary(user=Depends(verify_jwt)):
    # Aggregate real P&L from all services
    return await portfolio.get_summary()

@app.get("/portfolio/history")
async def trade_history(limit: int = 100, format: str = "json", user=Depends(verify_jwt)):
    trades = await portfolio.get_trade_history(limit)
    if format == "csv":
        return StreamingResponse(
            generate_csv(trades),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=trades.csv"}
        )
    return trades

@app.get("/portfolio/performance")
async def performance(user=Depends(verify_jwt)):
    return await portfolio.get_performance_metrics()  # {cumulative: [{date, pnl, benchmark}], ...}

# Broadcast P&L updates every 1s
async def pnl_broadcaster():
    while True:
        await asyncio.sleep(1)
        pnl_data = await portfolio.get_realtime_pnl()
        await manager.broadcast({
            "type": "PNL_UPDATE",
            "data": {
                "total": pnl_data.total,
                "strategies": pnl_data.by_strategy
            }
        })

@app.on_event("startup")
async def start_broadcasters():
    asyncio.create_task(pnl_broadcaster())
@app.post("/grid/create")
async def create_grid(config: GridConfig, user=Depends(verify_jwt)):
    grid_id = await grid_coord.deploy(config)

    # Stream logs from real GridCoordinator
    async def log_stream():
        async for log_line in grid_coord.tail_logs(grid_id):
            await manager.broadcast({
                "type": "GRID_LOG",
                "grid_id": grid_id,
                "data": {
                    "timestamp": datetime.now().isoformat(),
                    "level": log_line.level,
                    "message": log_line.message
                }
            })

    asyncio.create_task(log_stream())
    return {"grid_id": grid_id, "status": "deploying"}
