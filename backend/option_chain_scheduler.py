"""
Background jobs: poll ATM±15 capture band during market hours; purge old ticks nightly.
"""
from __future__ import annotations

import datetime
import logging
import time

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

logger = logging.getLogger(__name__)
_scheduler: BackgroundScheduler | None = None


def _ist_now() -> datetime.datetime:
    try:
        from zoneinfo import ZoneInfo
        return datetime.datetime.now(ZoneInfo("Asia/Kolkata"))
    except Exception:
        return datetime.datetime.now()


def _in_market_hours() -> bool:
    now = _ist_now()
    if now.weekday() >= 5:
        return False
    t = now.hour * 60 + now.minute
    return 9 * 60 + 15 <= t <= 15 * 60 + 30


def poll_capture_band() -> None:
    if not _in_market_hours():
        return
    # #region agent log
    _poll_started = time.perf_counter()
    try:
        from debug_agent_log import agent_log

        agent_log(
            "option_chain_scheduler.py:poll_capture_band:start",
            "poll_capture_band started",
            {},
            "D",
        )
    except Exception:
        pass
    # #endregion
    try:
        from kite_client_resolver import get_global_provider_kite
        from option_chain_board import pick_default_expiry
        from option_chain_capture import capture_quotes_from_kite, resolve_atm_band_contracts

        kite = get_global_provider_kite()
        today = datetime.date.today()
        trading_date = today
        total_ingested = 0
        for index_name in ("NIFTY", "BANKNIFTY"):
            sym = "NSE:NIFTY BANK" if index_name == "BANKNIFTY" else "NSE:NIFTY 50"
            spot = float(kite.ltp(sym)[sym]["last_price"])
            instruments = kite.instruments("NFO")
            expiries = sorted(list(set([
                inst["expiry"].strftime("%Y-%m-%d")
                for inst in instruments
                if inst.get("name") == index_name and inst.get("expiry")
            ])))
            expiry_str = pick_default_expiry(expiries, today)
            if not expiry_str:
                continue
            expiry_date = datetime.datetime.strptime(expiry_str, "%Y-%m-%d").date()
            band = resolve_atm_band_contracts(kite, index_name, expiry_date, spot, trading_date)
            capture_quotes_from_kite(kite, band, spot)
            total_ingested += len(band)
    except Exception as exc:
        logger.debug("poll_capture_band skipped: %s", exc)
        # #region agent log
        try:
            from debug_agent_log import agent_log

            agent_log(
                "option_chain_scheduler.py:poll_capture_band:error",
                "poll_capture_band failed",
                {
                    "duration_ms": int((time.perf_counter() - _poll_started) * 1000),
                    "error_type": type(exc).__name__,
                    "error_msg": str(exc)[:300],
                },
                "D",
            )
        except Exception:
            pass
        # #endregion
    else:
        # #region agent log
        try:
            from debug_agent_log import agent_log

            agent_log(
                "option_chain_scheduler.py:poll_capture_band:done",
                "poll_capture_band finished",
                {"duration_ms": int((time.perf_counter() - _poll_started) * 1000)},
                "D",
            )
        except Exception:
            pass
        # #endregion


def purge_ticks_job() -> None:
    try:
        from migrate_option_chain_quotes import purge_old_option_ticks
        purge_old_option_ticks()
    except Exception as exc:
        logger.warning("purge_ticks_job failed: %s", exc)


def start_option_chain_scheduler() -> bool:
    global _scheduler
    if _scheduler and _scheduler.running:
        return True
    _scheduler = BackgroundScheduler()
    _scheduler.add_job(
        poll_capture_band,
        trigger=IntervalTrigger(seconds=3),
        id="option_chain_capture_poll",
        replace_existing=True,
    )
    _scheduler.add_job(
        purge_ticks_job,
        trigger=CronTrigger(hour=18, minute=30),
        id="option_chain_tick_purge",
        replace_existing=True,
    )
    _scheduler.start()
    logger.info("Option chain scheduler started (3s capture poll, nightly purge)")
    return True
