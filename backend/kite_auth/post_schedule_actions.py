"""
Phase 2 post-schedule actions: restart services after auto-auth using DB token only.

No Flask session or browser required. Called from post_schedule_pipeline hooks.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from database import get_db_connection

logger = logging.getLogger(__name__)


def _load_user_kite_credentials(user_id: int) -> Optional[Dict[str, str]]:
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT app_key, zerodha_access_token FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        return None
    data = dict(row)
    api_key = (data.get("app_key") or "").strip()
    token = (data.get("zerodha_access_token") or "").strip()
    if not api_key or not token:
        return None
    return {"app_key": api_key, "access_token": token}


def _validate_access_token(api_key: str, access_token: str) -> None:
    from kiteconnect import KiteConnect

    client = KiteConnect(api_key=api_key)
    client.set_access_token(access_token)
    client.profile()


def ensure_options_collection_scheduler() -> None:
    """Ensure the daily options collection scheduler is running (idempotent)."""
    try:
        from options_scheduler import start_scheduler

        if start_scheduler():
            logger.info("post_schedule: options data collection scheduler running")
        else:
            logger.warning("post_schedule: options scheduler did not start")
    except Exception as exc:
        logger.warning("post_schedule: options scheduler failed: %s", exc, exc_info=True)


def stop_global_ticker() -> None:
    """Stop the process-wide Kite ticker WebSocket if present."""
    try:
        import app as app_module
    except Exception as exc:
        logger.debug("post_schedule: cannot import app for ticker stop: %s", exc)
        return

    ticker = getattr(app_module, "ticker", None)
    if ticker is None:
        return
    try:
        if getattr(ticker, "kws", None) is not None:
            ticker.kws.close()
    except Exception as exc:
        logger.debug("post_schedule: ticker close: %s", exc)
    app_module.ticker = None
    logger.info("post_schedule: stopped previous Kite ticker instance")


def restart_backend_ticker_for_user(user_id: int) -> bool:
    """
    Restart the global market-data ticker using the user's stored Zerodha token.
    Returns True if a new ticker was started.
    """
    creds = _load_user_kite_credentials(user_id)
    if not creds:
        logger.info(
            "post_schedule: skip ticker restart for user_id=%s (missing app_key or token)",
            user_id,
        )
        return False

    api_key = creds["app_key"]
    access_token = creds["access_token"]

    try:
        _validate_access_token(api_key, access_token)
    except Exception as exc:
        from kiteconnect import exceptions as kite_exceptions

        if isinstance(exc, kite_exceptions.TokenException):
            logger.warning(
                "post_schedule: skip ticker restart for user_id=%s (invalid token): %s",
                user_id,
                exc,
            )
        else:
            logger.warning(
                "post_schedule: skip ticker restart for user_id=%s (validation failed): %s",
                user_id,
                exc,
            )
        return False

    try:
        import app as app_module
        from ticker import Ticker
    except Exception as exc:
        logger.warning("post_schedule: cannot import app/ticker: %s", exc)
        return False

    existing = getattr(app_module, "ticker", None)
    if existing is not None:
        same_token = getattr(existing, "access_token", None) == access_token
        expired = getattr(existing, "token_expired", False)
        if same_token and not expired:
            logger.info(
                "post_schedule: ticker already running with current token for user_id=%s",
                user_id,
            )
            return True
        stop_global_ticker()

    try:
        app_module.kite.api_key = api_key
        app_module.kite.set_access_token(access_token)
        app_module.ticker = Ticker(
            api_key,
            access_token,
            app_module.running_strategies,
            app_module.socketio,
            app_module.kite,
        )
        app_module.ticker.start()
        logger.info("post_schedule: Kite ticker restarted for user_id=%s", user_id)
        return True
    except Exception as exc:
        logger.warning(
            "post_schedule: ticker start failed for user_id=%s: %s",
            user_id,
            exc,
            exc_info=True,
        )
        app_module.ticker = None
        return False


def refresh_live_deployment_tokens_for_user(user_id: int) -> int:
    """Copy the user's current DB access token onto active live deployments."""
    creds = _load_user_kite_credentials(user_id)
    if not creds:
        return 0
    from live_trade import refresh_kite_access_tokens_for_user

    count = refresh_kite_access_tokens_for_user(user_id, creds["access_token"])
    if count:
        logger.info(
            "post_schedule: refreshed kite_access_token on %s deployment(s) for user_id=%s",
            count,
            user_id,
        )
    return count


def _token_expired_deployment(deployment: Dict[str, Any]) -> bool:
    err = (deployment.get("error_message") or "").lower()
    msg = ((deployment.get("state") or {}).get("message") or "").lower()
    combined = f"{err} {msg}"
    return any(
        phrase in combined
        for phrase in (
            "expired",
            "re-authenticate",
            "reauthenticate",
            "invalid kite session",
            "session expired",
            "missing zerodha",
        )
    )


def resume_live_trades_for_user(user_id: int) -> None:
    """Re-attach live strategy monitors and clear token-expiry errors after re-auth."""
    creds = _load_user_kite_credentials(user_id)
    if not creds:
        return

    access_token = creds["access_token"]
    api_key = creds["app_key"]

    try:
        import app as app_module
        from live_trade import (
            STATUS_ACTIVE,
            STATUS_ERROR,
            list_deployments_for_user,
            update_deployment as live_update_deployment,
        )
    except Exception as exc:
        logger.warning("post_schedule: live trade resume import failed: %s", exc)
        return

    import datetime

    now = datetime.datetime.now(datetime.timezone.utc)
    deployments = list_deployments_for_user(user_id)
    if not deployments:
        return

    app_module.kite.api_key = api_key
    app_module.kite.set_access_token(access_token)

    for deployment in deployments:
        deployment_id = deployment.get("id")
        status = deployment.get("status")
        strategy_id = deployment.get("strategy_id")

        if status == STATUS_ERROR and _token_expired_deployment(deployment):
            state = deployment.get("state") or {}
            state.update({
                "phase": "resuming",
                "message": "Resumed after scheduled Zerodha re-authentication.",
                "lastCheck": now.isoformat(),
            })
            deployment = live_update_deployment(
                deployment_id,
                status=STATUS_ACTIVE,
                state=state,
                last_run_at=now,
                error_message=None,
            ) or deployment
            status = STATUS_ACTIVE
            logger.info(
                "post_schedule: reactivated live deployment %s for user_id=%s",
                deployment_id,
                user_id,
            )

        if status != STATUS_ACTIVE:
            continue

        for info in list(app_module.running_strategies.values()):
            ctx = info.get("live_context")
            if ctx and info.get("user_id") == user_id:
                ctx["access_token"] = access_token
                ctx["api_key"] = api_key

        if not strategy_id:
            continue
        try:
            strategy_row = app_module._get_strategy_record(strategy_id, user_id)
            if strategy_row:
                app_module._ensure_live_strategy_monitor(
                    user_id,
                    deployment_id,
                    strategy_row,
                    access_token=access_token,
                    config=(deployment.get("state") or {}).get("config"),
                )
        except Exception as exc:
            logger.warning(
                "post_schedule: live monitor reinit failed deployment=%s user_id=%s: %s",
                deployment_id,
                user_id,
                exc,
            )

    run_id = f"mountain_signal_live_{user_id}"
    if user_id in app_module.mountain_signal_auto_trade_sessions:
        app_module.kite.set_access_token(access_token)
        if run_id not in app_module.running_strategies:
            info = app_module.mountain_signal_auto_trade_sessions[user_id]
            app_module.running_strategies[run_id] = {
                "strategy": info.get("trader"),
                "db_id": None,
                "user_id": user_id,
                "name": f"Mountain Signal Auto ({info.get('instrument', '')})",
            }
        logger.info("post_schedule: mountain signal auto-trade session refreshed for user_id=%s", user_id)


def refresh_paper_trades_for_user(user_id: int) -> int:
    """Update global Kite client for in-memory paper trade sessions for this user."""
    creds = _load_user_kite_credentials(user_id)
    if not creds:
        return 0

    try:
        import app as app_module
    except Exception as exc:
        logger.warning("post_schedule: paper trade refresh import failed: %s", exc)
        return 0

    app_module.kite.api_key = creds["app_key"]
    app_module.kite.set_access_token(creds["access_token"])

    refreshed = 0
    for _strategy_id, info in list(app_module.paper_trade_strategies.items()):
        if info.get("user_id") != user_id:
            continue
        strategy = info.get("strategy")
        if strategy is not None and hasattr(strategy, "kite"):
            try:
                strategy.kite = app_module.kite
            except Exception:
                pass
        refreshed += 1

    conn = get_db_connection()
    try:
        rows = conn.execute(
            """
            SELECT strategy_id FROM paper_trade_sessions
            WHERE user_id = ? AND status = 'running'
            """,
            (user_id,),
        ).fetchall()
    finally:
        conn.close()

    db_running = len(rows)
    in_memory = refreshed
    if db_running > in_memory:
        logger.info(
            "post_schedule: user_id=%s has %s DB paper session(s) not in memory "
            "(restart paper trade from UI if needed)",
            user_id,
            db_running - in_memory,
        )
    elif refreshed:
        logger.info(
            "post_schedule: refreshed %s in-memory paper trade session(s) for user_id=%s",
            refreshed,
            user_id,
        )
    return refreshed
