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

    from prediction_providers import (
        build_warnings,
        compute_ensemble,
        has_any_prediction,
        pick_best_model,
        provider_map,
        run_lstm_provider,
        run_moirai_provider,
        run_timesfm_provider,
    )

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
        "providers": {},
        "warning": None,
        "warnings": [],
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

    lstm_res = run_lstm_provider(symbol, candles_for_lstm, horizon)
    timesfm_res = run_timesfm_provider(context, horizon)
    moirai_res = run_moirai_provider(candles, horizon, segment, predict_future)
    ensemble_res = compute_ensemble(timesfm_res.values, lstm_res.values, horizon)

    provider_results = [lstm_res, timesfm_res, moirai_res, ensemble_res]
    result["providers"] = provider_map(provider_results)
    result["warnings"] = build_warnings(result["providers"])
    if result["warnings"]:
        result["warning"] = "; ".join(result["warnings"])

    lstm_forecast = lstm_res.values
    timesfm_forecast = timesfm_res.values or []
    ensemble_forecast = ensemble_res.values
    moirai_forecast = moirai_res.values
    result["moirai_error"] = moirai_res.error

    if not has_any_prediction(
        {
            "timesfm": timesfm_forecast,
            "lstm": lstm_forecast,
            "ensemble": ensemble_forecast,
            "moirai": moirai_forecast,
        }
    ):
        errors = [r.error for r in provider_results if r.error and r.name != "ensemble"]
        result["error"] = "; ".join(errors) if errors else "All prediction providers failed"
        return result

    if not predict_future:
        actual_timestamps = (
            [_format_candle_datetime(c) for c in actual_candles_for_ts]
            if actual_candles_for_ts and len(actual_candles_for_ts) >= horizon
            else [f"Step {i+1}" for i in range(horizon)]
        )
        result["timestamps"] = actual_timestamps
        result["actual"] = [float(x) for x in actual]

        best_model, best_mae = pick_best_model(
            result["actual"],
            timesfm_forecast if timesfm_forecast else None,
            lstm_forecast,
            ensemble_forecast,
            moirai_forecast,
        )
        result["best_model"] = best_model
        result["mae"] = best_mae
    else:
        result["best_model"] = "TimesFM"  # Default when no actual to compare
        result["mae"] = 0.0

    result["timesfm"] = timesfm_forecast if timesfm_forecast else []
    result["lstm"] = lstm_forecast
    result["ensemble"] = ensemble_forecast
    result["moirai"] = moirai_forecast

    return result


def _predict_single_chunk(
    symbol: str,
    context: "np.ndarray",
    candles_for_lstm: list,
    horizon: int,
) -> Tuple[Optional["np.ndarray"], Optional["np.ndarray"], Optional["np.ndarray"], Optional["np.ndarray"], Optional[str]]:
    """Predict one chunk: returns (timesfm, lstm, ensemble, moirai, moirai_error). Any may be None."""
    import numpy as np
    from prediction_providers import compute_ensemble, run_lstm_provider, run_moirai_provider, run_timesfm_provider

    lstm_res = run_lstm_provider(symbol, candles_for_lstm, horizon)
    timesfm_res = run_timesfm_provider(context, horizon)
    moirai_res = run_moirai_provider([], horizon, "last", False, context=context)
    ensemble_res = compute_ensemble(timesfm_res.values, lstm_res.values, horizon)

    lstm_forecast = np.array(lstm_res.values, dtype=np.float32) if lstm_res.values else None
    timesfm_forecast = np.array(timesfm_res.values, dtype=np.float32) if timesfm_res.values else None
    ensemble_forecast = np.array(ensemble_res.values, dtype=np.float32) if ensemble_res.values else None
    moirai_forecast = np.array(moirai_res.values, dtype=np.float32) if moirai_res.values else None
    moirai_error = moirai_res.error

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

    from prediction_providers import (
        ProviderResult,
        build_warnings,
        has_any_prediction,
        pick_best_model,
        provider_map,
    )

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
        "providers": {},
        "warning": None,
        "warnings": [],
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
    timesfm_available = True
    chunk_warnings: List[str] = []

    i = 0
    while i < len(day_candles):
        chunk_size = min(horizon, len(day_candles) - i)
        context_candles = prior_candles + day_candles[:i]
        if len(context_candles) < MIN_CONTEXT:
            i += chunk_size
            continue

        close_series = candles_to_close_series(context_candles)
        context = close_series[-CONTEXT_LEN:] if len(close_series) > CONTEXT_LEN else close_series

        tf_pred, lstm_pred, ens_pred, moirai_pred, moirai_err = _predict_single_chunk(
            symbol, context, context_candles, chunk_size
        )
        if tf_pred is not None and timesfm_available:
            timesfm_all.extend([float(x) for x in tf_pred])
        else:
            timesfm_available = False
            if tf_pred is None:
                chunk_warnings.append(f"TimesFM chunk failed at index {i}")
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

        i += chunk_size

    result["timesfm"] = timesfm_all
    result["lstm"] = lstm_all if lstm_all else None
    result["ensemble"] = ensemble_all if ensemble_all else None
    result["moirai"] = moirai_all if moirai_all else None

    result["providers"] = provider_map(
        [
            ProviderResult("timesfm", timesfm_all or None, None if timesfm_all else "unavailable"),
            ProviderResult("lstm", lstm_all or None, None if lstm_all else "unavailable"),
            ProviderResult("ensemble", ensemble_all or None, None if ensemble_all else "unavailable"),
            ProviderResult("moirai", moirai_all or None, result.get("moirai_error")),
        ]
    )
    result["warnings"] = chunk_warnings + build_warnings(result["providers"])
    if result["warnings"]:
        result["warning"] = "; ".join(result["warnings"])

    if not has_any_prediction(result):
        result["error"] = "All prediction providers failed for full-day forecast"
        return result

    n = len(result["actual"])
    if n > 0 and any(
        len(series) == n for series in (timesfm_all, lstm_all, ensemble_all, moirai_all) if series
    ):
        best_model, best_mae = pick_best_model(
            result["actual"],
            timesfm_all if len(timesfm_all) == n else None,
            lstm_all if lstm_all and len(lstm_all) == n else None,
            ensemble_all if ensemble_all and len(ensemble_all) == n else None,
            moirai_all if moirai_all and len(moirai_all) == n else None,
        )
        result["best_model"] = best_model
        result["mae"] = best_mae

    return result
