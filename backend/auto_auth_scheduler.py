"""
Fixed Mon–Fri auto-auth scheduler (default 8:45 AM IST).
Polls every minute and triggers auth for all configured users.
"""
from __future__ import annotations

import logging
from typing import Callable, List

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from database import get_db_connection
from kite_auth.schedule_runs import already_ran_for_slot, insert_run, mark_run_started
from kite_auth.schedule_utils import is_due_window_for_scheduler, now_ist, slot_iso

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler()

_process_hook: Callable[[], None] | None = None


def register_process_hook(hook: Callable[[], None]) -> None:
    global _process_hook
    _process_hook = hook


def list_auto_auth_configured_user_ids() -> List[int]:
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """
            SELECT id FROM users
            WHERE app_key IS NOT NULL AND TRIM(app_key) != ''
              AND app_secret IS NOT NULL AND TRIM(app_secret) != ''
              AND kite_user_id IS NOT NULL AND TRIM(kite_user_id) != ''
              AND kite_password IS NOT NULL AND TRIM(kite_password) != ''
              AND kite_totp_secret IS NOT NULL AND TRIM(kite_totp_secret) != ''
            """
        ).fetchall()
        return [int(row["id"]) for row in rows]
    finally:
        conn.close()


def process_scheduled_auto_auth() -> None:
    if not is_due_window_for_scheduler():
        return
    if _process_hook is None:
        logger.warning("auto_auth_scheduler: process hook not registered")
        return
    current = now_ist()
    slot = slot_iso(current)
    logger.info("auto_auth_scheduler: processing slot %s", slot)
    _process_hook()


def start_scheduler() -> bool:
    try:
        if scheduler.running:
            return True
        scheduler.add_job(
            process_scheduled_auto_auth,
            trigger=IntervalTrigger(minutes=1),
            id="auto_auth_schedule_poll",
            name="Auto-auth Mon-Fri schedule poll",
            replace_existing=True,
            max_instances=1,
        )
        scheduler.start()
        logger.info("Auto-auth schedule scheduler started (Mon-Fri %s IST poll)", "08:45")
        return True
    except Exception as exc:
        logger.error("Error starting auto-auth scheduler: %s", exc, exc_info=True)
        return False


def stop_scheduler() -> None:
    try:
        if scheduler.running:
            scheduler.shutdown()
            logger.info("Auto-auth schedule scheduler stopped")
    except Exception as exc:
        logger.error("Error stopping auto-auth scheduler: %s", exc, exc_info=True)


def record_skipped_run(user_id: int, scheduled_for: str, reason: str) -> None:
    if already_ran_for_slot(user_id, scheduled_for):
        return
    insert_run(user_id, scheduled_for, status="skipped", reason=reason, trigger="schedule")


def record_pending_run(user_id: int, scheduled_for: str) -> None:
    if already_ran_for_slot(user_id, scheduled_for):
        return
    insert_run(
        user_id,
        scheduled_for,
        status="pending",
        trigger="schedule",
        started_at=now_ist().isoformat(),
    )


def mark_scheduled_run_started(user_id: int, scheduled_for: str) -> None:
    mark_run_started(user_id, scheduled_for)
