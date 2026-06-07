"""
Resolve Kite Connect clients for market-data vs trading based on developer plan.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any, Callable, Dict, Optional, Tuple, TypeVar

from database import get_db_connection
from kiteconnect import KiteConnect
from kiteconnect import exceptions as kite_exceptions

logger = logging.getLogger(__name__)

PLAN_CONNECT = "connect"
PLAN_PERSONAL = "personal"

T = TypeVar("T")

_token_cache: Dict[int, Tuple[float, bool]] = {}
_TOKEN_CACHE_TTL_SEC = 60


class MarketDataUnavailable(Exception):
    """Global market data provider is not configured or token invalid."""


class TradingCredentialsRequired(Exception):
    """User must configure API key/secret on Welcome."""


class TradingTokenRequired(Exception):
    """User has credentials but no valid Zerodha session for trading."""


def _load_user(user_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    try:
        row = conn.execute(
            """
            SELECT id, app_key, app_secret, zerodha_access_token, kite_user_id,
                   kite_developer_plan, is_market_data_provider
            FROM users WHERE id = ? LIMIT 1
            """,
            (user_id,),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def _build_kite(app_key: str, access_token: str) -> KiteConnect:
    kite = KiteConnect(api_key=app_key)
    kite.set_access_token(access_token)
    return kite


def _validate_token(app_key: str, token: str) -> bool:
    if not app_key or not token:
        return False
    try:
        kite = _build_kite(app_key, token)
        kite.profile()
        return True
    except Exception:
        return False


def _cached_token_valid(user_id: int, app_key: str, token: Optional[str]) -> bool:
    if not token:
        return False
    now = time.time()
    cached = _token_cache.get(user_id)
    if cached and now - cached[0] < _TOKEN_CACHE_TTL_SEC:
        return cached[1]
    ok = _validate_token(app_key, token)
    _token_cache[user_id] = (now, ok)
    return ok


def get_global_market_data_user_id() -> Optional[int]:
    env_id = (os.environ.get("GLOBAL_MARKET_DATA_KITE_USER_ID") or "").strip()
    if env_id.isdigit():
        return int(env_id)
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT id FROM users WHERE is_market_data_provider = 1 LIMIT 1"
        ).fetchone()
        if row:
            return int(row[0])
        row = conn.execute(
            "SELECT id FROM users WHERE UPPER(COALESCE(kite_user_id, '')) = 'RD2033' LIMIT 1"
        ).fetchone()
        return int(row[0]) if row else None
    finally:
        conn.close()


def _kite_for_user_record(user: Dict[str, Any]) -> KiteConnect:
    app_key = user.get("app_key")
    token = user.get("zerodha_access_token")
    if not app_key or not token:
        raise MarketDataUnavailable("Missing API key or access token")
    return _build_kite(app_key, token)


def resolve_market_data_kite(session_user_id: int) -> KiteConnect:
    user = _load_user(session_user_id)
    if not user:
        raise MarketDataUnavailable("User not found")

    plan = (user.get("kite_developer_plan") or "").lower()
    app_key = user.get("app_key")
    token = user.get("zerodha_access_token")

    if plan == PLAN_CONNECT and app_key and _cached_token_valid(session_user_id, app_key, token):
        return _build_kite(app_key, token)

    provider_id = get_global_market_data_user_id()
    if not provider_id:
        raise MarketDataUnavailable("Global market data provider not configured")
    provider = _load_user(provider_id)
    if not provider:
        raise MarketDataUnavailable("Global market data provider user missing")
    return _kite_for_user_record(provider)


def resolve_trading_kite(session_user_id: int) -> KiteConnect:
    user = _load_user(session_user_id)
    if not user:
        raise TradingCredentialsRequired("User not found")
    if not user.get("app_key") or not user.get("app_secret"):
        raise TradingCredentialsRequired("Zerodha API credentials not configured")
    token = user.get("zerodha_access_token")
    if not token or not _cached_token_valid(session_user_id, user["app_key"], token):
        raise TradingTokenRequired("Zerodha session expired or not authenticated")
    return _build_kite(user["app_key"], token)


def user_needs_plan_prompt(user: Dict[str, Any]) -> bool:
    return bool(
        user.get("app_key")
        and user.get("app_secret")
        and not user.get("kite_developer_plan")
    )


def compute_token_status(
    user: Dict[str, Any],
    *,
    validate: bool = False,
) -> str:
    """Return none | inactive | active."""
    if not user.get("app_key") or not user.get("app_secret"):
        return "none"
    token = user.get("zerodha_access_token")
    if not token:
        return "inactive"
    if validate:
        uid = int(user.get("id") or 0)
        if uid and _cached_token_valid(uid, user["app_key"], token):
            return "active"
        return "inactive"
    return "active"


def get_user_kite_context(session_user_id: int) -> Dict[str, Any]:
    user = _load_user(session_user_id) or {}
    plan = user.get("kite_developer_plan")
    has_creds = bool(user.get("app_key") and user.get("app_secret"))
    token_status = compute_token_status(user, validate=True)

    if not has_creds:
        market_source = "shared"
    elif (plan or "").lower() == PLAN_CONNECT and token_status == "active":
        market_source = "own"
    else:
        market_source = "shared"

    return {
        "kite_developer_plan": plan,
        "market_data_source": market_source,
        "needs_plan_selection": user_needs_plan_prompt(user),
        "zerodha_token_status": token_status if has_creds else "none",
        "has_trading_credentials": has_creds,
    }


def run_with_market_data_kite(
    session_user_id: int,
    action: Callable[[KiteConnect], T],
) -> T:
    kite = resolve_market_data_kite(session_user_id)
    return action(kite)


def get_global_provider_kite() -> KiteConnect:
    provider_id = get_global_market_data_user_id()
    if not provider_id:
        raise MarketDataUnavailable("Global market data provider not configured")
    provider = _load_user(provider_id)
    if not provider:
        raise MarketDataUnavailable("Global market data provider user missing")
    return _kite_for_user_record(provider)


def invalidate_token_cache(user_id: Optional[int] = None) -> None:
    if user_id is None:
        _token_cache.clear()
    else:
        _token_cache.pop(user_id, None)
