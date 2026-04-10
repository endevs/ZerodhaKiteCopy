"""
Moirai 2.0 prediction service for constituent-based index forecasting.
Uses index + constituent data (when available) to predict index close.
Falls back to univariate (index-only) if constituent fetch fails.
"""
import os
import time
import datetime
import logging
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

_backend_dir = os.path.dirname(os.path.abspath(__file__))

# Reuse fetch and helpers from timesfm_service
from timesfm_service import (
    CONTEXT_LEN,
    MIN_CONTEXT,
    TOKEN_MAP,
    _fetch_candles_for_range,
    _format_candle_datetime,
    _candle_date,
    candles_to_close_series,
)

from index_constituents import (
    get_index_token,
    get_constituent_tokens,
    get_constituent_symbols,
)

# Moirai 2.0 config
MOIRAI_CONTEXT_LEN = 400  # Use 400 for intraday (align with TimesFM); max 1680
MOIRAI_MODEL_ID = "Salesforce/moirai-2.0-R-small"
# Optional: MOIRAI_MODEL_PATH env = local directory with config.json (avoids HF cache symlink issues on Windows)

# Constituent limits per index (Nifty 50 = 50, Bank Nifty = 14)
CONSTITUENT_LIMITS = {"NIFTY": 50, "BANKNIFTY": 14}


def _fetch_index_and_constituent_candles(
    kite: Any,
    index: str,
    start_date: datetime.date,
    end_date: datetime.date,
    fetch_constituents: bool = True,
) -> Tuple[List[dict], Optional[Dict[str, List[dict]]]]:
    """
    Fetch index candles and optionally constituent candles.
    Returns (index_candles, constituent_candles_by_symbol or None).
    """
    idx = (index or "").strip().upper()
    if idx not in ("NIFTY", "BANKNIFTY"):
        return [], None

    token = get_index_token(idx)
    if not token:
        return [], None

    index_candles = _fetch_candles_for_range(kite, token, start_date, end_date)
    if not index_candles:
        return [], None

    if not fetch_constituents:
        return index_candles, None

    constituent_tokens = get_constituent_tokens(kite, idx)
    if not constituent_tokens:
        return index_candles, None

    limit = CONSTITUENT_LIMITS.get(idx, 20)
    constituent_candles: Dict[str, List[dict]] = {}
    for sym, tok in list(constituent_tokens.items())[:limit]:
        try:
            candles = _fetch_candles_for_range(kite, tok, start_date, end_date)
            if candles:
                constituent_candles[sym] = candles
        except Exception as e:
            logger.debug("Constituent fetch failed for %s: %s", sym, e)
        time.sleep(0.1)

    return index_candles, constituent_candles if constituent_candles else None


def _align_constituents_to_index(
    index_candles: List[dict],
    constituent_candles: Dict[str, List[dict]],
    context_len: int,
) -> Optional[np.ndarray]:
    """
    Align constituent close prices to index timestamps for the last context_len points.
    Returns (context_len, num_constituents) float32 array of returns, or None if insufficient.
    Uses returns (pct change) for scale stability.
    """
    from ai_ml import candles_to_dataframe

    if not index_candles or not constituent_candles:
        return None

    idx_df = candles_to_dataframe(index_candles)
    if idx_df.empty or len(idx_df) < context_len:
        return None

    idx_df = idx_df.tail(context_len).copy()
    index_times = idx_df.index.values

    returns_list: List[np.ndarray] = []

    for sym, candles in constituent_candles.items():
        if not candles:
            continue
        cdf = candles_to_dataframe(candles)
        if cdf.empty or "close" not in cdf.columns:
            continue
        cdf = cdf[~cdf.index.duplicated(keep="first")]
        try:
            target_idx = pd.DatetimeIndex(index_times)
            aligned = cdf["close"].reindex(target_idx, method="ffill").ffill().bfill()
        except Exception:
            continue
        if aligned.isna().any() or len(aligned) != context_len:
            continue
        close = aligned.values.astype(np.float32)
        ret = np.zeros(context_len, dtype=np.float32)
        for i in range(1, context_len):
            if close[i - 1] > 0:
                ret[i] = (close[i] - close[i - 1]) / close[i - 1]
        returns_list.append(ret)

    if len(returns_list) < 5:
        return None

    # Shape (context_len, num_constituents); GluonTS expects (num_features, time) -> transpose
    matrix = np.column_stack(returns_list).astype(np.float32)
    return matrix


def _moirai_forecast_multivariate(
    context: np.ndarray,
    past_feat: np.ndarray,
    horizon: int,
) -> np.ndarray:
    """
    Run Moirai 2.0 multivariate forecast with constituent returns as past_feat_dynamic_real.
    context: (ctx_len,) index close; past_feat: (ctx_len, num_constituents) constituent returns.
    Returns forecast array of shape (horizon,).
    """
    from uni2ts.model.moirai2 import Moirai2Forecast, Moirai2Module
    import pandas as pd

    ctx_len = min(MOIRAI_CONTEXT_LEN, len(context))
    if ctx_len < 100:
        raise ValueError(f"Moirai needs at least 100 context points, got {ctx_len}")

    target = np.array(context[-ctx_len:], dtype=np.float32)
    if target.ndim > 1:
        target = target.flatten()

    # past_feat: (ctx_len, D) -> GluonTS expects (D, T) for past_feat_dynamic_real
    feat = np.asarray(past_feat[-ctx_len:], dtype=np.float32)
    if feat.shape[0] != ctx_len:
        raise ValueError(f"past_feat length {feat.shape[0]} != context {ctx_len}")
    past_feat_transposed = feat.T  # (num_constituents, ctx_len)

    start_ts = pd.Timestamp.now(tz="Asia/Kolkata") - pd.Timedelta(minutes=5 * (ctx_len - 1))
    input_entry = {
        "target": target,
        "start": start_ts,
        "past_feat_dynamic_real": past_feat_transposed,
    }

    model_path = os.environ.get("MOIRAI_MODEL_PATH", "").strip()
    if model_path and os.path.isdir(model_path) and "config.json" in os.listdir(model_path):
        module = Moirai2Module.from_pretrained(model_path)
    else:
        module = Moirai2Module.from_pretrained(MOIRAI_MODEL_ID)

    num_feat = past_feat_transposed.shape[0]
    model = Moirai2Forecast(
        module=module,
        prediction_length=horizon,
        context_length=ctx_len,
        target_dim=1,
        feat_dynamic_real_dim=0,
        past_feat_dynamic_real_dim=num_feat,
    )
    predictor = model.create_predictor(batch_size=1)
    forecasts = list(predictor.predict(iter([input_entry])))

    if not forecasts:
        raise RuntimeError("Moirai returned no forecast")

    forecast_obj = forecasts[0]
    if hasattr(forecast_obj, "mean"):
        point = forecast_obj.mean
    elif hasattr(forecast_obj, "quantile"):
        point = forecast_obj.quantile(0.5)
    elif hasattr(forecast_obj, "samples"):
        point = np.median(forecast_obj.samples, axis=0)
    else:
        raise RuntimeError("Cannot extract point forecast from Moirai output")

    out = np.array(point, dtype=np.float32)
    if out.ndim > 1:
        out = out.flatten()
    return out[:horizon]


def _moirai_forecast_univariate(
    context: np.ndarray,
    horizon: int,
) -> np.ndarray:
    """
    Run Moirai 2.0 univariate forecast on index close series.
    Returns forecast array of shape (horizon,).
    """
    from uni2ts.model.moirai2 import Moirai2Forecast, Moirai2Module
    import pandas as pd

    ctx_len = min(MOIRAI_CONTEXT_LEN, len(context))
    if ctx_len < 100:
        raise ValueError(f"Moirai needs at least 100 context points, got {ctx_len}")

    target = np.array(context[-ctx_len:], dtype=np.float32)
    if target.ndim > 1:
        target = target.flatten()

    # GluonTS input format: dict with "target" and "start"
    start_ts = pd.Timestamp.now(tz="Asia/Kolkata") - pd.Timedelta(minutes=5 * (ctx_len - 1))
    input_entry = {
        "target": target,
        "start": start_ts,
    }

    model_path = os.environ.get("MOIRAI_MODEL_PATH", "").strip()
    if model_path and os.path.isdir(model_path) and "config.json" in os.listdir(model_path):
        module = Moirai2Module.from_pretrained(model_path)
    else:
        module = Moirai2Module.from_pretrained(MOIRAI_MODEL_ID)
    model = Moirai2Forecast(
        module=module,
        prediction_length=horizon,
        context_length=ctx_len,
        target_dim=1,
        feat_dynamic_real_dim=0,
        past_feat_dynamic_real_dim=0,
    )
    predictor = model.create_predictor(batch_size=1)
    forecasts = list(predictor.predict(iter([input_entry])))

    if not forecasts:
        raise RuntimeError("Moirai returned no forecast")

    forecast_obj = forecasts[0]
    # GluonTS Forecast: use mean for point forecast
    if hasattr(forecast_obj, "mean"):
        point = forecast_obj.mean
    elif hasattr(forecast_obj, "quantile"):
        point = forecast_obj.quantile(0.5)
    elif hasattr(forecast_obj, "samples"):
        point = np.median(forecast_obj.samples, axis=0)
    else:
        raise RuntimeError("Cannot extract point forecast from Moirai output")

    out = np.array(point, dtype=np.float32)
    if out.ndim > 1:
        out = out.flatten()
    return out[:horizon]


def run_moirai_on_candles(
    candles: List[dict],
    horizon: int = 12,
    segment: str = "last",
    predict_future: bool = False,
) -> Optional[np.ndarray]:
    """
    Run Moirai 2.0 forecast on pre-fetched candles.
    Returns forecast array or None on failure.
    """
    if not candles or len(candles) < MIN_CONTEXT:
        return None
    close_series = candles_to_close_series(candles)
    if predict_future:
        context = close_series[-MOIRAI_CONTEXT_LEN:] if len(close_series) > MOIRAI_CONTEXT_LEN else close_series
    else:
        effective_len = min(MOIRAI_CONTEXT_LEN, len(close_series) - horizon)
        if effective_len < MIN_CONTEXT:
            return None
        context = close_series[-(effective_len + horizon) : -horizon]
        context = context[-MOIRAI_CONTEXT_LEN:] if len(context) > MOIRAI_CONTEXT_LEN else context
    try:
        return _moirai_forecast_univariate(context, horizon)
    except Exception as e:
        logger.warning("Moirai forecast failed: %s", e)
        return None


def _candle_datetime(candle: dict) -> Optional[datetime.datetime]:
    """Extract datetime from candle."""
    dt = candle.get("date") or candle.get("Date")
    if dt is None:
        return None
    if isinstance(dt, str):
        try:
            return datetime.datetime.fromisoformat(dt.replace("Z", "+00:00").replace("+05:30", ""))
        except (ValueError, TypeError):
            return None
    if isinstance(dt, datetime.datetime):
        return dt
    return None


def _slice_candles_from_time(
    candles: List[dict],
    holdout_start_time: str,
    horizon: int,
) -> Optional[Tuple[List[dict], List[dict]]]:
    """
    Slice candles: holdout starts at holdout_start_time (HH:MM) on last trading day.
    Returns (context_candles, actual_candles) or None.
    """
    if not candles or not holdout_start_time:
        return None
    try:
        parts = holdout_start_time.strip().split(":")
        h, m = int(parts[0]), int(parts[1]) if len(parts) > 1 else 0
        start_time = datetime.time(h, m)
    except (ValueError, IndexError):
        return None

    by_date: Dict[datetime.date, List[dict]] = {}
    for c in candles:
        d = _candle_date(c)
        if d:
            by_date.setdefault(d, []).append(c)

    if not by_date:
        return None
    last_date = max(by_date.keys())
    day_candles = sorted(by_date[last_date], key=lambda c: (_candle_datetime(c) or datetime.datetime.min))
    actual_candles = []
    for c in day_candles:
        dt = _candle_datetime(c)
        if dt and dt.time() >= start_time:
            actual_candles.append(c)
            if len(actual_candles) >= horizon:
                break
    if len(actual_candles) < horizon:
        return None
    actual_candles = actual_candles[:horizon]
    cutoff_dt = _candle_datetime(actual_candles[0])
    context_candles = [c for c in candles if _candle_datetime(c) and _candle_datetime(c) < cutoff_dt]
    if len(context_candles) < MIN_CONTEXT:
        return None
    return context_candles, actual_candles


def run_moirai_index_forecast(
    kite: Any,
    index: str,
    from_date: datetime.date,
    to_date: datetime.date,
    horizon: int = 12,
    segment: str = "last",
    predict_future: bool = False,
    use_constituents: bool = True,
    holdout_start_time: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Run Moirai 2.0 index forecast. Returns { actual, moirai, timestamps, error }.
    When use_constituents=True (default), uses constituent returns as past features if available.
    holdout_start_time: e.g. "11:30" to start holdout at 11:30 AM on last trading day.
    """
    result: Dict[str, Any] = {
        "actual": [],
        "moirai": [],
        "timestamps": [],
        "error": None,
    }

    idx = (index or "").strip().upper()
    if idx not in ("NIFTY", "BANKNIFTY"):
        result["error"] = "Invalid index. Use NIFTY or BANKNIFTY"
        return result

    min_required = horizon + MIN_CONTEXT if not predict_future else MIN_CONTEXT
    context_start = from_date - datetime.timedelta(days=10)
    index_candles, constituent_candles = _fetch_index_and_constituent_candles(
        kite, idx, context_start, to_date, fetch_constituents=use_constituents
    )

    if len(index_candles) < min_required:
        result["error"] = f"Not enough candles: {len(index_candles)} (need {min_required})"
        return result

    close_series = candles_to_close_series(index_candles)

    ctx_len: int
    if predict_future:
        context = close_series[-MOIRAI_CONTEXT_LEN:] if len(close_series) > MOIRAI_CONTEXT_LEN else close_series
        ctx_len = len(context)
        last_candle = index_candles[-1] if index_candles else {}
        dt = last_candle.get("date") or last_candle.get("Date")
        if isinstance(dt, str):
            try:
                dt = datetime.datetime.fromisoformat(dt.replace("Z", "+00:00").replace("+05:30", ""))
            except (ValueError, TypeError):
                dt = datetime.datetime.now()
        if not isinstance(dt, datetime.datetime):
            dt = datetime.datetime.now()
        result["timestamps"] = [
            (dt + datetime.timedelta(minutes=5 * (i + 1))).strftime("%Y-%m-%d %H:%M")
            for i in range(horizon)
        ]
        result["actual"] = []
    else:
        candles_for_ctx = index_candles
        if holdout_start_time:
            sliced = _slice_candles_from_time(index_candles, holdout_start_time, horizon)
            if not sliced:
                result["error"] = f"Not enough candles for holdout from {holdout_start_time}"
                return result
            context_candles, actual_candles = sliced
            context = candles_to_close_series(context_candles)
            actual = candles_to_close_series(actual_candles)
            candles_for_ctx = context_candles
        else:
            effective_len = min(MOIRAI_CONTEXT_LEN, len(close_series) - horizon)
            if effective_len < MIN_CONTEXT:
                result["error"] = "Not enough context for Moirai"
                return result
            actual = close_series[-horizon:].copy()
            context = close_series[-(effective_len + horizon) : -horizon]
            actual_candles = index_candles[-horizon:]
            candles_for_ctx = index_candles[-(effective_len + horizon) : -horizon]

        context = context[-MOIRAI_CONTEXT_LEN:] if len(context) > MOIRAI_CONTEXT_LEN else context
        ctx_len = len(context)

        result["timestamps"] = [
            _format_candle_datetime(c) for c in actual_candles
        ] if len(actual_candles) >= horizon else [f"Step {i+1}" for i in range(horizon)]
        result["actual"] = [float(x) for x in actual]

    past_feat = None
    if use_constituents and constituent_candles:
        past_feat = _align_constituents_to_index(
            candles_for_ctx, constituent_candles, ctx_len
        )

    try:
        if past_feat is not None:
            logger.info("Using Moirai multivariate forecast with %d constituent features", past_feat.shape[1])
            moirai_forecast = _moirai_forecast_multivariate(context, past_feat, horizon)
        else:
            moirai_forecast = _moirai_forecast_univariate(context, horizon)
        result["moirai"] = [float(x) for x in moirai_forecast]
    except ImportError as e:
        result["error"] = f"Moirai/uni2ts not installed: {e}"
        return result
    except Exception as e:
        logger.exception("Moirai forecast failed")
        result["error"] = str(e)
        return result

    return result


def run_moirai_index_forecast_full_day(
    kite: Any,
    index: str,
    target_date: datetime.date,
    horizon: int = 12,
) -> Dict[str, Any]:
    """
    Run rolling Moirai 2.0 forecast across full trading day.
    Returns { moirai, error } - actual/timestamps come from timesfm_service.
    """
    result: Dict[str, Any] = {"moirai": [], "error": None}

    idx = (index or "").strip().upper()
    if idx not in ("NIFTY", "BANKNIFTY"):
        result["error"] = "Invalid index"
        return result

    context_start = target_date - datetime.timedelta(days=10)
    index_candles, constituent_candles = _fetch_index_and_constituent_candles(
        kite, idx, context_start, target_date
    )
    if not index_candles:
        result["error"] = "No candles fetched"
        return result

    by_date: Dict[datetime.date, list] = {}
    for c in index_candles:
        d = _candle_date(c)
        if d:
            by_date.setdefault(d, []).append(c)

    if target_date not in by_date:
        result["error"] = f"No candles for {target_date}"
        return result

    day_candles = sorted(by_date[target_date], key=lambda c: (c.get("date") or c.get("Date") or ""))
    prior_candles = []
    for d in sorted(by_date.keys()):
        if d < target_date:
            prior_candles.extend(sorted(by_date[d], key=lambda c: (c.get("date") or c.get("Date") or "")))

    if len(prior_candles) < MIN_CONTEXT:
        result["error"] = f"Not enough prior candles: {len(prior_candles)}"
        return result

    moirai_all: List[float] = []
    i = 0
    while i < len(day_candles):
        chunk_size = min(horizon, len(day_candles) - i)
        context_candles = prior_candles + day_candles[:i]
        if len(context_candles) < MIN_CONTEXT:
            i += chunk_size
            continue

        close_series = candles_to_close_series(context_candles)
        context = close_series[-MOIRAI_CONTEXT_LEN:] if len(close_series) > MOIRAI_CONTEXT_LEN else close_series
        ctx_len = len(context)
        past_feat = _align_constituents_to_index(
            context_candles, constituent_candles, ctx_len
        ) if constituent_candles else None

        try:
            if past_feat is not None:
                pred = _moirai_forecast_multivariate(context, past_feat, chunk_size)
            else:
                pred = _moirai_forecast_univariate(context, chunk_size)
            moirai_all.extend([float(x) for x in pred])
        except Exception as e:
            result["error"] = f"Moirai chunk failed at {i}: {e}"
            return result

        i += chunk_size

    result["moirai"] = moirai_all
    return result
