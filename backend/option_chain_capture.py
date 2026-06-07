"""
Live capture of ATM±15 option quotes (ticks + latest row) for chain board and spikes.
"""
from __future__ import annotations

import datetime
import json
import logging
import threading
from typing import Any, Dict, List, Optional, Set

from database import get_db_connection
from option_iv import implied_volatility
from option_spike_detector import evaluate_spike, persist_spike_events

logger = logging.getLogger(__name__)

STRIKE_BAND = 15
_capture_tokens: Set[int] = set()
_capture_lock = threading.Lock()
_capture_meta: Dict[int, Dict[str, Any]] = {}


def register_capture_tokens(contracts: List[Dict[str, Any]]) -> None:
    global _capture_tokens, _capture_meta
    with _capture_lock:
        _capture_tokens = {int(c["instrument_token"]) for c in contracts if c.get("instrument_token")}
        _capture_meta = {
            int(c["instrument_token"]): c
            for c in contracts
            if c.get("instrument_token")
        }
    logger.info("Option capture registered %s tokens", len(_capture_tokens))


def is_capture_token(instrument_token: int) -> bool:
    with _capture_lock:
        return int(instrument_token) in _capture_tokens


def resolve_atm_band_contracts(
    kite,
    index_name: str,
    expiry_date: datetime.date,
    spot: float,
    trading_date: datetime.date,
) -> List[Dict[str, Any]]:
    strike_step = 100 if index_name == "BANKNIFTY" else 50
    atm = round(spot / strike_step) * strike_step
    min_strike = atm - STRIKE_BAND * strike_step
    max_strike = atm + STRIKE_BAND * strike_step
    expiry_str = expiry_date.strftime("%Y-%m-%d")

    instruments = kite.instruments("NFO")
    out: List[Dict[str, Any]] = []
    for inst in instruments:
        if inst.get("name") != index_name:
            continue
        exp = inst.get("expiry")
        if not exp:
            continue
        exp_s = exp.strftime("%Y-%m-%d") if hasattr(exp, "strftime") else str(exp)
        if exp_s != expiry_str:
            continue
        strike = inst.get("strike") or 0
        if strike < min_strike or strike > max_strike:
            continue
        out.append({
            "instrument_token": inst["instrument_token"],
            "tradingsymbol": inst["tradingsymbol"],
            "strike": strike,
            "expiry_date": expiry_str,
            "instrument_type": inst.get("instrument_type"),
            "index_name": index_name,
            "trading_date": trading_date.strftime("%Y-%m-%d"),
        })
    return out


def _prev_latest(conn, instrument_token: int, trading_date: str) -> Optional[Dict[str, Any]]:
    row = conn.execute(
        """
        SELECT ltp, iv, oi FROM option_quote_latest
        WHERE instrument_token = ? AND trading_date = ?
        """,
        (instrument_token, trading_date),
    ).fetchone()
    return dict(row) if row else None


def ingest_quote_row(
    contract: Dict[str, Any],
    quote: Dict[str, Any],
    spot: float,
    ts: Optional[str] = None,
) -> None:
    """Persist one quote update (from Kite quote API or ticker tick)."""
    token = int(contract["instrument_token"])
    trading_date = contract["trading_date"]
    expiry_date = contract["expiry_date"]
    ts = ts or datetime.datetime.now().isoformat()

    ohlc = quote.get("ohlc") or {}
    ltp = quote.get("last_price") or ohlc.get("close")
    if ltp is None:
        return
    ltp = float(ltp)

    oi = int(quote.get("oi") or 0)
    volume = int(quote.get("volume") or 0)

    try:
        expiry_dt = datetime.datetime.strptime(expiry_date, "%Y-%m-%d").date()
        days = max((expiry_dt - datetime.date.today()).days, 0) + 1
    except ValueError:
        days = 7

    iv = implied_volatility(
        ltp,
        spot,
        float(contract["strike"]),
        float(days),
        contract["instrument_type"],
    )

    conn = get_db_connection()
    try:
        prev = _prev_latest(conn, token, trading_date)
        ltp_chg = (ltp - prev["ltp"]) if prev and prev.get("ltp") else 0.0
        ltp_chg_pct = (ltp_chg / prev["ltp"] * 100.0) if prev and prev.get("ltp") else 0.0
        iv_chg = (iv - prev["iv"]) if iv is not None and prev and prev.get("iv") is not None else 0.0
        iv_chg_pct = (iv_chg / prev["iv"] * 100.0) if prev and prev.get("iv") and iv is not None else 0.0
        oi_chg = oi - int(prev["oi"] or 0) if prev else 0

        conn.execute(
            """
            INSERT OR REPLACE INTO option_quote_ticks
            (instrument_token, tradingsymbol, index_name, trading_date, expiry_date,
             strike, instrument_type, ts, ltp, iv, oi, volume)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                token,
                contract.get("tradingsymbol"),
                contract["index_name"],
                trading_date,
                expiry_date,
                contract.get("strike"),
                contract.get("instrument_type"),
                ts,
                ltp,
                iv,
                oi,
                volume,
            ),
        )
        conn.execute(
            """
            INSERT OR REPLACE INTO option_quote_latest (
                instrument_token, tradingsymbol, index_name, trading_date, expiry_date,
                strike, instrument_type, ltp, ltp_chg, ltp_chg_pct, iv, iv_chg, iv_chg_pct,
                oi, oi_lakh, oi_chg, volume, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                token,
                contract.get("tradingsymbol"),
                contract["index_name"],
                trading_date,
                expiry_date,
                contract.get("strike"),
                contract.get("instrument_type"),
                ltp,
                ltp_chg,
                round(ltp_chg_pct, 2),
                iv,
                round(iv_chg, 2) if iv is not None else None,
                round(iv_chg_pct, 2) if iv is not None else None,
                oi,
                round(oi / 100000.0, 2),
                oi_chg,
                volume,
                ts,
            ),
        )
        conn.commit()
    finally:
        conn.close()

    events = evaluate_spike(
        instrument_token=token,
        tradingsymbol=contract.get("tradingsymbol", ""),
        index_name=contract["index_name"],
        trading_date=trading_date,
        expiry_date=expiry_date,
        strike=float(contract.get("strike") or 0),
        instrument_type=contract.get("instrument_type", ""),
        ts=ts,
        ltp=ltp,
        iv=iv,
    )
    if events:
        persist_spike_events(events)
        try:
            import app as app_module
            if getattr(app_module, "socketio", None):
                for ev in events:
                    app_module.socketio.emit("option_spike", ev, namespace="/")
        except Exception:
            pass


def ingest_ticker_tick(tick: Dict[str, Any]) -> None:
    token = int(tick.get("instrument_token") or 0)
    if not token or not is_capture_token(token):
        return
    with _capture_lock:
        meta = _capture_meta.get(token)
    if not meta:
        return
    last = tick.get("last_price")
    if last is None:
        return
    ingest_quote_row(
        meta,
        {
            "last_price": last,
            "oi": tick.get("oi") or tick.get("oi_day_high"),
            "volume": tick.get("volume_traded") or tick.get("volume"),
        },
        spot=meta.get("_spot") or 0.0,
    )


def poll_quotes_from_kite(kite, contracts: List[Dict[str, Any]], spot: float) -> None:
    """Fetch quotes for board display without changing capture token registration."""
    if not contracts:
        return
    for c in contracts:
        c["_spot"] = spot

    symbols = [f"NFO:{c['tradingsymbol']}" for c in contracts if c.get("tradingsymbol")]
    batch = 400
    for i in range(0, len(symbols), batch):
        chunk = symbols[i : i + batch]
        try:
            quotes = kite.quote(chunk)
        except Exception as exc:
            logger.warning("Kite quote batch failed: %s", exc)
            continue
        sym_to_contract = {f"NFO:{c['tradingsymbol']}": c for c in contracts}
        for sym, q in quotes.items():
            c = sym_to_contract.get(sym)
            if c:
                ingest_quote_row(c, q, spot)


def capture_quotes_from_kite(kite, contracts: List[Dict[str, Any]], spot: float) -> None:
    if not contracts:
        return
    register_capture_tokens(contracts)
    poll_quotes_from_kite(kite, contracts, spot)


def save_chain_snapshot(
    index_name: str,
    trading_date: str,
    expiry_date: str,
    spot: float,
    atm_strike: float,
    chain_payload: List[Dict[str, Any]],
) -> None:
    ts = datetime.datetime.now().replace(second=0, microsecond=0).isoformat()
    conn = get_db_connection()
    try:
        conn.execute(
            """
            INSERT OR REPLACE INTO option_chain_snapshots
            (index_name, trading_date, expiry_date, snapshot_ts, spot, atm_strike, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                index_name,
                trading_date,
                expiry_date,
                ts,
                spot,
                atm_strike,
                json.dumps(chain_payload),
            ),
        )
        conn.commit()
    finally:
        conn.close()
