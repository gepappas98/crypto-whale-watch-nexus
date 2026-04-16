import httpx
import pandas as pd
import numpy as np
from datetime import datetime, timezone

BINANCE_BASE  = "https://api.binance.com"
TIMEFRAME_MAP = {"5m":"5m","15m":"15m","1h":"1h","4h":"4h","1d":"1d"}


async def fetch_ohlcv(
    symbol: str, timeframe: str, lookback: int
) -> tuple[pd.DataFrame, pd.Series]:
    """Fetch OHLCV from Binance REST. Returns (df, timestamps)."""
    interval = TIMEFRAME_MAP[timeframe]
    limit    = min(lookback, 1000)   # Binance hard cap

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"{BINANCE_BASE}/api/v3/klines",
            params={"symbol": symbol, "interval": interval, "limit": limit},
        )
        resp.raise_for_status()
        raw = resp.json()

    rows, timestamps = [], []
    for k in raw:
        timestamps.append(pd.Timestamp(k[0], unit="ms", tz="UTC"))
        rows.append({
            "open":   float(k[1]),
            "high":   float(k[2]),
            "low":    float(k[3]),
            "close":  float(k[4]),
            "volume": float(k[5]),
        })

    return pd.DataFrame(rows), pd.Series(timestamps)


def build_future_timestamps(
    last_ts: pd.Timestamp, timeframe: str, pred_len: int
) -> pd.Series:
    """Generate future timestamps for the prediction window."""
    freq_map = {"5m":"5min","15m":"15min","1h":"1h","4h":"4h","1d":"1D"}
    future   = pd.date_range(
        start=last_ts, periods=pred_len + 1, freq=freq_map[timeframe]
    )[1:]
    return pd.Series(future)


def compute_signal(
    current_close: float, forecast_closes: list[float]
) -> tuple[str, float, float]:
    """Derive signal, confidence score, and % change from forecast."""
    if not forecast_closes:
        return "NEUTRAL", 0.0, 0.0

    final = forecast_closes[-1]
    pct   = (final - current_close) / current_close * 100

    arr        = np.array(forecast_closes)
    cv         = np.std(arr) / np.mean(arr) if np.mean(arr) != 0 else 1.0
    confidence = float(np.clip(1.0 - cv * 10, 0.0, 1.0))

    if   pct >  3.0: signal = "STRONG_BULL"
    elif pct >  0.5: signal = "BULLISH"
    elif pct < -3.0: signal = "STRONG_BEAR"
    elif pct < -0.5: signal = "BEARISH"
    else:            signal = "NEUTRAL"

    return signal, confidence, pct
