import asyncio
from datetime import datetime, timezone
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import Counter, Histogram, generate_latest
from fastapi import Response

from models import ForecastRequest, ForecastResponse, ForecastCandle, OHLCVCandle, HealthResponse
from data_fetcher import fetch_ohlcv, build_future_timestamps, compute_signal
from predictor import get_predictor, run_forecast

REQUEST_COUNT = Counter("kronos_requests_total", "Total requests", ["method", "endpoint", "status"])
REQUEST_LATENCY = Histogram("kronos_request_duration_seconds", "Request latency")

_CACHE: dict[str, tuple[float, ForecastResponse]] = {}
CACHE_TTL_SECONDS = 300

@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, get_predictor, "mini")
    yield

app = FastAPI(title="Kronos Inference Service", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

@app.get("/health", response_model=HealthResponse)
async def health():
    from predictor import _predictor_cache
    loaded = len(_predictor_cache) > 0
    model_name = list(_predictor_cache.keys())[0] if loaded else None
    return HealthResponse(status="ok", model_loaded=loaded, model=model_name)

@app.get("/metrics")
async def metrics():
    return Response(generate_latest(), media_type="text/plain")

@app.post("/forecast", response_model=ForecastResponse)
async def forecast(req: ForecastRequest):
    cache_key = f"{req.symbol}:{req.timeframe}:{req.model}:{req.pred_len}"
    now = datetime.now(timezone.utc).timestamp()

    if cache_key in _CACHE:
        ts, cached = _CACHE[cache_key]
        if now - ts < CACHE_TTL_SECONDS:
            return cached

    try:
        df, x_timestamps = await fetch_ohlcv(req.symbol, req.timeframe, req.lookback)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Binance fetch failed: {e}")

    y_timestamps = build_future_timestamps(x_timestamps.iloc[-1], req.timeframe, req.pred_len)

    try:
        loop = asyncio.get_event_loop()
        pred_df, ci_low, ci_high = await loop.run_in_executor(
            None,
            lambda: run_forecast(
                df=df,
                x_timestamps=x_timestamps,
                y_timestamps=y_timestamps,
                pred_len=req.pred_len,
                sample_count=req.sample_count,
                temperature=req.temperature,
                top_p=req.top_p,
                model_key=req.model,
            )
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Kronos inference failed: {e}")

    context_limit = min(50, len(df))
    context_candles = [
        OHLCVCandle(
            t=int(x_timestamps.iloc[-(context_limit - i)].timestamp() * 1000),
            o=df["open"].iloc[-(context_limit - i)],
            h=df["high"].iloc[-(context_limit - i)],
            l=df["low"].iloc[-(context_limit - i)],
            c=df["close"].iloc[-(context_limit - i)],
            v=df["volume"].iloc[-(context_limit - i)],
        )
        for i in range(context_limit)
    ]

    forecast_candles = [
        ForecastCandle(
            timestamp=y_timestamps.iloc[i].isoformat(),
            open=float(pred_df["open"].iloc[i]),
            high=float(pred_df["high"].iloc[i]),
            low=float(pred_df["low"].iloc[i]),
            close=float(pred_df["close"].iloc[i]),
            volume=float(pred_df.get("volume", pred_df["close"]).iloc[i]),
            ci_high=float(ci_high[i]),
            ci_low=float(ci_low[i]),
        )
        for i in range(req.pred_len)
    ]

    current_close = float(df["close"].iloc[-1])
    forecast_closes = [c.close for c in forecast_candles]
    signal, confidence, pct_change = compute_signal(current_close, forecast_closes)

    model_names = {"mini": "kronos-mini", "small": "kronos-small", "base": "kronos-base"}

    response = ForecastResponse(
        symbol=req.symbol,
        timeframe=req.timeframe,
        generated_at=datetime.now(timezone.utc).isoformat(),
        model=model_names[req.model],
        context_candles=context_candles,
        forecast=forecast_candles,
        signal=signal,
        confidence_score=round(confidence, 3),
        price_change_pct=round(pct_change, 2),
    )

    _CACHE[cache_key] = (now, response)
    return response
