"""
Build option chain board payloads (live Kite quotes + DB historical fallback).
"""
from __future__ import annotations

import datetime
import json
import logging
from typing import Any, Dict, List, Optional, Tuple

from database import get_db_connection
from option_chain_capture import (
    capture_quotes_from_kite,
    poll_quotes_from_kite,
    resolve_atm_band_contracts,
)
from option_iv import implied_volatility

logger = logging.getLogger(__name__)


def strike_step(index_name: str) -> int:
    return 100 if index_name == "BANKNIFTY" else 50


def pick_default_expiry(expiries: List[str], trading_date: datetime.date) -> Optional[str]:
    if not expiries:
        return None
    td = trading_date.strftime("%Y-%m-%d")
    future = sorted([e for e in expiries if e >= td])
    return future[0] if future else sorted(expiries)[-1]


def _index_spot_from_db(conn, index_name: str, trading_date: str) -> Optional[float]:
    row = conn.execute(
        """
        SELECT AVG(close) FROM index_candles_5min
        WHERE index_name = ? AND date = ?
        """,
        (index_name, trading_date),
    ).fetchone()
    if row and row[0]:
        return float(row[0])
    row = conn.execute(
        "SELECT close FROM index_daily_data WHERE index_name = ? AND date = ?",
        (index_name, trading_date),
    ).fetchone()
    return float(row[0]) if row and row[0] else None


def _resolve_contracts(
    kite,
    index_name: str,
    expiry_date: datetime.date,
    trading_date: datetime.date,
    spot: float,
) -> Tuple[List[Dict[str, Any]], float, float]:
    step = strike_step(index_name)
    atm = round(spot / step) * step
    min_s = atm - 20 * step
    max_s = atm + 20 * step
    expiry_str = expiry_date.strftime("%Y-%m-%d")
    td_str = trading_date.strftime("%Y-%m-%d")
    today = datetime.date.today()
    is_live = trading_date == today and expiry_date >= today

    contracts: List[Dict[str, Any]] = []
    if is_live and kite:
        instruments = kite.instruments("NFO")
        for inst in instruments:
            if inst.get("name") != index_name:
                continue
            exp = inst.get("expiry")
            if not exp:
                continue
            es = exp.strftime("%Y-%m-%d") if hasattr(exp, "strftime") else str(exp)
            if es != expiry_str:
                continue
            s = inst.get("strike") or 0
            if min_s <= s <= max_s:
                contracts.append({
                    "instrument_token": inst["instrument_token"],
                    "tradingsymbol": inst["tradingsymbol"],
                    "strike": s,
                    "expiry_date": expiry_str,
                    "instrument_type": inst.get("instrument_type"),
                    "index_name": index_name,
                    "trading_date": td_str,
                })
    else:
        conn = get_db_connection()
        try:
            rows = conn.execute(
                """
                SELECT DISTINCT instrument_token, tradingsymbol, strike, instrument_type
                FROM option_contracts
                WHERE index_name = ? AND expiry_date = ? AND date = ?
                  AND strike >= ? AND strike <= ?
                ORDER BY strike
                """,
                (index_name, expiry_str, td_str, min_s, max_s),
            ).fetchall()
            for row in rows:
                contracts.append({
                    "instrument_token": row[0],
                    "tradingsymbol": row[1],
                    "strike": row[2],
                    "instrument_type": row[3],
                    "expiry_date": expiry_str,
                    "index_name": index_name,
                    "trading_date": td_str,
                })
        finally:
            conn.close()

    return contracts, atm, spot


def _quote_from_latest(conn, token: int, trading_date: str) -> Optional[Dict[str, Any]]:
    row = conn.execute(
        """
        SELECT ltp, ltp_chg, ltp_chg_pct, iv, iv_chg, iv_chg_pct, oi, oi_lakh, oi_chg,
               tradingsymbol, instrument_type, strike
        FROM option_quote_latest WHERE instrument_token = ? AND trading_date = ?
        """,
        (token, trading_date),
    ).fetchone()
    return dict(row) if row else None


def _quote_from_candles(conn, token: int, trading_date: str, spot: float, strike: float, itype: str, expiry: str) -> Dict[str, Any]:
    rows = conn.execute(
        """
        SELECT close, timestamp FROM option_candles_5min
        WHERE instrument_token = ? AND date = ?
        ORDER BY timestamp DESC LIMIT 2
        """,
        (token, trading_date),
    ).fetchall()
    if not rows:
        return {}
    ltp = float(rows[0][0])
    prev = float(rows[1][0]) if len(rows) > 1 else ltp
    chg = ltp - prev
    chg_pct = (chg / prev * 100.0) if prev else 0.0
    try:
        exp_d = datetime.datetime.strptime(expiry, "%Y-%m-%d").date()
        days = max((exp_d - datetime.datetime.strptime(trading_date, "%Y-%m-%d").date()).days, 1)
    except ValueError:
        days = 7
    iv = implied_volatility(ltp, spot, strike, float(days), itype)
    return {
        "ltp": ltp,
        "ltp_chg": round(chg, 2),
        "ltp_chg_pct": round(chg_pct, 2),
        "iv": iv,
        "iv_chg": None,
        "iv_chg_pct": None,
        "oi": None,
        "oi_lakh": None,
        "oi_chg": None,
    }


def _side_payload(q: Optional[Dict[str, Any]], contract: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not contract:
        return None
    base = {
        "instrument_token": contract["instrument_token"],
        "tradingsymbol": contract.get("tradingsymbol"),
    }
    if not q:
        return base
    return {
        **base,
        "ltp": q.get("ltp"),
        "ltp_chg": q.get("ltp_chg"),
        "ltp_chg_pct": q.get("ltp_chg_pct"),
        "iv": q.get("iv"),
        "iv_chg": q.get("iv_chg"),
        "iv_chg_pct": q.get("iv_chg_pct"),
        "oi": q.get("oi"),
        "oi_lakh": q.get("oi_lakh"),
        "oi_chg": q.get("oi_chg"),
    }


def build_chain_board(
    kite,
    index_name: str,
    trading_date_str: str,
    expiry_date_str: str,
    *,
    live_poll: bool = True,
) -> Dict[str, Any]:
    index_name = index_name.upper()
    trading_date = datetime.datetime.strptime(trading_date_str, "%Y-%m-%d").date()
    expiry_date = datetime.datetime.strptime(expiry_date_str, "%Y-%m-%d").date()
    today = datetime.date.today()
    is_live = trading_date == today and expiry_date >= today

    spot = None
    if kite and is_live:
        sym = "NSE:NIFTY BANK" if index_name == "BANKNIFTY" else "NSE:NIFTY 50"
        try:
            ltp_r = kite.ltp(sym)
            if sym in ltp_r:
                spot = float(ltp_r[sym]["last_price"])
        except Exception as exc:
            logger.warning("Spot LTP failed: %s", exc)

    conn = get_db_connection()
    try:
        if spot is None:
            spot = _index_spot_from_db(conn, index_name, trading_date_str)
    finally:
        conn.close()

    if spot is None:
        spot = 24000.0 if index_name == "NIFTY" else 50000.0

    contracts, atm_strike, spot = _resolve_contracts(kite, index_name, expiry_date, trading_date, spot)
    data_source = "kite" if is_live else "db"

    if is_live and kite and live_poll and contracts:
        band = resolve_atm_band_contracts(kite, index_name, expiry_date, spot, trading_date)
        capture_quotes_from_kite(kite, band, spot)
        poll_quotes_from_kite(kite, contracts, spot)

    conn = get_db_connection()
    quotes_by_token: Dict[int, Dict[str, Any]] = {}
    try:
        if not is_live:
            snap = conn.execute(
                """
                SELECT payload_json FROM option_chain_snapshots
                WHERE index_name = ? AND trading_date = ? AND expiry_date = ?
                ORDER BY snapshot_ts DESC LIMIT 1
                """,
                (index_name, trading_date_str, expiry_date_str),
            ).fetchone()
            if snap and snap[0]:
                try:
                    cached = json.loads(snap[0])
                    return {
                        "index": index_name,
                        "expiry_date": expiry_date_str,
                        "trading_date": trading_date_str,
                        "chain": cached,
                        "is_live": False,
                        "data_source": "db_snapshot",
                        "atm_strike": atm_strike,
                        "spot": spot,
                        "message": None,
                    }
                except json.JSONDecodeError:
                    pass

        for c in contracts:
            token = int(c["instrument_token"])
            q = _quote_from_latest(conn, token, trading_date_str)
            if not q:
                q = _quote_from_candles(
                    conn,
                    token,
                    trading_date_str,
                    spot,
                    float(c["strike"]),
                    c["instrument_type"],
                    expiry_date_str,
                )
            if q:
                quotes_by_token[token] = q
    finally:
        conn.close()

    by_strike: Dict[float, Dict[str, Any]] = {}
    for c in contracts:
        s = float(c["strike"])
        if s not in by_strike:
            by_strike[s] = {"strike": s, "ce": None, "pe": None}
        q = quotes_by_token.get(int(c["instrument_token"]))
        side = _side_payload(q, c)
        if c["instrument_type"] == "CE":
            by_strike[s]["ce"] = side
        else:
            by_strike[s]["pe"] = side

    chain = [by_strike[s] for s in sorted(by_strike.keys())]
    message = None
    if not chain:
        message = (
            "No chain data for this date/expiry. "
            "Expired options are only available if captured during live market hours."
        )

    if is_live and chain:
        save_snapshot = chain
        try:
            from option_chain_capture import save_chain_snapshot
            save_chain_snapshot(
                index_name,
                trading_date_str,
                expiry_date_str,
                spot,
                atm_strike,
                save_snapshot,
            )
        except Exception:
            pass

    return {
        "index": index_name,
        "expiry_date": expiry_date_str,
        "trading_date": trading_date_str,
        "chain": chain,
        "is_live": is_live,
        "data_source": data_source,
        "atm_strike": atm_strike,
        "spot": round(spot, 2),
        "message": message,
    }
