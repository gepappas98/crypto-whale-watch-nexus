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
