import sys
import torch
import numpy as np
import pandas as pd
from pathlib import Path
from typing import Optional

# Kronos repo is cloned to /app/Kronos at Docker build time
KRONOS_PATH = Path("/app/Kronos")
if str(KRONOS_PATH) not in sys.path:
    sys.path.insert(0, str(KRONOS_PATH))

from model import Kronos, KronosTokenizer, KronosPredictor  # noqa: E402

MODEL_CONFIGS: dict[str, tuple[str, str, int]] = {
    "mini":  ("NeoQuasar/Kronos-Tokenizer-2k",   "NeoQuasar/Kronos-mini",  2048),
    "small": ("NeoQuasar/Kronos-Tokenizer-base",  "NeoQuasar/Kronos-small",  512),
    "base":  ("NeoQuasar/Kronos-Tokenizer-base",  "NeoQuasar/Kronos-base",   512),
}

_predictor_cache: dict[str, KronosPredictor] = {}


def get_predictor(model_key: str = "mini") -> KronosPredictor:
    """Lazy-load singleton — loads model weights once per process."""
    if model_key in _predictor_cache:
        return _predictor_cache[model_key]

    tok_name, model_name, max_ctx = MODEL_CONFIGS[model_key]
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[Kronos] Loading {model_name} → {device}", flush=True)

    tokenizer = KronosTokenizer.from_pretrained(tok_name)
    model     = Kronos.from_pretrained(model_name).to(device)
    model.eval()

    predictor = KronosPredictor(model, tokenizer, max_context=max_ctx, device=device)
    _predictor_cache[model_key] = predictor
    return predictor


def run_forecast(
    df:           pd.DataFrame,
    x_timestamps: pd.Series,
    y_timestamps: pd.Series,
    pred_len:     int,
    sample_count: int,
    temperature:  float,
    top_p:        float,
    model_key:    str = "mini",
) -> tuple[pd.DataFrame, np.ndarray, np.ndarray]:
    """
    Run inference. Returns (mean_pred_df, ci_low_array, ci_high_array).
    If sample_count > 1 — multiple samples give confidence intervals.
    """
    predictor = get_predictor(model_key)

    def _predict_once() -> pd.DataFrame:
        return predictor.predict(
            df=df,
            x_timestamp=x_timestamps,
            y_timestamp=y_timestamps,
            pred_len=pred_len,
            T=temperature,
            top_p=top_p,
            sample_count=1,
        )

    if sample_count == 1:
        pred_df = _predict_once()
        closes  = pred_df["close"].values.copy()
        return pred_df, closes, closes

    all_preds:  list[pd.DataFrame] = []
    all_closes: list[np.ndarray]   = []

    for _ in range(sample_count):
        p = _predict_once()
        all_preds.append(p)
        all_closes.append(p["close"].values)

    closes_matrix = np.stack(all_closes, axis=0)   # (samples, pred_len)
    mean_closes   = closes_matrix.mean(axis=0)
    ci_low        = np.percentile(closes_matrix, 10, axis=0)
    ci_high       = np.percentile(closes_matrix, 90, axis=0)

    mean_df           = all_preds[0].copy()
    mean_df["close"]  = mean_closes
    return mean_df, ci_low, ci_high
