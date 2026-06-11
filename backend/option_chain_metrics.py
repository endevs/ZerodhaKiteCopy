"""
Day-change metrics for option chain (Sensibull-style vs previous close baselines).
"""
from __future__ import annotations

import datetime
import logging
from typing import Any, Dict, Optional

from database import get_db_connection
from option_iv import implied_volatility

logger = logging.getLogger(__name__)

_INDEX_KITE_SYMBOL = {
    "NIFTY": "NSE:NIFTY 50",
    "BANKNIFTY": "NSE:NIFTY BANK",
}


def resolve_prev_close(
    quote: Dict[str, Any],
    existing_row: Optional[Dict[str, Any]],
    meta: Optional[Dict[str, Any]] = None,
) -> Optional[float]:
    ohlc = quote.get("ohlc") or {}
    raw = ohlc.get("close")
    if raw is not None and float(raw) > 0:
        return float(raw)
    if existing_row and existing_row.get("prev_close"):
        return float(existing_row["prev_close"])
    if meta and meta.get("prev_close"):
        return float(meta["prev_close"])
    return None


def resolve_iv_prev_close(
    prev_close: Optional[float],
    index_prev_close: Optional[float],
    strike: float,
    expiry_date: str,
    instrument_type: str,
    trading_date: str,
    existing_row: Optional[Dict[str, Any]],
    meta: Optional[Dict[str, Any]] = None,
) -> Optional[float]:
    if existing_row and existing_row.get("iv_prev_close") is not None:
        return float(existing_row["iv_prev_close"])
    if meta and meta.get("iv_prev_close") is not None:
        return float(meta["iv_prev_close"])
    if prev_close is None or prev_close <= 0 or index_prev_close is None or index_prev_close <= 0:
        return None
    try:
        expiry_dt = datetime.datetime.strptime(expiry_date, "%Y-%m-%d").date()
        trade_dt = datetime.datetime.strptime(trading_date, "%Y-%m-%d").date()
        ref_dt = trade_dt - datetime.timedelta(days=1)
        days = max((expiry_dt - ref_dt).days, 0) + 1
    except ValueError:
        days = 8
    return implied_volatility(
        float(prev_close),
        float(index_prev_close),
        float(strike),
        float(days),
        instrument_type,
    )


def compute_day_changes(
    ltp: float,
    iv: Optional[float],
    prev_close: Optional[float],
    iv_prev_close: Optional[float],
) -> Dict[str, Optional[float]]:
    ltp_chg: Optional[float] = None
    ltp_chg_pct: Optional[float] = None
    if prev_close is not None and prev_close > 0:
        ltp_chg = round(ltp - prev_close, 2)
        ltp_chg_pct = round((ltp_chg / prev_close) * 100.0, 2)

    iv_chg: Optional[float] = None
    iv_chg_pct: Optional[float] = None
    if iv is not None and iv_prev_close is not None and iv_prev_close > 0:
        iv_chg = round(iv - iv_prev_close, 2)
        iv_chg_pct = round((iv_chg / iv_prev_close) * 100.0, 2)

    return {
        "ltp_chg": ltp_chg,
        "ltp_chg_pct": ltp_chg_pct,
        "iv_chg": iv_chg,
        "iv_chg_pct": iv_chg_pct,
    }


def resolve_index_prev_close(
    kite,
    index_name: str,
    trading_date: str,
) -> Optional[float]:
    index_name = index_name.upper()
    sym = _INDEX_KITE_SYMBOL.get(index_name)
    if kite and sym:
        try:
            quotes = kite.quote([sym])
            if sym in quotes:
                close = (quotes[sym].get("ohlc") or {}).get("close")
                if close is not None and float(close) > 0:
                    return float(close)
        except Exception as exc:
            logger.debug("Index prev close from Kite failed: %s", exc)

    conn = get_db_connection()
    try:
        row = conn.execute(
            """
            SELECT close FROM index_daily_data
            WHERE index_name = ? AND date < ?
            ORDER BY date DESC LIMIT 1
            """,
            (index_name, trading_date),
        ).fetchone()
        if row and row[0]:
            return float(row[0])
    finally:
        conn.close()
    return None


def index_prev_close_from_db(index_name: str, trading_date: str) -> Optional[float]:
    """Historical fallback without Kite session."""
    conn = get_db_connection()
    try:
        row = conn.execute(
            """
            SELECT close FROM index_daily_data
            WHERE index_name = ? AND date < ?
            ORDER BY date DESC LIMIT 1
            """,
            (index_name.upper(), trading_date),
        ).fetchone()
        if row and row[0]:
            return float(row[0])
    finally:
        conn.close()
    return None


def option_prev_close_from_candles(
    conn,
    instrument_token: int,
    trading_date: str,
) -> Optional[float]:
    row = conn.execute(
        """
        SELECT close FROM option_candles_5min
        WHERE instrument_token = ? AND date < ?
        ORDER BY date DESC, timestamp DESC LIMIT 1
        """,
        (instrument_token, trading_date),
    ).fetchone()
    if row and row[0] is not None:
        return float(row[0])
    return None
