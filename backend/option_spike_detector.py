"""
Detect abrupt LTP / IV moves on option quote ticks for trading alerts.
"""
from __future__ import annotations

import datetime
import logging
import os
from typing import Any, Dict, List, Optional

from database import get_db_connection

logger = logging.getLogger(__name__)

LTP_SPIKE_PCT_30S = float(os.getenv("OPTION_LTP_SPIKE_PCT_30S", "5.0"))
IV_SPIKE_PCT_60S = float(os.getenv("OPTION_IV_SPIKE_PCT_60S", "8.0"))
COOLDOWN_SEC = int(os.getenv("OPTION_SPIKE_COOLDOWN_SEC", "45"))


def _parse_ts(ts: str) -> datetime.datetime:
    try:
        return datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return datetime.datetime.strptime(ts[:19], "%Y-%m-%d %H:%M:%S")


def evaluate_spike(
    *,
    instrument_token: int,
    tradingsymbol: str,
    index_name: str,
    trading_date: str,
    expiry_date: str,
    strike: float,
    instrument_type: str,
    ts: str,
    ltp: Optional[float],
    iv: Optional[float],
) -> List[Dict[str, Any]]:
    """Compare current tick to history; return spike event dicts (may be empty)."""
    if ltp is None or ltp <= 0:
        return []

    events: List[Dict[str, Any]] = []
    conn = get_db_connection()
    try:
        now = _parse_ts(ts)
        window_30 = (now - datetime.timedelta(seconds=30)).isoformat()
        window_60 = (now - datetime.timedelta(seconds=60)).isoformat()

        row_30 = conn.execute(
            """
            SELECT ltp, iv, ts FROM option_quote_ticks
            WHERE instrument_token = ? AND trading_date = ? AND ts >= ?
            ORDER BY ts ASC LIMIT 1
            """,
            (instrument_token, trading_date, window_30),
        ).fetchone()

        row_60 = conn.execute(
            """
            SELECT ltp, iv, ts FROM option_quote_ticks
            WHERE instrument_token = ? AND trading_date = ? AND ts >= ?
            ORDER BY ts ASC LIMIT 1
            """,
            (instrument_token, trading_date, window_60),
        ).fetchone()

        def _cooldown_ok(metric: str) -> bool:
            recent = conn.execute(
                """
                SELECT id FROM option_spike_events
                WHERE instrument_token = ? AND trading_date = ? AND metric = ?
                  AND ts > ?
                LIMIT 1
                """,
                (
                    instrument_token,
                    trading_date,
                    metric,
                    (now - datetime.timedelta(seconds=COOLDOWN_SEC)).isoformat(),
                ),
            ).fetchone()
            return recent is None

        if row_30 and row_30[0] and row_30[0] > 0:
            pct = ((ltp - row_30[0]) / row_30[0]) * 100.0
            if abs(pct) >= LTP_SPIKE_PCT_30S and _cooldown_ok("ltp_pct"):
                events.append({
                    "instrument_token": instrument_token,
                    "tradingsymbol": tradingsymbol,
                    "index_name": index_name,
                    "trading_date": trading_date,
                    "expiry_date": expiry_date,
                    "strike": strike,
                    "instrument_type": instrument_type,
                    "ts": ts,
                    "metric": "ltp_pct",
                    "value": round(pct, 2),
                    "window_sec": 30,
                    "severity": "high" if abs(pct) >= LTP_SPIKE_PCT_30S * 1.5 else "medium",
                })

        if iv is not None and row_60 and row_60[1] is not None and row_60[1] > 0:
            iv_pct = ((iv - row_60[1]) / row_60[1]) * 100.0
            if abs(iv_pct) >= IV_SPIKE_PCT_60S and _cooldown_ok("iv_pct"):
                events.append({
                    "instrument_token": instrument_token,
                    "tradingsymbol": tradingsymbol,
                    "index_name": index_name,
                    "trading_date": trading_date,
                    "expiry_date": expiry_date,
                    "strike": strike,
                    "instrument_type": instrument_type,
                    "ts": ts,
                    "metric": "iv_pct",
                    "value": round(iv_pct, 2),
                    "window_sec": 60,
                    "severity": "medium",
                })
    finally:
        conn.close()

    return events


def persist_spike_events(events: List[Dict[str, Any]]) -> int:
    if not events:
        return 0
    conn = get_db_connection()
    try:
        for ev in events:
            conn.execute(
                """
                INSERT INTO option_spike_events (
                    instrument_token, tradingsymbol, index_name, trading_date, expiry_date,
                    strike, instrument_type, ts, metric, value, window_sec, severity
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    ev["instrument_token"],
                    ev.get("tradingsymbol"),
                    ev["index_name"],
                    ev["trading_date"],
                    ev["expiry_date"],
                    ev.get("strike"),
                    ev.get("instrument_type"),
                    ev["ts"],
                    ev["metric"],
                    ev["value"],
                    ev["window_sec"],
                    ev.get("severity", "medium"),
                ),
            )
        conn.commit()
        return len(events)
    finally:
        conn.close()


def list_recent_spikes(
    index_name: str,
    trading_date: str,
    expiry_date: Optional[str] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    try:
        if expiry_date:
            rows = conn.execute(
                """
                SELECT * FROM option_spike_events
                WHERE index_name = ? AND trading_date = ? AND expiry_date = ?
                ORDER BY ts DESC LIMIT ?
                """,
                (index_name, trading_date, expiry_date, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT * FROM option_spike_events
                WHERE index_name = ? AND trading_date = ?
                ORDER BY ts DESC LIMIT ?
                """,
                (index_name, trading_date, limit),
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()
