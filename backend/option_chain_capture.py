"""
Live capture of ATM±15 option quotes (ticks + latest row) for chain board.
"""
from __future__ import annotations

import datetime
import json
import logging
import threading
import time
from typing import Any, Dict, List, Optional, Set

from database import get_db_connection
from option_chain_metrics import (
    compute_day_changes,
    resolve_index_prev_close,
    resolve_iv_prev_close,
    resolve_prev_close,
)
from option_iv import implied_volatility
logger = logging.getLogger(__name__)

STRIKE_BAND = 15
_capture_tokens: Set[int] = set()
_capture_lock = threading.Lock()
_capture_meta: Dict[int, Dict[str, Any]] = {}
_emit_last: Dict[int, float] = {}
_EMIT_MIN_INTERVAL_SEC = 0.15


def get_capture_tokens() -> List[int]:
    with _capture_lock:
        return list(_capture_tokens)


def update_index_spot(index_name: str, spot: float) -> None:
    """Cache index spot on capture contracts so IV stays accurate on tick path."""
    idx = index_name.upper()
    with _capture_lock:
        for meta in _capture_meta.values():
            if meta.get("index_name", "").upper() == idx:
                meta["_spot"] = float(spot)


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
    try:
        from ticker import refresh_capture_subscriptions
        refresh_capture_subscriptions()
    except Exception as exc:
        logger.debug("refresh_capture_subscriptions after register: %s", exc)


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
        SELECT ltp, iv, oi, prev_close, iv_prev_close
        FROM option_quote_latest
        WHERE instrument_token = ? AND trading_date = ?
        """,
        (instrument_token, trading_date),
    ).fetchone()
    return dict(row) if row else None


def _cache_baselines_in_meta(token: int, prev_close: Optional[float], iv_prev_close: Optional[float]) -> None:
    with _capture_lock:
        meta = _capture_meta.get(token)
        if not meta:
            return
        if prev_close is not None:
            meta["prev_close"] = prev_close
        if iv_prev_close is not None:
            meta["iv_prev_close"] = iv_prev_close


def ingest_quote_row(
    contract: Dict[str, Any],
    quote: Dict[str, Any],
    spot: float,
    ts: Optional[str] = None,
    index_prev_close: Optional[float] = None,
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

    with _capture_lock:
        meta_snapshot = dict(_capture_meta.get(token) or {})

    conn = get_db_connection()
    try:
        existing = _prev_latest(conn, token, trading_date)
        prev_close = resolve_prev_close(quote, existing, meta_snapshot)
        if index_prev_close is None:
            index_prev_close = meta_snapshot.get("_index_prev_close")
        iv_prev_close = resolve_iv_prev_close(
            prev_close,
            float(index_prev_close) if index_prev_close else None,
            float(contract["strike"]),
            expiry_date,
            contract.get("instrument_type", ""),
            trading_date,
            existing,
            meta_snapshot,
        )
        _cache_baselines_in_meta(token, prev_close, iv_prev_close)

        changes = compute_day_changes(ltp, iv, prev_close, iv_prev_close)
        ltp_chg = changes["ltp_chg"]
        ltp_chg_pct = changes["ltp_chg_pct"]
        iv_chg = changes["iv_chg"]
        iv_chg_pct = changes["iv_chg_pct"]
        oi_chg = oi - int(existing["oi"] or 0) if existing else 0

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
            INSERT INTO option_quote_latest (
                instrument_token, tradingsymbol, index_name, trading_date, expiry_date,
                strike, instrument_type, ltp, ltp_chg, ltp_chg_pct, iv, iv_chg, iv_chg_pct,
                oi, oi_lakh, oi_chg, volume, updated_at, prev_close, iv_prev_close
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(instrument_token, trading_date) DO UPDATE SET
                tradingsymbol=excluded.tradingsymbol,
                index_name=excluded.index_name,
                expiry_date=excluded.expiry_date,
                strike=excluded.strike,
                instrument_type=excluded.instrument_type,
                ltp=excluded.ltp,
                ltp_chg=excluded.ltp_chg,
                ltp_chg_pct=excluded.ltp_chg_pct,
                iv=excluded.iv,
                iv_chg=excluded.iv_chg,
                iv_chg_pct=excluded.iv_chg_pct,
                oi=excluded.oi,
                oi_lakh=excluded.oi_lakh,
                oi_chg=excluded.oi_chg,
                volume=excluded.volume,
                updated_at=excluded.updated_at,
                prev_close=COALESCE(option_quote_latest.prev_close, excluded.prev_close),
                iv_prev_close=COALESCE(option_quote_latest.iv_prev_close, excluded.iv_prev_close)
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
                ltp_chg_pct,
                iv,
                iv_chg,
                iv_chg_pct,
                oi,
                round(oi / 100000.0, 2),
                oi_chg,
                volume,
                ts,
                prev_close,
                iv_prev_close,
            ),
        )
        conn.commit()
    finally:
        conn.close()

    oi_lakh = round(oi / 100000.0, 2)
    _emit_quote_update(
        contract,
        ltp=ltp,
        ltp_chg=ltp_chg,
        ltp_chg_pct=ltp_chg_pct,
        iv=iv,
        iv_chg=iv_chg,
        oi_lakh=oi_lakh,
        ts=ts,
    )


def _emit_quote_update(
    contract: Dict[str, Any],
    *,
    ltp: float,
    ltp_chg: Optional[float],
    ltp_chg_pct: Optional[float],
    iv: Optional[float],
    iv_chg: Optional[float],
    oi_lakh: float,
    ts: str,
) -> None:
    token = int(contract["instrument_token"])
    now = time.monotonic()
    last = _emit_last.get(token, 0.0)
    if now - last < _EMIT_MIN_INTERVAL_SEC:
        return
    _emit_last[token] = now

    payload = {
        "instrument_token": token,
        "tradingsymbol": contract.get("tradingsymbol"),
        "strike": float(contract.get("strike") or 0),
        "instrument_type": contract.get("instrument_type"),
        "index_name": contract.get("index_name"),
        "ltp": ltp,
        "ltp_chg": round(ltp_chg, 2) if ltp_chg is not None else None,
        "ltp_chg_pct": round(ltp_chg_pct, 2) if ltp_chg_pct is not None else None,
        "iv": iv,
        "iv_chg": round(iv_chg, 2) if iv_chg is not None else None,
        "oi_lakh": oi_lakh,
        "updated_at": ts,
    }
    try:
        import app as app_module

        socketio = getattr(app_module, "socketio", None)
        if socketio:
            socketio.emit("option_quote_update", payload, namespace="/")
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


def poll_quotes_from_kite(kite, contracts: List[Dict[str, Any]], spot: float) -> int:
    """Fetch quotes for board display without changing capture token registration."""
    if not contracts:
        return 0
    ingested = 0
    index_name = (contracts[0].get("index_name") or "NIFTY").upper()
    trading_date = contracts[0].get("trading_date") or datetime.date.today().strftime("%Y-%m-%d")
    index_prev_close = resolve_index_prev_close(kite, index_name, trading_date)
    for c in contracts:
        c["_spot"] = spot
        if index_prev_close is not None:
            c["_index_prev_close"] = index_prev_close

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
                ingest_quote_row(c, q, spot, index_prev_close=index_prev_close)
                ingested += 1
    return ingested


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
