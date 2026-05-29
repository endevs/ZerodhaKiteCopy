from __future__ import annotations

import datetime
import logging
from typing import Any, Dict, List, Optional

from database import get_db_connection

from .schedule_utils import slot_iso, weekday_label

logger = logging.getLogger(__name__)


def _utc_now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def already_ran_for_slot(user_id: int, scheduled_for: str) -> bool:
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT id FROM user_auto_auth_runs WHERE user_id = ? AND scheduled_for = ?",
            (user_id, scheduled_for),
        ).fetchone()
        return row is not None
    finally:
        conn.close()


def insert_run(
    user_id: int,
    scheduled_for: str,
    *,
    status: str,
    reason: Optional[str] = None,
    trigger: str = "schedule",
    started_at: Optional[str] = None,
    finished_at: Optional[str] = None,
) -> None:
    conn = get_db_connection()
    try:
        conn.execute(
            """
            INSERT INTO user_auto_auth_runs
                (user_id, scheduled_for, started_at, finished_at, status, reason, trigger)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (user_id, scheduled_for, started_at, finished_at, status, reason, trigger),
        )
        conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.warning("Could not insert auto-auth run user_id=%s slot=%s: %s", user_id, scheduled_for, exc)
    finally:
        conn.close()


def mark_run_started(user_id: int, scheduled_for: str) -> None:
    conn = get_db_connection()
    try:
        conn.execute(
            """
            UPDATE user_auto_auth_runs
            SET status = 'running', started_at = COALESCE(started_at, ?)
            WHERE user_id = ? AND scheduled_for = ?
            """,
            (_utc_now_iso(), user_id, scheduled_for),
        )
        conn.commit()
    finally:
        conn.close()


def finalize_run_for_slot(
    user_id: int,
    scheduled_for: str,
    *,
    status: str,
    reason: Optional[str] = None,
) -> None:
    conn = get_db_connection()
    try:
        conn.execute(
            """
            UPDATE user_auto_auth_runs
            SET status = ?, reason = ?, finished_at = ?
            WHERE user_id = ? AND scheduled_for = ?
              AND status IN ('pending', 'running')
            """,
            (status, reason, _utc_now_iso(), user_id, scheduled_for),
        )
        conn.commit()
    finally:
        conn.close()


def get_latest_pending_slot(user_id: int) -> Optional[str]:
    conn = get_db_connection()
    try:
        row = conn.execute(
            """
            SELECT scheduled_for FROM user_auto_auth_runs
            WHERE user_id = ? AND status IN ('pending', 'running')
            ORDER BY scheduled_for DESC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()
        return row["scheduled_for"] if row else None
    finally:
        conn.close()


def finalize_latest_pending_run(
    user_id: int,
    *,
    status: str,
    reason: Optional[str] = None,
) -> Optional[str]:
    """Finalize the latest pending/running run. Returns scheduled_for if updated."""
    slot = get_latest_pending_slot(user_id)
    if not slot:
        return None
    finalize_run_for_slot(user_id, slot, status=status, reason=reason)
    return slot


def get_past_runs(user_id: int, limit: int = 5) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """
            SELECT scheduled_for, started_at, finished_at, status, reason, trigger
            FROM user_auto_auth_runs
            WHERE user_id = ?
            ORDER BY scheduled_for DESC
            LIMIT ?
            """,
            (user_id, limit),
        ).fetchall()
        return [_serialize_run(dict(row)) for row in rows]
    finally:
        conn.close()


def get_runs_for_slots(user_id: int, slot_isos: List[str]) -> Dict[str, Dict[str, Any]]:
    if not slot_isos:
        return {}
    conn = get_db_connection()
    try:
        placeholders = ",".join("?" for _ in slot_isos)
        rows = conn.execute(
            f"""
            SELECT scheduled_for, started_at, finished_at, status, reason, trigger
            FROM user_auto_auth_runs
            WHERE user_id = ? AND scheduled_for IN ({placeholders})
            """,
            (user_id, *slot_isos),
        ).fetchall()
        return {row["scheduled_for"]: _serialize_run(dict(row)) for row in rows}
    finally:
        conn.close()


def _serialize_run(row: Dict[str, Any]) -> Dict[str, Any]:
    scheduled_for = row.get("scheduled_for") or ""
    day = weekday_label(datetime.datetime.fromisoformat(scheduled_for)) if scheduled_for else ""
    return {
        "scheduled_for": scheduled_for,
        "day": day,
        "started_at": row.get("started_at"),
        "finished_at": row.get("finished_at"),
        "status": row.get("status") or "scheduled",
        "reason": row.get("reason"),
        "trigger": row.get("trigger") or "schedule",
        "details": _status_details(row.get("status"), row.get("reason")),
    }


def _status_details(status: Optional[str], reason: Optional[str]) -> str:
    if status == "succeeded":
        return "Token refreshed"
    if status == "skipped" and reason == "token_valid":
        return "Token already valid"
    if status == "skipped":
        return reason or "Skipped"
    if status == "failed" and reason:
        return reason.replace("_", " ")
    if status == "needs_manual" and reason:
        return reason.replace("_", " ")
    return reason or "—"


def build_upcoming_runs(user_id: int, slots: List[datetime.datetime]) -> List[Dict[str, Any]]:
    slot_isos = [slot_iso(slot) for slot in slots]
    existing = get_runs_for_slots(user_id, slot_isos)
    upcoming: List[Dict[str, Any]] = []
    for slot in slots:
        iso = slot_iso(slot)
        if iso in existing:
            upcoming.append(existing[iso])
        else:
            upcoming.append(
                {
                    "scheduled_for": iso,
                    "day": weekday_label(slot),
                    "started_at": None,
                    "finished_at": None,
                    "status": "scheduled",
                    "reason": None,
                    "trigger": "schedule",
                    "details": "—",
                }
            )
    return upcoming
