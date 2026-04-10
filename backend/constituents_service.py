"""
Constituents analysis service: BankNifty + constituents correlation, beta, divergence,
trading signals, and backtest. Pulls data from Zerodha Kite Connect API.
"""
import datetime
import logging
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

ROLLING_WINDOW = 20
CORR_BREAKDOWN_THRESHOLD = 0.6
CORR_BREAKDOWN_CONSECUTIVE = 2
STRONG_STOCK_RETURN_PCT = 0.005
WEAK_INDEX_RETURN_PCT = 0.001
INDEX_LAG_BASKET_THRESHOLD_PCT = 0.003
INITIAL_CAPITAL = 100000
LOT_SIZE = 35  # BankNifty lot size for P&L approximation


def _format_candle_datetime(candle: dict) -> str:
    """Format candle date for display."""
    dt = candle.get("date") or candle.get("Date")
    if dt is None:
        return "-"
    if isinstance(dt, str):
        try:
            dt = datetime.datetime.fromisoformat(
                dt.replace("Z", "+00:00").replace("+05:30", "")
            )
        except (ValueError, TypeError):
            return str(dt)[:16] if len(str(dt)) >= 16 else str(dt)
    if isinstance(dt, datetime.datetime):
        return dt.strftime("%Y-%m-%d %H:%M")
    return str(dt)


def _candle_date(candle: dict) -> Optional[datetime.date]:
    """Extract date from candle."""
    dt = candle.get("date") or candle.get("Date")
    if dt is None:
        return None
    if isinstance(dt, str):
        try:
            dt = datetime.datetime.fromisoformat(
                dt.replace("Z", "+00:00").replace("+05:30", "")
            )
        except (ValueError, TypeError):
            return None
    if isinstance(dt, datetime.datetime):
        return dt.date()
    return None


def _candles_to_df(candles: list) -> pd.DataFrame:
    """Convert Kite candles to DataFrame with date index."""
    if not candles:
        return pd.DataFrame()
    rows = []
    for c in candles:
        dt = c.get("date") or c.get("Date")
        if dt is None:
            continue
        if isinstance(dt, str):
            try:
                dt = datetime.datetime.fromisoformat(
                    dt.replace("Z", "+00:00").replace("+05:30", "")
                )
            except (ValueError, TypeError):
                continue
        rows.append(
            {
                "date": dt,
                "open": float(c.get("open", 0)),
                "high": float(c.get("high", 0)),
                "low": float(c.get("low", 0)),
                "close": float(c.get("close", 0)),
                "volume": float(c.get("volume", 0)),
            }
        )
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    df = df.sort_values("date").drop_duplicates(subset=["date"])
    df = df.set_index("date")
    return df


def _align_series(
    index_df: pd.DataFrame, constituent_dfs: Dict[str, pd.DataFrame]
) -> Tuple[pd.Series, Dict[str, pd.Series]]:
    """
    Align index and constituent close series on common timestamps.
    Returns (index_close, {symbol: close_series}).
    """
    idx_close = index_df["close"]
    common_ts = idx_close.index
    for sym, df in constituent_dfs.items():
        common_ts = common_ts.intersection(df.index)
    if len(common_ts) < ROLLING_WINDOW + 5:
        return idx_close, {}
    idx_aligned = idx_close.reindex(common_ts).ffill().bfill()
    const_aligned = {}
    for sym, df in constituent_dfs.items():
        s = df["close"].reindex(common_ts).ffill().bfill()
        if s.notna().sum() >= ROLLING_WINDOW:
            const_aligned[sym] = s
    return idx_aligned, const_aligned


def _compute_log_returns(series: pd.Series) -> pd.Series:
    """Log returns: log(close[t] / close[t-1])."""
    return np.log(series / series.shift(1))


def _compute_rolling_corr(
    stock_close: pd.Series, index_close: pd.Series, window: int = ROLLING_WINDOW
) -> pd.Series:
    """Rolling correlation of stock vs index."""
    return stock_close.rolling(window).corr(index_close)


def _compute_rolling_beta(
    stock_close: pd.Series, index_close: pd.Series, window: int = ROLLING_WINDOW
) -> pd.Series:
    """Rolling beta: cov(stock, index) / var(index)."""
    stock_ret = _compute_log_returns(stock_close)
    index_ret = _compute_log_returns(index_close)
    cov = stock_ret.rolling(window).cov(index_ret)
    var_idx = index_ret.rolling(window).var()
    beta = cov / var_idx.replace(0, np.nan)
    return beta


def _compute_divergence_score(
    stock_ret: pd.Series, index_ret: pd.Series, beta: pd.Series
) -> pd.Series:
    """Divergence = |stock_return - beta * index_return| (deviation from expected)."""
    expected = beta * index_ret
    return (stock_ret - expected).abs()


def _compute_lead_lag(
    stock_ret: pd.Series, index_ret: pd.Series, max_lag: int = 3
) -> Dict[str, float]:
    """Cross-correlation at lags -max_lag to +max_lag. Returns best lag and correlation."""
    common = stock_ret.align(index_ret, join="inner")[0].dropna()
    idx = index_ret.reindex(common.index).ffill().bfill()
    if len(common) < 20:
        return {"best_lag": 0, "corr": 0}
    best_lag = 0
    best_corr = 0
    for lag in range(-max_lag, max_lag + 1):
        if lag < 0:
            s1 = stock_ret.shift(-lag)
            s2 = index_ret
        elif lag > 0:
            s1 = stock_ret
            s2 = index_ret.shift(lag)
        else:
            s1 = stock_ret
            s2 = index_ret
        c = s1.corr(s2)
        if pd.notna(c) and abs(c) > abs(best_corr):
            best_corr = c
            best_lag = -lag  # positive = stock leads index
    return {"best_lag": best_lag, "corr": float(best_corr)}


def _generate_signals(
    index_close: pd.Series,
    constituent_closes: Dict[str, pd.Series],
    rolling_corr: Dict[str, pd.Series],
    rolling_beta: Dict[str, pd.Series],
    divergence: Dict[str, pd.Series],
) -> List[Dict[str, Any]]:
    """Generate trading signals from correlation breakdown, strong stock/weak index, index lag."""
    signals: List[Dict[str, Any]] = []
    index_ret = _compute_log_returns(index_close)

    # Weighted basket: equal weight of constituent returns
    n = len(constituent_closes)
    if n == 0:
        return signals
    basket_ret = pd.Series(0.0, index=index_close.index)
    for sym, close in constituent_closes.items():
        r = _compute_log_returns(close)
        basket_ret = basket_ret.add(r.reindex(basket_ret.index).fillna(0), fill_value=0)
    basket_ret = basket_ret / n

    # Correlation breakdown: rolling_corr < 0.6 for 2+ consecutive
    corr_breakdown_count: Dict[str, int] = {}
    for sym, corr in rolling_corr.items():
        corr_breakdown_count[sym] = 0

    for i in range(1, len(index_close)):
        ts = index_close.index[i]
        idx_r = index_ret.iloc[i] if i < len(index_ret) else 0
        if pd.isna(idx_r):
            idx_r = 0

        for sym, corr in rolling_corr.items():
            if sym not in corr_breakdown_count:
                continue
            c = corr.iloc[i] if i < len(corr) else np.nan
            if pd.notna(c) and c < CORR_BREAKDOWN_THRESHOLD:
                corr_breakdown_count[sym] += 1
                if corr_breakdown_count[sym] >= CORR_BREAKDOWN_CONSECUTIVE:
                    signals.append(
                        {
                            "time": _format_ts(ts),
                            "type": "correlation_breakdown",
                            "constituent": sym,
                            "details": f"Rolling corr={c:.3f}",
                            "value": float(c),
                        }
                    )
                    corr_breakdown_count[sym] = 0
            else:
                corr_breakdown_count[sym] = 0

        # Strong stock, weak index
        for sym, close in constituent_closes.items():
            if i >= len(close):
                continue
            stock_r = _compute_log_returns(close).iloc[i] if i < len(close) else 0
            if pd.isna(stock_r):
                stock_r = 0
            if (
                stock_r > STRONG_STOCK_RETURN_PCT
                and idx_r < WEAK_INDEX_RETURN_PCT
            ):
                signals.append(
                    {
                        "time": _format_ts(ts),
                        "type": "strong_stock_weak_index",
                        "constituent": sym,
                        "details": f"Stock ret={stock_r*100:.2f}%, Index ret={idx_r*100:.2f}%",
                        "value": float(stock_r),
                    }
                )

        # Index lag vs basket
        br = basket_ret.iloc[i] if i < len(basket_ret) else 0
        if pd.isna(br):
            br = 0
        diff = br - idx_r
        if diff > INDEX_LAG_BASKET_THRESHOLD_PCT:
            signals.append(
                {
                    "time": _format_ts(ts),
                    "type": "index_lag_vs_basket",
                    "constituent": "",
                    "details": f"Basket-Index diff={diff*100:.2f}%",
                    "value": float(diff),
                }
            )

    return signals


def _format_ts(ts) -> str:
    """Format timestamp for display."""
    if hasattr(ts, "strftime"):
        return ts.strftime("%Y-%m-%d %H:%M")
    return str(ts)[:16]


def _run_backtest(
    index_candles: list,
    signals: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Simple backtest: enter long on first signal of each type per day, exit at next signal or EOD.
    P&L approximated using index point move * lot_size.
    """
    from utils.backtest_metrics import calculate_all_metrics

    if not index_candles or not signals:
        return {
            "pnl": 0,
            "trades": [],
            "win_rate": 0,
            "sharpe": 0,
            "max_drawdown": 0,
            "total_trades": 0,
        }

    # Build timestamp -> close map
    ts_to_close: Dict[str, float] = {}
    for c in index_candles:
        ts = _format_candle_datetime(c)
        ts_to_close[ts] = float(c.get("close", 0))
    sorted_ts = sorted(ts_to_close.keys())

    trades: List[Dict[str, Any]] = []
    in_position = False
    entry_price = 0.0
    entry_time = ""
    entry_signal = ""

    for sig in signals:
        t = sig["time"]
        if t not in ts_to_close:
            continue
        price = ts_to_close[t]
        if not in_position:
            in_position = True
            entry_price = price
            entry_time = t
            entry_signal = sig["type"]
        else:
            pnl_pts = price - entry_price
            pnl = pnl_pts * LOT_SIZE
            trades.append(
                {
                    "entry_time": entry_time,
                    "exit_time": t,
                    "entry_price": entry_price,
                    "exit_price": price,
                    "pnl": pnl,
                    "date": t[:10],
                    "signal": entry_signal,
                }
            )
            in_position = True
            entry_price = price
            entry_time = t
            entry_signal = sig["type"]

    # Close at EOD if still in position
    if in_position and sorted_ts:
        last_ts = sorted_ts[-1]
        if last_ts in ts_to_close:
            price = ts_to_close[last_ts]
            pnl_pts = price - entry_price
            pnl = pnl_pts * LOT_SIZE
            trades.append(
                {
                    "entry_time": entry_time,
                    "exit_time": last_ts,
                    "entry_price": entry_price,
                    "exit_price": price,
                    "pnl": pnl,
                    "date": last_ts[:10],
                    "signal": entry_signal,
                }
            )

    if not trades:
        return {
            "pnl": 0,
            "trades": [],
            "win_rate": 0,
            "sharpe": 0,
            "max_drawdown": 0,
            "total_trades": 0,
        }

    metrics = calculate_all_metrics(trades, INITIAL_CAPITAL)
    total_pnl = sum(t.get("pnl", 0) for t in trades)

    return {
        "pnl": round(total_pnl, 2),
        "trades": trades,
        "win_rate": metrics.get("win_rate", 0),
        "sharpe": metrics.get("sharpe_ratio", 0),
        "max_drawdown": metrics.get("max_drawdown_pct", 0),
        "total_trades": len(trades),
    }


def run_constituents_analysis(
    kite: Any, date: datetime.date, include_prediction: bool = True
) -> Dict[str, Any]:
    """
    Run full constituents analysis for BankNifty + 14 constituents on the given date.
    Returns analysis payload for frontend.
    """
    from index_constituents import get_constituent_tokens, get_index_token, get_constituent_weights
    from timesfm_service import _fetch_candles_for_range

    result: Dict[str, Any] = {
        "date": date.isoformat(),
        "index_candles": [],
        "constituent_candles": {},
        "metrics": {
            "log_returns": {},
            "rolling_corr_20": {},
            "rolling_beta_20": {},
            "divergence_score": {},
            "lead_lag": {},
        },
        "signals": [],
        "backtest": {"pnl": 0, "trades": [], "win_rate": 0, "sharpe": 0, "max_drawdown": 0},
        "predicted_line": None,
        "prediction_mae": None,
        "constituent_summary": [],
        "metrics_timestamps": [],
        "unified_chart_data": [],
        "constituent_weights": {},
    }

    idx_token = get_index_token("BANKNIFTY")
    if idx_token is None:
        result["error"] = "BANKNIFTY token not found"
        return result

    # Fetch index candles
    index_candles = _fetch_candles_for_range(kite, idx_token, date, date)
    if not index_candles:
        result["error"] = f"No BankNifty candles for {date}"
        return result

    result["index_candles"] = [
        {
            "timestamp": _format_candle_datetime(c),
            "open": c.get("open"),
            "high": c.get("high"),
            "low": c.get("low"),
            "close": c.get("close"),
            "volume": c.get("volume", 0),
        }
        for c in index_candles
    ]

    # Fetch constituent candles
    const_tokens = get_constituent_tokens(kite, "BANKNIFTY")
    constituent_dfs: Dict[str, pd.DataFrame] = {}
    for sym, token in const_tokens.items():
        candles = _fetch_candles_for_range(kite, token, date, date)
        if candles:
            constituent_dfs[sym] = _candles_to_df(candles)
            result["constituent_candles"][sym] = [
                {
                    "timestamp": _format_candle_datetime(c),
                    "open": c.get("open"),
                    "high": c.get("high"),
                    "low": c.get("low"),
                    "close": c.get("close"),
                    "volume": c.get("volume", 0),
                }
                for c in candles
            ]

    index_df = _candles_to_df(index_candles)
    idx_close, const_closes = _align_series(index_df, constituent_dfs)

    if len(idx_close) < ROLLING_WINDOW or not const_closes:
        result["error"] = "Insufficient aligned data for analysis"
        return result

    # Unified chart: normalized to 100 at first aligned timestamp
    base_idx = float(idx_close.iloc[0])
    unified = []
    for ts in idx_close.index:
        row: Dict[str, Any] = {"timestamp": _format_ts(ts), "BANKNIFTY": 100 * float(idx_close.loc[ts]) / base_idx}
        for sym, close in const_closes.items():
            base_sym = float(close.iloc[0])
            row[sym] = 100 * float(close.loc[ts]) / base_sym if base_sym else 0
        unified.append(row)
    result["unified_chart_data"] = unified

    # Constituent weights (NSE free-float)
    result["constituent_weights"] = get_constituent_weights("BANKNIFTY")

    # Compute metrics
    index_ret = _compute_log_returns(idx_close)
    result["metrics"]["log_returns"]["BANKNIFTY"] = index_ret.dropna().tolist()

    rolling_corr: Dict[str, pd.Series] = {}
    rolling_beta: Dict[str, pd.Series] = {}
    divergence: Dict[str, pd.Series] = {}
    lead_lag: Dict[str, Dict] = {}

    for sym, close in const_closes.items():
        result["metrics"]["log_returns"][sym] = (
            _compute_log_returns(close).dropna().tolist()
        )
        rc = _compute_rolling_corr(close, idx_close)
        rb = _compute_rolling_beta(close, idx_close)
        div = _compute_divergence_score(
            _compute_log_returns(close), index_ret, rb
        )
        rolling_corr[sym] = rc
        rolling_beta[sym] = rb
        divergence[sym] = div
        rc_clean = rc.dropna()
        result["metrics"]["rolling_corr_20"][sym] = rc_clean.tolist()
        result["metrics"]["rolling_beta_20"][sym] = rb.dropna().tolist()
        result["metrics"]["divergence_score"][sym] = div.dropna().tolist()
        if not result["metrics_timestamps"] and len(rc_clean) > 0:
            result["metrics_timestamps"] = [_format_ts(t) for t in rc_clean.index.tolist()]
        lead_lag[sym] = _compute_lead_lag(
            _compute_log_returns(close), index_ret
        )
        result["metrics"]["lead_lag"][sym] = lead_lag[sym]

    # Constituent summary
    weights = get_constituent_weights("BANKNIFTY")
    for sym in const_closes:
        rc = rolling_corr.get(sym)
        rb = rolling_beta.get(sym)
        div = divergence.get(sym)
        ll = lead_lag.get(sym, {})
        weight_pct = weights.get(sym, 0) * 100
        result["constituent_summary"].append(
            {
                "symbol": sym,
                "weight_pct": round(weight_pct, 2),
                "avg_correlation": float(rc.mean()) if rc is not None and len(rc.dropna()) > 0 else 0,
                "avg_beta": float(rb.mean()) if rb is not None and len(rb.dropna()) > 0 else 0,
                "avg_divergence": float(div.mean()) if div is not None and len(div.dropna()) > 0 else 0,
                "lead_lag": ll.get("best_lag", 0),
            }
        )

    # Signals
    signals = _generate_signals(
        idx_close, const_closes, rolling_corr, rolling_beta, divergence
    )
    result["signals"] = signals

    # Backtest
    result["backtest"] = _run_backtest(index_candles, signals)

    # Prediction overlay for past dates
    if include_prediction and date < datetime.date.today():
        try:
            from timesfm_service import run_forecast

            forecast = run_forecast(
                kite,
                symbol="BANKNIFTY",
                from_date=date,
                to_date=date,
                horizon=12,
                segment="last",
                predict_future=False,
            )
            pred = forecast.get("timesfm") or forecast.get("ensemble") or forecast.get("moirai")
            if pred and len(pred) > 0:
                result["predicted_line"] = [float(x) for x in pred]
                actual = forecast.get("actual", [])
                if actual and len(actual) == len(pred):
                    mae = float(np.mean([abs(float(pred[i]) - float(actual[i])) for i in range(len(pred))]))
                    result["prediction_mae"] = round(mae, 2)
        except Exception as e:
            logger.warning("Constituents prediction overlay failed: %s", e)

    return result
