"""
TimesFM validation script - minimal test to verify forecasting works.
Fetches real Zerodha candle data from database (or KITE_API_KEY + KITE_ACCESS_TOKEN env)
or uses synthetic data, then compares forecast vs last N actual candles.

Run: python timesfm_validate.py
     (from project root) python backend/timesfm_validate.py

Prerequisites:
  1. Install TimesFM from source:
     git clone https://github.com/google-research/timesfm.git
     cd timesfm && pip install -e .[torch]
  2. First run downloads ~925MB model from HuggingFace (may take a few minutes).
     If download fails, try: huggingface-cli download google/timesfm-2.5-200m-pytorch

For real Zerodha data:
  - Primary: credentials from database for user raj.bapa@gmail.com (or TIMESFM_USER_EMAIL)
  - Fallback: export KITE_API_KEY=... KITE_ACCESS_TOKEN=...
  - Optional: TIMESFM_SYMBOL=NIFTY|BANKNIFTY, TIMESFM_HOLDOUT_DATE=YYYY-MM-DD
  - Edit FROM_DATE and TO_DATE below for custom date range (used when holdout not set)
"""
import os
import sys
import datetime
import time
import logging
from typing import Optional, Tuple, Any

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

# Ensure backend is on path
_backend_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _backend_dir)

# Set database path for standalone runs (from project root)
import config
config.DATABASE_PATH = os.path.join(_backend_dir, "database.db")

# Prefer local timesfm source (TimesFM 2.5 API) over PyPI package
_timesfm_src = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "timesfm", "src"
)
if os.path.isdir(_timesfm_src) and _timesfm_src not in sys.path:
    sys.path.insert(0, _timesfm_src)

# Edit these for custom date range (YYYY-MM-DD). Used when TIMESFM_HOLDOUT_DATE is not set.
# Leave both empty ("") to use default: last 30 days from today.
# Wider range = more context (ideal 400+) = better predictions.
FROM_DATE = "2026-02-15"
TO_DATE = "2026-02-18"

# Number of candles to predict and show on chart (max 256). Use 12-24 for closer predictions; 48+ errors grow.
CANDLES_TO_PREDICT = 12

# "first" = first HORIZON candles of last trading day (9:15 AM onwards). "last" = last HORIZON candles (e.g. 2:30 PM onwards).
CANDLE_SEGMENT = "last"

HORIZON = CANDLES_TO_PREDICT
CONTEXT_LEN = 400
MIN_CONTEXT = 100  # Minimum context length when data is limited
TRAIN_DAYS = 30
TOKEN_MAP = {"NIFTY": 256265, "BANKNIFTY": 260105}
CANDLE_INTERVAL = "5minute"  # Zerodha 5-minute candles (not day candles)


def _format_candle_datetime(candle: dict) -> str:
    """Format candle 'date' for display. Returns 'YYYY-MM-DD HH:MM' or '-' if missing."""
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


def _is_auth_error(exc: Exception) -> bool:
    """True if exception indicates invalid/expired Zerodha token."""
    msg = str(exc)
    return (
        "TokenException" in type(exc).__name__
        or "Incorrect" in msg
        or "Invalid" in msg
    )


def _fetch_with_retry(description: str, func, max_attempts: int = 3):
    """Simple retry for Kite API calls. Fails immediately on auth errors."""
    last_exc = None
    for attempt in range(1, max_attempts + 1):
        try:
            return func()
        except Exception as exc:
            last_exc = exc
            if _is_auth_error(exc):
                raise
            if attempt < max_attempts:
                delay = 1.5 * attempt
                logger.warning("%s failed (attempt %d/%d): %s. Retrying in %.1fs...", description, attempt, max_attempts, exc, delay)
                time.sleep(delay)
    raise last_exc


def _validate_kite_token(kite: Any) -> bool:
    """Validate token by calling profile(). Returns False if invalid."""
    try:
        kite.profile()
        return True
    except Exception as e:
        if _is_auth_error(e):
            logger.warning("Zerodha token invalid or expired: %s", e)
            return False
        raise


def get_kite_client() -> Tuple[Optional[Any], str]:
    """Get KiteConnect client: try database (raj.bapa@gmail.com) first, then env vars. Returns (kite, source) or (None, '')."""
    user_email = os.environ.get("TIMESFM_USER_EMAIL", "raj.bapa@gmail.com")

    # 1. Try database
    try:
        from options_data_collector import get_kite_client as get_kite_from_db
        kite = get_kite_from_db(user_email=user_email)
        if _validate_kite_token(kite):
            return kite, "database"
    except (ValueError, ImportError) as e:
        logger.debug("Database credentials unavailable: %s", e)

    # 2. Try env vars
    api_key = os.environ.get("KITE_API_KEY")
    access_token = os.environ.get("KITE_ACCESS_TOKEN")
    if api_key and access_token:
        try:
            from kiteconnect import KiteConnect
            kite = KiteConnect(api_key=api_key)
            kite.set_access_token(access_token)
            if _validate_kite_token(kite):
                return kite, "env"
        except ImportError:
            logger.warning("kiteconnect not installed. Use synthetic data.")
    return None, ""


def _fetch_candles_for_range(kite: Any, instrument_token: int, start_date: datetime.date, end_date: datetime.date, interval: str = "5minute") -> list:
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
            hist = _fetch_with_retry(
                f"fetching {interval} on {current_date}",
                lambda sd=start_dt, ed=end_dt: kite.historical_data(
                    instrument_token=instrument_token,
                    from_date=sd,
                    to_date=ed,
                    interval=interval,
                ),
            )
            if hist:
                all_candles.extend(hist)
        except Exception as e:
            logger.warning("Historical fetch failed for %s: %s", current_date, e)
        current_date += datetime.timedelta(days=1)
    return all_candles


def fetch_candles(kite: Any, symbol: str, start_date: datetime.date, end_date: datetime.date) -> Optional[list]:
    """Fetch 5-min candles from Zerodha for a date range."""
    instrument_token = TOKEN_MAP.get(symbol.upper(), TOKEN_MAP["NIFTY"])
    candles = _fetch_candles_for_range(kite, instrument_token, start_date, end_date)
    min_required = HORIZON + MIN_CONTEXT
    if len(candles) < min_required:
        logger.warning("Not enough candles: %d (need at least %d)", len(candles), min_required)
        return None
    return candles


def fetch_candles_for_holdout(kite: Any, symbol: str, holdout_date: datetime.date) -> Optional[Tuple["np.ndarray", "np.ndarray", list, list]]:
    """
    Fetch context (before holdout) and actual (first 12 five-min candles of holdout date).
    Returns (context_close_series, actual_close_series, context_candles, actual_candles) or None if insufficient data.
    """
    # Adjust holdout if weekend -> use previous Friday
    d = holdout_date
    while d.weekday() >= 5:
        d -= datetime.timedelta(days=1)
    holdout_date = d

    context_start = holdout_date - datetime.timedelta(days=10)
    context_end = holdout_date - datetime.timedelta(days=1)
    instrument_token = TOKEN_MAP.get(symbol.upper(), TOKEN_MAP["NIFTY"])

    context_candles = _fetch_candles_for_range(kite, instrument_token, context_start, context_end)
    if len(context_candles) < CONTEXT_LEN:
        logger.warning("Not enough context candles: %d (need %d)", len(context_candles), CONTEXT_LEN)
        return None

    # HORIZON five-min candles = HORIZON * 5 minutes from 9:15
    start_dt = datetime.datetime.combine(holdout_date, datetime.time(9, 15))
    mins_from_open = HORIZON * 5
    end_dt = start_dt + datetime.timedelta(minutes=mins_from_open)
    actual_candles = _fetch_with_retry(
        f"fetching holdout candles for {holdout_date}",
        lambda: kite.historical_data(
            instrument_token=instrument_token,
            from_date=start_dt,
            to_date=end_dt,
            interval="5minute",
        ),
    )
    if not actual_candles or len(actual_candles) < HORIZON:
        logger.warning("Not enough holdout candles: %d (need %d)", len(actual_candles) if actual_candles else 0, HORIZON)
        return None

    context_series = candles_to_close_series(context_candles)
    actual_series = candles_to_close_series(actual_candles[:HORIZON])
    context_series = context_series[-CONTEXT_LEN:]
    return context_series, actual_series, context_candles, actual_candles[:HORIZON]


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


def _split_candles_by_last_day(candles: list, horizon: int) -> Optional[Tuple[list, list, list]]:
    """Split candles into (context_candles, actual_candles, candles_for_lstm) for first HORIZON of last trading day.
    Returns (context, actual, lstm_candles) or None if insufficient data. lstm_candles = context + nothing from actual day."""
    if not candles or len(candles) < horizon:
        return None
    # Group by date - candles are typically chronological
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
    # Context = all candles before the actual segment (previous days only)
    context_candles = [c for c in candles if _candle_date(c) and _candle_date(c) < last_date]
    if len(context_candles) < MIN_CONTEXT:
        return None
    # LSTM trains on context only (no last day data when predicting first segment)
    lstm_candles = context_candles.copy()
    return context_candles, actual_candles, lstm_candles


def candles_to_close_series(candles: list) -> "np.ndarray":
    """Convert Kite candles to 1D close price array."""
    import numpy as np
    from ai_ml import candles_to_dataframe

    df = candles_to_dataframe(candles)
    return df["close"].values.astype(np.float32)


def synthetic_close_series(n: int = 300) -> "np.ndarray":
    """Generate synthetic close prices for testing."""
    import numpy as np

    np.random.seed(42)
    trend = np.linspace(50000, 50200, n)
    noise = np.cumsum(np.random.randn(n) * 20)
    return (trend + noise).astype(np.float32)


def main() -> int:
    try:
        import numpy as np
    except ImportError:
        print("[FAIL] Install dependencies first: pip install -r requirements.txt")
        return 1

    print("=" * 60)
    print("TimesFM Validation - Forecast vs Last N Candles")
    print("=" * 60)

    try:
        import timesfm  # noqa: F401
        import torch  # noqa: F401
        print("[OK] timesfm and torch imported")
    except ImportError as e:
        print("[FAIL] Install TimesFM 2.5 from source (PyPI package has dependency conflicts):")
        print("       git clone https://github.com/google-research/timesfm.git")
        print("       cd timesfm")
        print("       pip install -e .[torch]")
        print(f"       Error: {e}")
        return 1

    print("\n[1/5] Loading candle data...")
    symbol = os.environ.get("TIMESFM_SYMBOL", "NIFTY")
    holdout_str = os.environ.get("TIMESFM_HOLDOUT_DATE")
    from_date = None
    to_date = None
    segment = CANDLE_SEGMENT.strip().lower()
    if holdout_str:
        try:
            holdout_date = datetime.datetime.strptime(holdout_str, "%Y-%m-%d").date()
            from_date = to_date = holdout_date
            segment = "first"
        except ValueError:
            print(f"[FAIL] Invalid TIMESFM_HOLDOUT_DATE: {holdout_str!r}. Use YYYY-MM-DD.")
            return 1
    elif FROM_DATE and TO_DATE:
        try:
            from_date = datetime.datetime.strptime(FROM_DATE, "%Y-%m-%d").date()
            to_date = datetime.datetime.strptime(TO_DATE, "%Y-%m-%d").date()
            if from_date > to_date:
                print("[FAIL] FROM_DATE must be before or equal to TO_DATE (edit at top of file).")
                return 1
        except ValueError as e:
            print(f"[FAIL] Invalid date format in FROM_DATE/TO_DATE. Use YYYY-MM-DD: {e}")
            return 1
    else:
        to_date = datetime.date.today()
        from_date = to_date - datetime.timedelta(days=TRAIN_DAYS)

    kite, cred_source = get_kite_client()
    if not kite:
        print("[FAIL] Real Zerodha data required. No synthetic fallback.")
        print("       Configure Kite credentials in database (user raj.bapa@gmail.com) or set KITE_API_KEY and KITE_ACCESS_TOKEN.")
        return 1

    cred_label = f" (from {cred_source})" if cred_source else ""
    print(f"[OK] Kite client{cred_label}")

    from timesfm_service import run_forecast
    res = run_forecast(kite, symbol, from_date, to_date, horizon=HORIZON, segment=segment)

    if res.get("error"):
        print(f"[FAIL] {res['error']}")
        return 1

    actual = np.array(res["actual"])
    timesfm_forecast = np.array(res["timesfm"])
    lstm_forecast = np.array(res["lstm"]) if res.get("lstm") else None
    ensemble_forecast = np.array(res["ensemble"]) if res.get("ensemble") else None
    actual_timestamps = res["timestamps"]
    chart_date_range = f"{actual_timestamps[0]} to {actual_timestamps[-1]}" if actual_timestamps else f"{from_date} to {to_date}"

    print(f"[OK] Forecast complete: {len(actual)} candles, best_model={res['best_model']}")

    # 5. Compare forecast vs actual
    print("\n[5/5] Forecast vs Actual (last N candles)")
    if lstm_forecast is not None and ensemble_forecast is not None:
        print("-" * 145)
        print(f"{'Step':>4} | {'Date/Time':<18} | {'Actual':>10} | {'TimesFM':>10} | {'LSTM':>10} | {'Ensemble':>10} | {'Diff TF':>10} | {'Diff LSTM':>10} | {'Diff Ens':>10} | {'Best':>6}")
        print("-" * 145)
        errors_timesfm, errors_lstm, errors_ensemble = [], [], []
        for i in range(HORIZON):
            a = float(actual[i])
            tf = float(timesfm_forecast[i])
            lf = float(lstm_forecast[i])
            ef = float(ensemble_forecast[i])
            err_tf = abs(tf - a)
            err_lf = abs(lf - a)
            err_ef = abs(ef - a)
            errors_timesfm.append(err_tf)
            errors_lstm.append(err_lf)
            errors_ensemble.append(err_ef)
            best = min(err_tf, err_lf, err_ef)
            best_label = "TimesFM" if best == err_tf else ("LSTM" if best == err_lf else "Ensemble")
            diff_tf = tf - a
            diff_lstm = lf - a
            diff_ens = ef - a
            ts = actual_timestamps[i] if i < len(actual_timestamps) else f"Step {i+1}"
            print(f"{i + 1:4} | {ts:<18} | {a:10.2f} | {tf:10.2f} | {lf:10.2f} | {ef:10.2f} | {diff_tf:+10.2f} | {diff_lstm:+10.2f} | {diff_ens:+10.2f} | {best_label:>6}")
        print("-" * 145)
        mae_timesfm = np.mean(errors_timesfm)
        mae_lstm = np.mean(errors_lstm)
        mae_ensemble = np.mean(errors_ensemble)
        mape_timesfm = np.mean([abs(e / a) * 100 for e, a in zip(errors_timesfm, actual) if a != 0]) if actual.any() else 0
        mape_lstm = np.mean([abs(e / a) * 100 for e, a in zip(errors_lstm, actual) if a != 0]) if actual.any() else 0
        mape_ensemble = np.mean([abs(e / a) * 100 for e, a in zip(errors_ensemble, actual) if a != 0]) if actual.any() else 0
        print(f"MAE  (TimesFM):  {mae_timesfm:.2f}")
        print(f"MAE  (LSTM):     {mae_lstm:.2f}")
        print(f"MAE  (Ensemble): {mae_ensemble:.2f}")
        print(f"MAPE (TimesFM):  {mape_timesfm:.2f}%")
        print(f"MAPE (LSTM):     {mape_lstm:.2f}%")
        print(f"MAPE (Ensemble): {mape_ensemble:.2f}%")
        diffs_tf = np.array(timesfm_forecast) - np.array(actual)
        diffs_lstm = np.array(lstm_forecast) - np.array(actual)
        diffs_ens = np.array(ensemble_forecast) - np.array(actual)
        print(f"Difference vs actual: TimesFM mean={np.mean(diffs_tf):+.2f} max_abs={np.max(np.abs(diffs_tf)):.2f}")
        print(f"                     LSTM    mean={np.mean(diffs_lstm):+.2f} max_abs={np.max(np.abs(diffs_lstm)):.2f}")
        print(f"                     Ensemble mean={np.mean(diffs_ens):+.2f} max_abs={np.max(np.abs(diffs_ens)):.2f}")
        best_mae = min(mae_timesfm, mae_lstm, mae_ensemble)
        best_model = "TimesFM" if best_mae == mae_timesfm else ("LSTM" if best_mae == mae_lstm else "Ensemble")
        print(f"\nBest model: {best_model}")
    else:
        print("-" * 80)
        print(f"{'Step':>4} | {'Date/Time':<18} | {'Actual':>10} | {'Forecast':>10} | {'Diff':>10} | {'Diff %':>8}")
        print("-" * 80)
        errors = []
        for i in range(HORIZON):
            a, p = float(actual[i]), float(timesfm_forecast[i])
            err = p - a
            err_pct = (err / a) * 100 if a != 0 else 0
            errors.append(abs(err))
            ts = actual_timestamps[i] if i < len(actual_timestamps) else f"Step {i+1}"
            print(f"{i + 1:4} | {ts:<18} | {a:10.2f} | {p:10.2f} | {err:+10.2f} | {err_pct:+7.2f}%")
        print("-" * 80)
        mae = np.mean(errors)
        mape = np.mean([abs(e / a) * 100 for e, a in zip(errors, actual) if a != 0]) if actual.any() else 0
        diffs = np.array(timesfm_forecast) - np.array(actual)
        mean_diff = float(np.mean(diffs))
        max_abs_diff = float(np.max(np.abs(diffs)))
        print(f"MAE:  {mae:.2f}")
        print(f"MAPE: {mape:.2f}%")
        print(f"Difference vs actual: mean={mean_diff:+.2f}, max_abs={max_abs_diff:.2f}")
        print(f"\nBest model: TimesFM")

    # 6. Save chart: Actual vs predicted (TimesFM, LSTM, Ensemble) with provider names
    chart_path = os.environ.get("TIMESFM_CHART_PATH", os.path.join(_backend_dir, "timesfm_validation_chart.png"))
    try:
        import matplotlib
        matplotlib.use("Agg")  # Non-interactive backend for CLI
        import matplotlib.pyplot as plt

        fig, ax = plt.subplots(figsize=(12, 6))
        x_labels = actual_timestamps
        x_pos = list(range(HORIZON))

        ax.plot(x_pos, actual, "o-", label="Actual", color="black", linewidth=2, markersize=6)
        ax.plot(x_pos, timesfm_forecast, "s-", label="TimesFM", linewidth=1.5, markersize=5)
        if lstm_forecast is not None:
            ax.plot(x_pos, lstm_forecast, "^-", label="LSTM", linewidth=1.5, markersize=5)
        if ensemble_forecast is not None:
            ax.plot(x_pos, ensemble_forecast, "d-", label="Ensemble", linewidth=1.5, markersize=5)

        ax.set_xlabel("Date/Time" if actual_timestamps and ":" in str(actual_timestamps[0]) else "Step")
        ax.set_ylabel("Close Price")
        date_subtitle = f" | {chart_date_range}" if chart_date_range else ""
        ax.set_title(f"{symbol} 5-min Forecast vs Actual (last {HORIZON} candles){date_subtitle}")
        ax.set_xticks(x_pos)
        ax.set_xticklabels(x_labels, rotation=45, ha="right")
        ax.legend(loc="best")
        ax.grid(True, alpha=0.3)
        fig.tight_layout()
        fig.savefig(chart_path, dpi=150)
        plt.close(fig)
        print(f"\n[OK] Chart saved to {chart_path}")
    except ImportError:
        logger.warning("matplotlib not installed. Skipping chart. pip install matplotlib")
    except Exception as e:
        logger.warning("Chart generation failed: %s", e)

    print("\n[OK] Validation complete - check if forecast direction/scale looks reasonable")
    return 0


if __name__ == "__main__":
    sys.exit(main())
