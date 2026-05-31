"""
Isolated prediction providers for TimesFM, LSTM, Moirai, and derived Ensemble.
Each provider fails independently; forecast succeeds if any provider returns values.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import logging

logger = logging.getLogger(__name__)

_backend_dir = os.path.dirname(os.path.abspath(__file__))


def _env_flag(name: str, default: bool = True) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def timesfm_model_path() -> str:
    return os.environ.get("TIMESFM_MODEL_PATH", os.path.join(_backend_dir, "timesfm_model"))


def moirai_model_path() -> str:
    return os.environ.get("MOIRAI_MODEL_PATH", os.path.join(_backend_dir, "moirai_model"))


def lstm_model_dir() -> str:
    return os.environ.get("LSTM_MODEL_DIR", os.path.join(_backend_dir, "models"))


@dataclass
class ProviderResult:
    name: str
    values: Optional[List[float]] = None
    error: Optional[str] = None

    @property
    def ok(self) -> bool:
        return self.values is not None and len(self.values) > 0


@dataclass
class ProviderStatus:
    installed: bool
    enabled: bool
    model_cached: bool = False
    error: Optional[str] = None


def check_timesfm_status() -> ProviderStatus:
    enabled = _env_flag("PREDICTION_ENABLE_TIMESFM", True)
    if not enabled:
        return ProviderStatus(installed=False, enabled=False, error="disabled by PREDICTION_ENABLE_TIMESFM")
    try:
        import timesfm  # noqa: F401

        path = timesfm_model_path()
        cached = os.path.isdir(path) and os.path.exists(os.path.join(path, "model.safetensors"))
        return ProviderStatus(installed=True, enabled=True, model_cached=cached)
    except ImportError as exc:
        return ProviderStatus(installed=False, enabled=True, error=str(exc))


def check_lstm_status() -> ProviderStatus:
    enabled = _env_flag("PREDICTION_ENABLE_LSTM", True)
    if not enabled:
        return ProviderStatus(installed=False, enabled=False, error="disabled by PREDICTION_ENABLE_LSTM")
    try:
        import torch  # noqa: F401

        model_dir = lstm_model_dir()
        cached = os.path.isdir(model_dir) and any(
            name.endswith(".pt") for name in os.listdir(model_dir)
        ) if os.path.isdir(model_dir) else False
        return ProviderStatus(installed=True, enabled=True, model_cached=cached)
    except ImportError as exc:
        return ProviderStatus(installed=False, enabled=True, error=str(exc))


def check_moirai_status() -> ProviderStatus:
    enabled = _env_flag("PREDICTION_ENABLE_MOIRAI", False)
    if not enabled:
        return ProviderStatus(installed=False, enabled=False, error="disabled by PREDICTION_ENABLE_MOIRAI")
    try:
        import uni2ts  # noqa: F401

        path = moirai_model_path()
        cached = os.path.isdir(path) and os.path.exists(os.path.join(path, "config.json"))
        return ProviderStatus(installed=True, enabled=True, model_cached=cached)
    except ImportError as exc:
        return ProviderStatus(installed=False, enabled=True, error=str(exc))


def get_prediction_status() -> Dict[str, Any]:
    tf = check_timesfm_status()
    lstm = check_lstm_status()
    moirai = check_moirai_status()
    return {
        "timesfm": {
            "installed": tf.installed,
            "enabled": tf.enabled,
            "model_cached": tf.model_cached,
            "model_path": timesfm_model_path(),
            "error": tf.error,
        },
        "lstm": {
            "installed": lstm.installed,
            "enabled": lstm.enabled,
            "model_cached": lstm.model_cached,
            "model_path": lstm_model_dir(),
            "error": lstm.error,
        },
        "moirai": {
            "installed": moirai.installed,
            "enabled": moirai.enabled,
            "model_cached": moirai.model_cached,
            "model_path": moirai_model_path(),
            "error": moirai.error,
        },
        "outbound_hosts": [
            "api.kite.trade",
            "huggingface.co",
            "cdn-lfs.huggingface.co",
        ],
    }


_timesfm_model_singleton: Any = None
_TIMESFM_REPO = "google/timesfm-2.5-200m-pytorch"


def _ensure_timesfm_weights() -> str:
    """Return local model dir; download into mounted volume on first use."""
    local_model_path = timesfm_model_path()
    weights_file = os.path.join(local_model_path, "model.safetensors")
    if os.path.isfile(weights_file):
        return local_model_path
    os.makedirs(local_model_path, exist_ok=True)
    logger.info("TimesFM weights not cached at %s — downloading from HuggingFace", local_model_path)
    from huggingface_hub import snapshot_download

    snapshot_download(repo_id=_TIMESFM_REPO, local_dir=local_model_path)
    return local_model_path


def _get_timesfm_model(horizon: int) -> Any:
    global _timesfm_model_singleton
    if _timesfm_model_singleton is not None:
        return _timesfm_model_singleton
    import timesfm
    import torch

    torch.set_float32_matmul_precision("high")
    local_model_path = _ensure_timesfm_weights()
    model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(local_model_path)
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
    _timesfm_model_singleton = model
    return model


def run_lstm_provider(
    symbol: str,
    candles_for_lstm: Optional[list],
    horizon: int,
) -> ProviderResult:
    if not _env_flag("PREDICTION_ENABLE_LSTM", True):
        return ProviderResult("lstm", error="LSTM disabled (PREDICTION_ENABLE_LSTM=0)")
    if not candles_for_lstm or len(candles_for_lstm) < 300:
        return ProviderResult("lstm", error="insufficient candles for LSTM (need >= 300)")
    try:
        import numpy as np
        from ai_ml import train_lstm_on_candles, load_model_and_predict

        model_dir = lstm_model_dir()
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
        values = [float(x) for x in np.array(lstm_result["predictions"], dtype=np.float32)]
        return ProviderResult("lstm", values=values)
    except Exception as exc:
        logger.warning("LSTM provider failed: %s", exc)
        return ProviderResult("lstm", error=str(exc))


def run_timesfm_provider(context: Any, horizon: int) -> ProviderResult:
    if not _env_flag("PREDICTION_ENABLE_TIMESFM", True):
        return ProviderResult("timesfm", error="TimesFM disabled (PREDICTION_ENABLE_TIMESFM=0)")
    try:
        import numpy as np

        model = _get_timesfm_model(horizon)
        point_forecast, quantile_forecast = model.forecast(horizon=horizon, inputs=[context])
        point_forecast = np.array(point_forecast)
        quantile_forecast = np.array(quantile_forecast) if quantile_forecast is not None else None
        if quantile_forecast is not None and quantile_forecast.shape[-1] >= 5:
            median_idx = quantile_forecast.shape[-1] // 2
            timesfm_forecast = np.array(quantile_forecast[0, :, median_idx], dtype=np.float32)
        else:
            timesfm_forecast = point_forecast[0]
        return ProviderResult("timesfm", values=[float(x) for x in timesfm_forecast])
    except ImportError as exc:
        return ProviderResult("timesfm", error=f"TimesFM not installed: {exc}")
    except Exception as exc:
        logger.warning("TimesFM provider failed: %s", exc)
        return ProviderResult("timesfm", error=str(exc))


def run_moirai_provider(
    candles: list,
    horizon: int,
    segment: str,
    predict_future: bool,
    context: Optional[Any] = None,
) -> ProviderResult:
    if not _env_flag("PREDICTION_ENABLE_MOIRAI", False):
        return ProviderResult("moirai", error="Moirai disabled (PREDICTION_ENABLE_MOIRAI=0)")
    try:
        if context is not None:
            from moirai_service import _moirai_forecast_univariate

            moirai_arr = _moirai_forecast_univariate(context, horizon)
        else:
            from moirai_service import run_moirai_on_candles

            moirai_arr = run_moirai_on_candles(
                candles, horizon=horizon, segment=segment, predict_future=predict_future
            )
        if moirai_arr is not None and len(moirai_arr) == horizon:
            return ProviderResult("moirai", values=[float(x) for x in moirai_arr])
        if moirai_arr is not None:
            return ProviderResult(
                "moirai",
                error=f"Moirai forecast length mismatch (got {len(moirai_arr)}, expected {horizon})",
            )
        return ProviderResult("moirai", error="Moirai forecast unavailable")
    except ImportError as exc:
        return ProviderResult("moirai", error=f"uni2ts not installed: {exc}")
    except Exception as exc:
        logger.warning("Moirai provider failed: %s", exc)
        return ProviderResult("moirai", error=str(exc))


def compute_ensemble(
    timesfm_values: Optional[List[float]],
    lstm_values: Optional[List[float]],
    horizon: int,
) -> ProviderResult:
    if (
        timesfm_values
        and lstm_values
        and len(timesfm_values) == horizon
        and len(lstm_values) == horizon
    ):
        ensemble = [(timesfm_values[i] + lstm_values[i]) / 2.0 for i in range(horizon)]
        return ProviderResult("ensemble", values=ensemble)
    missing = []
    if not timesfm_values:
        missing.append("TimesFM")
    if not lstm_values:
        missing.append("LSTM")
    return ProviderResult(
        "ensemble",
        error=f"ensemble unavailable (need both TimesFM and LSTM; missing: {', '.join(missing) or 'length mismatch'})",
    )


def provider_map(results: List[ProviderResult]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for r in results:
        out[r.name] = {"ok": r.ok, "error": r.error}
    return out


def has_any_prediction(values: Dict[str, Any]) -> bool:
    for key in ("timesfm", "lstm", "ensemble", "moirai"):
        v = values.get(key)
        if isinstance(v, list) and len(v) > 0:
            return True
    return False


def build_warnings(providers: Dict[str, Dict[str, Any]]) -> List[str]:
    warnings: List[str] = []
    for name, info in providers.items():
        if name == "ensemble":
            continue
        if not info.get("ok") and info.get("error"):
            warnings.append(f"{name}: {info['error']}")
    return warnings


def pick_best_model(
    actual: List[float],
    timesfm: Optional[List[float]],
    lstm: Optional[List[float]],
    ensemble: Optional[List[float]],
    moirai: Optional[List[float]],
) -> Tuple[str, float]:
    horizon = len(actual)
    candidates: List[Tuple[str, List[float]]] = []
    if timesfm and len(timesfm) >= horizon:
        candidates.append(("TimesFM", timesfm[:horizon]))
    if lstm and len(lstm) >= horizon:
        candidates.append(("LSTM", lstm[:horizon]))
    if ensemble and len(ensemble) >= horizon:
        candidates.append(("Ensemble", ensemble[:horizon]))
    if moirai and len(moirai) >= horizon:
        candidates.append(("Moirai 2.0", moirai[:horizon]))
    if not candidates:
        return "TimesFM", 0.0
    best_name = candidates[0][0]
    best_mae = float("inf")
    for name, preds in candidates:
        errors = [abs(float(preds[i]) - float(actual[i])) for i in range(horizon)]
        mae = sum(errors) / len(errors)
        if mae < best_mae:
            best_mae = mae
            best_name = name
    return best_name, best_mae
