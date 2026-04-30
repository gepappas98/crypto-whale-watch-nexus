# Bot Bridge — FastAPI Microservice

**Deploy this separately on Railway or EC2. Never on Vercel.**

## Deploy on Railway

1. Create a new Railway service pointing to this `bot-bridge/` folder
2. Set start command: `uvicorn bridge:app --host 0.0.0.0 --port $PORT`
3. Add env vars from `.env.example`
4. Copy the Railway URL → set as `VITE_BOT_BRIDGE_URL` in your Vercel frontend env

## Local dev

```bash
cd bot-bridge
pip install -r requirements.txt
uvicorn bridge:app --host 0.0.0.0 --port 8000 --reload
```

## Connect to your bot

Open `bridge.py` and replace the `# TODO` comments with your actual imports:

```python
from your_bot.grid import GridCoordinator
from your_bot.arbitrage import ArbitrageExecutor, UnifiedDecisionEngine
from your_bot.volume import VolumeMakerService
```
