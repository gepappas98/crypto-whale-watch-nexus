from pydantic import BaseModel, Field
from typing import Literal, Optional


class ForecastRequest(BaseModel):
    symbol:       str                                  = "BTCUSDT"
    timeframe:    Literal["5m","15m","1h","4h","1d"]  = "1h"
    lookback:     int   = Field(400,  ge=50,  le=2048)
    pred_len:     int   = Field(24,   ge=1,   le=120)
    sample_count: int   = Field(5,    ge=1,   le=20)
    temperature:  float = Field(1.0,  ge=0.1, le=2.0)
    top_p:        float = Field(0.9,  ge=0.0, le=1.0)
    model:        Literal["mini","small","base"]       = "mini"


class OHLCVCandle(BaseModel):
    t: int    # unix ms timestamp
    o: float
    h: float
    l: float
    c: float
    v: float


class ForecastCandle(BaseModel):
    timestamp: str    # ISO 8601
    open:      float
    high:      float
    low:       float
    close:     float
    volume:    float
    ci_high:   float  # 90th percentile across samples
    ci_low:    float  # 10th percentile across samples


class ForecastResponse(BaseModel):
    symbol:           str
    timeframe:        str
    generated_at:     str
    model:            str
    context_candles:  list[OHLCVCandle]
    forecast:         list[ForecastCandle]
    signal:           Literal["STRONG_BULL","BULLISH","NEUTRAL","BEARISH","STRONG_BEAR"]
    confidence_score: float
    price_change_pct: float


class HealthResponse(BaseModel):
    status:       str
    model_loaded: bool
    model:        Optional[str] = None
