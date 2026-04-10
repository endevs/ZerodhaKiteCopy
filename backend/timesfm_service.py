"""
TimesFM prediction service - callable from API or CLI.
Runs TimesFM + LSTM + Ensemble forecast on Kite candle data.
"""
import os
import sys
import datetime
import logging
from typing import Optional, Tuple, Any, Dict, List

logger = logging.getLogger(__name__)

_backend_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _backend_dir)

# Prefer local timesfm source (TimesFM 2.5 API)
_timesfm_src = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "timesfm", "src"
)
if os.path.isdir(_timesfm_src) and _timesfm_src not in sys.path:
    sys.path.insert(0, _timesfm_src)
CONTEXT_LEN = 400
MIN_CONTEXT = 100
TRAIN_DAYS = 30
TOKEN_MAP = {"NIFTY": 256265, "BANKNIFTY": 260105}
CANDLE_INTERVAL = "5minute"


def _format_candle_datetime(candle: dict) -> str:
    """Format candle 'date' for display. Returns 'YYYY-MM-DD HH:MM' or 'HH:MM' for chart."""
    dt = candle.get("date") or candle.get("Date")
    if dt is None:
        return "-"
    if isinstance(dt, str):
        try:
            dt = datetime.datetime.fromisoformat(dt.replace("Z", "+00:00").replace("+05:30", ""))
        except (ValueError, TypeError):
            return str(dt)[:16] if len(str(dt)) >= 16 else str(dt)
    if isinstance(dt, datetime.datetime):
        return dt.strftime("%Y-%m-%d %H:%M")
    return str(dt)


def _candle_date(candle: dict) -> Optional[datetime.date]:
    """Extract date from candle for grouping by trading day."""
    dt = candle.get("date") or candle.get("Date")
    if dt is None:
        return None
    if isinstance(dt, str):
        try:
            dt = datetime.datetime.fromisoformat(dt.replace("Z", "+00:00").replace("+05:30", ""))
        except (ValueError, TypeError):
            return None
    if isinstance(dt, datetime.datetime):
        return dt.date()
    return None


def _fetch_candles_for_range(
    kite: Any,
    instrument_token: int,
    start_date: datetime.date,
    end_date: datetime.date,
    interval: str = "5minute",
) -> list:
    """Fetch 5-min candles for a date range (weekdays only)."""
    all_candles = []
    current_date = start_date
    while current_date <= end_date:
        if current_date.weekday() >= 5:
            current_date += datetime.timedelta(days=1)
            continue
        start_dt = datetime.datetime.combine(current_date, datetime.time(9, 15))
        end_dt = datetime.datetime.combine(current_date, datetime.time(15, 30))
        try:
            hist = kite.historical_data(
                instrument_token=instrument_token,
                from_date=start_dt,
                to_date=end_dt,
                interval=interval,
            )
            if hist:
                all_candles.extend(hist)
        except Exception as e:
            logger.warning("Historical fetch failed for %s: %s", current_date, e)
        current_date += datetime.timedelta(days=1)
    return all_candles


def candles_to_close_series(candles: list) -> "np.ndarray":
    """Convert Kite candles to 1D close price array."""
    import numpy as np
    from ai_ml import candles_to_dataframe

    df = candles_to_dataframe(candles)
    return df["close"].values.astype(np.float32)


def _split_candles_by_last_day(
    candles: list, horizon: int
) -> Optional[Tuple[list, list, list]]:
    """Split candles for first HORIZON of last trading day."""
    if not candles or len(candles) < horizon:
        return None
    by_date: dict = {}
    for c in candles:
        d = _candle_date(c)
        if d:
            by_date.setdefault(d, []).append(c)
    if not by_date:
        return None
    last_date = max(by_date.keys())
    last_day_candles = sorted(by_date[last_date], key=lambda c: (c.get("date") or c.get("Date") or ""))
    if len(last_day_candles) < horizon:
        return None
    actual_candles = last_day_candles[:horizon]
    context_candles = [c for c in candles if _candle_date(c) and _candle_date(c) < last_date]
    if len(context_candles) < MIN_CONTEXT:
        return None
    lstm_candles = context_candles.copy()
    return context_candles, actual_candles, lstm_candles


def run_forecast(
    kite_client: Any,
    symbol: str,
    from_date: datetime.date,
    to_date: datetime.date,
    horizon: int = 12,
    segment: str = "last",
    predict_future: bool = False,
) -> Dict[str, Any]:
    """
    Run TimesFM + LSTM + Ensemble forecast on Kite candle data.

    predict_future: If True, use all data as context and predict next horizon (no actual).
    """
    import numpy as np

    result: Dict[str, Any] = {
        "actual": [],
        "timesfm": [],
        "lstm": None,
        "ensemble": None,
        "moirai": None,
        "moirai_error": None,
        "timestamps": [],
        "best_model": "TimesFM",
        "mae": 0.0,
        "error": None,
    }

    instrument_token = TOKEN_MAP.get(symbol.upper(), TOKEN_MAP["NIFTY"])
    min_required = horizon + MIN_CONTEXT if not predict_future else MIN_CONTEXT

    # Fetch candles: from_date - 10 days for context, to_date for actual
    context_start = from_date - datetime.timedelta(days=10)
    candles = _fetch_candles_for_range(kite_client, instrument_token, context_start, to_date)

    if len(candles) < min_required:
        result["error"] = f"Not enough candles: {len(candles)} (need at least {min_required})"
        return result

    close_series = candles_to_close_series(candles)
    context = None
    actual = None
    actual_candles_for_ts = None
    candles_for_lstm = None

    if predict_future:
        # Use all data as context, predict next horizon. No actual.
        context = close_series[-CONTEXT_LEN:] if len(close_series) > CONTEXT_LEN else close_series
        candles_for_lstm = candles.copy()
        # Generate placeholder timestamps for next horizon (from last candle + 5 min each)
        last_candle = candles[-1] if candles else {}
        dt = last_candle.get("date") or last_candle.get("Date")
        if isinstance(dt, str):
            try:
                dt = datetime.datetime.fromisoformat(dt.replace("Z", "+00:00").replace("+05:30", ""))
            except (ValueError, TypeError):
                dt = datetime.datetime.now()
        if not isinstance(dt, datetime.datetime):
            dt = datetime.datetime.now()
        actual_timestamps = [(dt + datetime.timedelta(minutes=5 * (i + 1))).strftime("%Y-%m-%d %H:%M") for i in range(horizon)]
        result["timestamps"] = actual_timestamps
        result["actual"] = []  # No actual for future
    else:
        effective_context_len = min(CONTEXT_LEN, len(close_series) - horizon)
        if effective_context_len < MIN_CONTEXT:
            result["error"] = f"Not enough candles for context: {len(candles)}"
            return result

        use_first = segment.strip().lower() == "first"
        if use_first:
            split = _split_candles_by_last_day(candles, horizon)
            if split:
                context_candles, actual_candles_list, lstm_candles = split
                context = candles_to_close_series(context_candles)
                actual = candles_to_close_series(actual_candles_list)
                context = context[-CONTEXT_LEN:] if len(context) > CONTEXT_LEN else context
                candles_for_lstm = lstm_candles
                actual_candles_for_ts = actual_candles_list

        if context is None or actual is None:
            actual = close_series[-horizon:].copy()
            context = close_series[-(effective_context_len + horizon) : -horizon]
            candles_for_lstm = candles[:-horizon]
            actual_candles_for_ts = candles[-horizon:]

        context = context[-CONTEXT_LEN:] if len(context) > CONTEXT_LEN else context
        actual = actual[:horizon] if len(actual) > horizon else actual

    # LSTM
    lstm_forecast = None
    model_dir = os.path.join(_backend_dir, "models")
    if candles_for_lstm is not None and len(candles_for_lstm) >= 300:
        try:
            from ai_ml import train_lstm_on_candles, load_model_and_predict
            lstm_lookback = 120 if len(candles_for_lstm) < 450 else 200
            train_lstm_on_candles(
                candles=candles_for_lstm,
                model_dir=model_dir,
                symbol=symbol,
                lookback=lstm_lookback,
                horizon=1,
                epochs=30,
                batch_size=64,
            )
            lstm_result = load_model_and_predict(
                model_dir=model_dir,
                symbol=symbol,
                candles=candles_for_lstm,
                horizon=1,
                lookback=lstm_lookback,
                steps_ahead=horizon,
            )
            lstm_forecast = np.array(lstm_result["predictions"], dtype=np.float32)
        except Exception as e:
            logger.warning("LSTM training or prediction failed: %s", e)
            lstm_forecast = None

    # TimesFM
    try:
        import timesfm
        import torch

        torch.set_float32_matmul_precision("high")
        script_dir = os.path.dirname(os.path.abspath(__file__))
        local_model_path = os.path.join(script_dir, "timesfm_model")
        if os.path.isdir(local_model_path) and os.path.exists(os.path.join(local_model_path, "model.safetensors")):
            model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(local_model_path)
        else:
            model = timesfm.TimesFM_2p5_200M_torch.from_pretrained("google/timesfm-2.5-200m-pytorch")
        model.compile(
            timesfm.ForecastConfig(
                max_context=512,
                max_horizon=max(24, horizon),
                normalize_inputs=True,
                use_continuous_quantile_head=True,
                force_flip_invariance=True,
                infer_is_positive=True,
                fix_quantile_crossing=True,
            )
        )
        point_forecast, quantile_forecast = model.forecast(horizon=horizon, inputs=[context])
        point_forecast = np.array(point_forecast)
        quantile_forecast = np.array(quantile_forecast) if quantile_forecast is not None else None
        if quantile_forecast is not None and quantile_forecast.shape[-1] >= 5:
            median_idx = quantile_forecast.shape[-1] // 2
            timesfm_forecast = np.array(quantile_forecast[0, :, median_idx], dtype=np.float32)
        else:
            timesfm_forecast = point_forecast[0]
    except ImportError as e:
        result["error"] = f"TimesFM not installed: {e}"
        return result
    except Exception as e:
        result["error"] = str(e)
        return result

    ensemble_forecast = None
    if lstm_forecast is not None and len(lstm_forecast) == horizon:
        ensemble_forecast = (timesfm_forecast + lstm_forecast) / 2.0

    # Moirai 2.0 (constituent-based index prediction)
    moirai_forecast = None
    try:
        from moirai_service import run_moirai_on_candles
        moirai_arr = run_moirai_on_candles(
            candles, horizon=horizon, segment=segment, predict_future=predict_future
        )
        if moirai_arr is not None and len(moirai_arr) == horizon:
            moirai_forecast = moirai_arr
        elif moirai_arr is not None:
            result["moirai_error"] = f"Moirai forecast length mismatch (got {len(moirai_arr)}, expected {horizon})"
        else:
            result["moirai_error"] = "Moirai forecast unavailable (insufficient data or internal failure)"
    except ImportError as e:
        result["moirai_error"] = f"uni2ts not installed: {e}"
        logger.warning("Moirai forecast skipped: %s", e)
    except Exception as e:
        result["moirai_error"] = str(e)
        logger.warning("Moirai forecast skipped: %s", e)

    if not predict_future:
        actual_timestamps = (
            [_format_candle_datetime(c) for c in actual_candles_for_ts]
            if actual_candles_for_ts and len(actual_candles_for_ts) >= horizon
            else [f"Step {i+1}" for i in range(horizon)]
        )
        result["timestamps"] = actual_timestamps
        result["actual"] = [float(x) for x in actual]

        # Best model by MAE
        errors_tf = [abs(float(timesfm_forecast[i]) - float(actual[i])) for i in range(horizon)]
        mae_tf = float(np.mean(errors_tf))
        best_model = "TimesFM"
        best_mae = mae_tf

        if lstm_forecast is not None and ensemble_forecast is not None:
            errors_lstm = [abs(float(lstm_forecast[i]) - float(actual[i])) for i in range(horizon)]
            errors_ens = [abs(float(ensemble_forecast[i]) - float(actual[i])) for i in range(horizon)]
            mae_lstm = float(np.mean(errors_lstm))
            mae_ens = float(np.mean(errors_ens))
            if mae_lstm < best_mae:
                best_mae = mae_lstm
                best_model = "LSTM"
            if mae_ens < best_mae:
                best_mae = mae_ens
                best_model = "Ensemble"

        if moirai_forecast is not None:
            errors_moirai = [abs(float(moirai_forecast[i]) - float(actual[i])) for i in range(horizon)]
            mae_moirai = float(np.mean(errors_moirai))
            if mae_moirai < best_mae:
                best_mae = mae_moirai
                best_model = "Moirai 2.0"

        result["best_model"] = best_model
        result["mae"] = best_mae
    else:
        result["best_model"] = "TimesFM"  # Default when no actual to compare
        result["mae"] = 0.0

    result["timesfm"] = [float(x) for x in timesfm_forecast]
    result["lstm"] = [float(x) for x in lstm_forecast] if lstm_forecast is not None else None
    result["ensemble"] = [float(x) for x in ensemble_forecast] if ensemble_forecast is not None else None
    result["moirai"] = [float(x) for x in moirai_forecast] if moirai_forecast is not None else None

    return result


def _predict_single_chunk(
    symbol: str,
    context: "np.ndarray",
    candles_for_lstm: list,
    horizon: int,
) -> Tuple["np.ndarray", Optional["np.ndarray"], Optional["np.ndarray"], Optional["np.ndarray"], Optional[str]]:
    """Predict one chunk: returns (timesfm, lstm, ensemble, moirai, moirai_error). LSTM/ensemble/moirai may be None."""
    import numpy as np

    lstm_forecast = None
    model_dir = os.path.join(_backend_dir, "models")
    if candles_for_lstm and len(candles_for_lstm) >= 300:
        try:
            from ai_ml import train_lstm_on_candles, load_model_and_predict
            lstm_lookback = 120 if len(candles_for_lstm) < 450 else 200
            train_lstm_on_candles(
                candles=candles_for_lstm,
                model_dir=model_dir,
                symbol=symbol,
                lookback=lstm_lookback,
                horizon=1,
                epochs=30,
                batch_size=64,
            )
            lstm_result = load_model_and_predict(
                model_dir=model_dir,
                symbol=symbol,
                candles=candles_for_lstm,
                horizon=1,
                lookback=lstm_lookback,
                steps_ahead=horizon,
            )
            lstm_forecast = np.array(lstm_result["predictions"], dtype=np.float32)
        except Exception as e:
            logger.warning("LSTM training or prediction failed in chunk: %s", e)

    try:
        import timesfm
        import torch

        torch.set_float32_matmul_precision("high")
        script_dir = os.path.dirname(os.path.abspath(__file__))
        local_model_path = os.path.join(script_dir, "timesfm_model")
        if os.path.isdir(local_model_path) and os.path.exists(os.path.join(local_model_path, "model.safetensors")):
            model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(local_model_path)
        else:
            model = timesfm.TimesFM_2p5_200M_torch.from_pretrained("google/timesfm-2.5-200m-pytorch")
        model.compile(
            timesfm.ForecastConfig(
                max_context=512,
                max_horizon=max(24, horizon),
                normalize_inputs=True,
                use_continuous_quantile_head=True,
                force_flip_invariance=True,
                infer_is_positive=True,
                fix_quantile_crossing=True,
            )
        )
        point_forecast, quantile_forecast = model.forecast(horizon=horizon, inputs=[context])
        point_forecast = np.array(point_forecast)
        quantile_forecast = np.array(quantile_forecast) if quantile_forecast is not None else None
        if quantile_forecast is not None and quantile_forecast.shape[-1] >= 5:
            median_idx = quantile_forecast.shape[-1] // 2
            timesfm_forecast = np.array(quantile_forecast[0, :, median_idx], dtype=np.float32)
        else:
            timesfm_forecast = point_forecast[0]
    except Exception as e:
        logger.warning("TimesFM forecast failed in chunk: %s", e)
        raise

    ensemble_forecast = None
    if lstm_forecast is not None and len(lstm_forecast) == horizon:
        ensemble_forecast = (timesfm_forecast + lstm_forecast) / 2.0

    moirai_forecast = None
    moirai_error = None
    try:
        from moirai_service import _moirai_forecast_univariate
        moirai_forecast = _moirai_forecast_univariate(context, horizon)
    except ImportError as e:
        moirai_error = f"uni2ts not installed: {e}"
        logger.warning("Moirai chunk failed: %s", e)
    except Exception as e:
        moirai_error = str(e)
        logger.warning("Moirai chunk failed: %s", e)

    return timesfm_forecast, lstm_forecast, ensemble_forecast, moirai_forecast, moirai_error


def run_forecast_full_day(
    kite_client: Any,
    symbol: str,
    target_date: datetime.date,
    horizon: int = 12,
) -> Dict[str, Any]:
    """
    Run rolling 12-candle prediction across entire trading day.
    Returns candles (OHLC), actual (all closes), timesfm, lstm, ensemble (chained), timestamps.
    """
    import numpy as np

    result: Dict[str, Any] = {
        "candles": [],
        "actual": [],
        "timesfm": [],
        "lstm": [],
        "ensemble": [],
        "moirai": [],
        "moirai_error": None,
        "timestamps": [],
        "best_model": "TimesFM",
        "mae": 0.0,
        "error": None,
    }

    instrument_token = TOKEN_MAP.get(symbol.upper(), TOKEN_MAP["NIFTY"])
    context_start = target_date - datetime.timedelta(days=10)
    all_candles = _fetch_candles_for_range(kite_client, instrument_token, context_start, target_date)

    if not all_candles:
        result["error"] = "No candles fetched"
        return result

    by_date: Dict[datetime.date, list] = {}
    for c in all_candles:
        d = _candle_date(c)
        if d:
            by_date.setdefault(d, []).append(c)

    if target_date not in by_date:
        result["error"] = f"No candles for target date {target_date}"
        return result

    day_candles = sorted(by_date[target_date], key=lambda c: (c.get("date") or c.get("Date") or ""))
    prior_candles = []
    for d in sorted(by_date.keys()):
        if d < target_date:
            prior_candles.extend(sorted(by_date[d], key=lambda c: (c.get("date") or c.get("Date") or "")))

    if len(prior_candles) < MIN_CONTEXT:
        result["error"] = f"Not enough prior candles: {len(prior_candles)} (need at least {MIN_CONTEXT})"
        return result

    def _get(c: dict, key: str, default: Any = 0):
        return c.get(key, c.get(key.capitalize() if len(key) > 1 else key, default))

    result["candles"] = [
        {
            "timestamp": _format_candle_datetime(c),
            "open": float(_get(c, "open") or 0),
            "high": float(_get(c, "high") or 0),
            "low": float(_get(c, "low") or 0),
            "close": float(_get(c, "close") or 0),
            "volume": int(_get(c, "volume") or 0),
        }
        for c in day_candles
    ]
    result["actual"] = [float(_get(c, "close") or 0) for c in day_candles]
    result["timestamps"] = [_format_candle_datetime(c) for c in day_candles]

    timesfm_all: List[float] = []
    lstm_all: List[float] = []
    ensemble_all: List[float] = []
    moirai_all: List[float] = []
    lstm_available = True
    ensemble_available = True
    moirai_available = True

    i = 0
    while i < len(day_candles):
        chunk_size = min(horizon, len(day_candles) - i)
        context_candles = prior_candles + day_candles[:i]
        if len(context_candles) < MIN_CONTEXT:
            i += chunk_size
            continue

        close_series = candles_to_close_series(context_candles)
        context = close_series[-CONTEXT_LEN:] if len(close_series) > CONTEXT_LEN else close_series

        try:
            tf_pred, lstm_pred, ens_pred, moirai_pred, moirai_err = _predict_single_chunk(
                symbol, context, context_candles, chunk_size
            )
            timesfm_all.extend([float(x) for x in tf_pred])
            if lstm_pred is not None and lstm_available:
                lstm_all.extend([float(x) for x in lstm_pred])
            else:
                lstm_available = False
            if ens_pred is not None and ensemble_available:
                ensemble_all.extend([float(x) for x in ens_pred])
            else:
                ensemble_available = False
            if moirai_pred is not None and moirai_available:
                moirai_all.extend([float(x) for x in moirai_pred])
            else:
                if moirai_available and result["moirai_error"] is None and moirai_err:
                    result["moirai_error"] = moirai_err
                moirai_available = False
        except Exception as e:
            result["error"] = f"Chunk prediction failed at index {i}: {e}"
            return result

        i += chunk_size

    result["timesfm"] = timesfm_all
    result["lstm"] = lstm_all if lstm_all else None
    result["ensemble"] = ensemble_all if ensemble_all else None
    result["moirai"] = moirai_all if moirai_all else None

    if len(timesfm_all) == len(result["actual"]):
        errors_tf = [abs(timesfm_all[j] - result["actual"][j]) for j in range(len(timesfm_all))]
        mae_tf = float(np.mean(errors_tf))
        best_model = "TimesFM"
        best_mae = mae_tf
        if lstm_all and len(lstm_all) == len(result["actual"]):
            errors_lstm = [abs(lstm_all[j] - result["actual"][j]) for j in range(len(lstm_all))]
            mae_lstm = float(np.mean(errors_lstm))
            if mae_lstm < best_mae:
                best_mae = mae_lstm
                best_model = "LSTM"
        if ensemble_all and len(ensemble_all) == len(result["actual"]):
            errors_ens = [abs(ensemble_all[j] - result["actual"][j]) for j in range(len(ensemble_all))]
            mae_ens = float(np.mean(errors_ens))
            if mae_ens < best_mae:
                best_mae = mae_ens
                best_model = "Ensemble"
        if moirai_all and len(moirai_all) == len(result["actual"]):
            errors_moirai = [abs(moirai_all[j] - result["actual"][j]) for j in range(len(moirai_all))]
            mae_moirai = float(np.mean(errors_moirai))
            if mae_moirai < best_mae:
                best_mae = mae_moirai
                best_model = "Moirai 2.0"
        result["best_model"] = best_model
        result["mae"] = best_mae

    return result
