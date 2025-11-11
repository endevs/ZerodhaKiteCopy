import datetime
import json
import logging
from typing import Any, Dict, List, Optional, Tuple

from database import get_db_connection


STATUS_SCHEDULED = 'scheduled'
STATUS_ACTIVE = 'active'
STATUS_PAUSED = 'paused'
STATUS_STOPPED = 'stopped'
STATUS_ERROR = 'error'

ALLOWED_STATUSES = {
    STATUS_SCHEDULED,
    STATUS_ACTIVE,
    STATUS_PAUSED,
    STATUS_STOPPED,
    STATUS_ERROR,
}


def ensure_live_trade_tables() -> None:
    """Create required tables for live trade deployments if they don't exist."""
    conn = get_db_connection()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS live_trade_deployments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                strategy_id INTEGER,
                strategy_name TEXT,
                status TEXT NOT NULL,
                initial_investment REAL NOT NULL,
                scheduled_start DATETIME,
                started_at DATETIME,
                last_run_at DATETIME,
                state_json TEXT,
                kite_access_token TEXT,
                error_message TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (strategy_id) REFERENCES strategies(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TRIGGER IF NOT EXISTS trg_live_trade_updated_at
            AFTER UPDATE ON live_trade_deployments
            FOR EACH ROW
            BEGIN
                UPDATE live_trade_deployments
                SET updated_at = CURRENT_TIMESTAMP
                WHERE id = OLD.id;
            END;
            """
        )
        conn.commit()
    finally:
        conn.close()


def _row_to_dict(row: Optional[Any]) -> Optional[Dict[str, Any]]:
    if row is None:
        return None
    data = dict(row)
    state_blob = data.get('state_json')
    if state_blob:
        try:
            data['state'] = json.loads(state_blob)
        except json.JSONDecodeError:
            logging.warning("Failed to decode state_json for deployment %s", data.get('id'))
            data['state'] = {}
    else:
        data['state'] = {}
    return data


def get_deployment_for_user(user_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    try:
        row = conn.execute(
            """
            SELECT *
            FROM live_trade_deployments
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()
    finally:
        conn.close()
    return _row_to_dict(row)


def get_deployment_by_id(deployment_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT * FROM live_trade_deployments WHERE id = ?",
            (deployment_id,),
        ).fetchone()
    finally:
        conn.close()
    return _row_to_dict(row)


def create_deployment(
    *,
    user_id: int,
    strategy_id: Optional[int],
    strategy_name: str,
    initial_investment: float,
    scheduled_start: Optional[datetime.datetime],
    status: str,
    kite_access_token: str,
    state: Optional[Dict[str, Any]] = None,
    started_at: Optional[datetime.datetime] = None,
) -> Dict[str, Any]:
    if status not in ALLOWED_STATUSES:
        raise ValueError(f"Unsupported deployment status: {status}")

    state_blob = json.dumps(state or {})
    conn = get_db_connection()
    try:
        cursor = conn.execute(
            """
            INSERT INTO live_trade_deployments (
                user_id, strategy_id, strategy_name, status,
                initial_investment, scheduled_start, started_at,
                last_run_at, state_json, kite_access_token, error_message
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)
            """,
            (
                user_id,
                strategy_id,
                strategy_name,
                status,
                float(initial_investment),
                scheduled_start.isoformat() if scheduled_start else None,
                started_at.isoformat() if started_at else None,
                state_blob,
                kite_access_token,
            ),
        )
        conn.commit()
        deployment_id = cursor.lastrowid
    finally:
        conn.close()

    return get_deployment_by_id(deployment_id)


def _serialize_state(state: Optional[Dict[str, Any]]) -> Optional[str]:
    if state is None:
        return None

    def convert(obj: Any) -> Any:
        if isinstance(obj, datetime.datetime):
            return obj.isoformat()
        if isinstance(obj, datetime.date):
            return obj.isoformat()
        if isinstance(obj, list):
            return [convert(item) for item in obj]
        if isinstance(obj, dict):
            return {key: convert(value) for key, value in obj.items()}
        return obj

    cleaned = convert(state)
    return json.dumps(cleaned)


def update_deployment(
    deployment_id: int,
    *,
    status: Optional[str] = None,
    state: Optional[Dict[str, Any]] = None,
    last_run_at: Optional[datetime.datetime] = None,
    started_at: Optional[datetime.datetime] = None,
    error_message: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    fields: List[str] = []
    params: List[Any] = []

    if status:
        if status not in ALLOWED_STATUSES:
            raise ValueError(f"Unsupported deployment status: {status}")
        fields.append("status = ?")
        params.append(status)

    if state is not None:
        fields.append("state_json = ?")
        params.append(_serialize_state(state))

    if last_run_at is not None:
        fields.append("last_run_at = ?")
        params.append(last_run_at.isoformat())

    if started_at is not None:
        fields.append("started_at = ?")
        params.append(started_at.isoformat())

    if error_message is not None:
        fields.append("error_message = ?")
        params.append(error_message)

    if not fields:
        return get_deployment_by_id(deployment_id)

    params.append(deployment_id)

    conn = get_db_connection()
    try:
        conn.execute(
            f"""
            UPDATE live_trade_deployments
            SET {', '.join(fields)}
            WHERE id = ?
            """,
            tuple(params),
        )
        conn.commit()
    finally:
        conn.close()

    return get_deployment_by_id(deployment_id)


def get_deployments_for_processing(now: datetime.datetime) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """
            SELECT *
            FROM live_trade_deployments
            WHERE status IN (?, ?, ?)
            """,
            (STATUS_SCHEDULED, STATUS_ACTIVE, STATUS_ERROR),
        ).fetchall()
    finally:
        conn.close()

    deployments: List[Dict[str, Any]] = []
    for row in rows:
        deployment = _row_to_dict(row)
        if not deployment:
            continue
        deployments.append(deployment)
    return deployments


def delete_deployment(deployment_id: int) -> None:
    conn = get_db_connection()
    try:
        conn.execute("DELETE FROM live_trade_deployments WHERE id = ?", (deployment_id,))
        conn.commit()
    finally:
        conn.close()


def append_state_message(deployment_id: int, *, message: str, level: str = 'info') -> Optional[Dict[str, Any]]:
    deployment = get_deployment_by_id(deployment_id)
    if not deployment:
        return None

    state = deployment.get('state') or {}
    history = state.get('history', [])
    history.append(
        {
            'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'level': level,
            'message': message,
        }
    )
    state['history'] = history[-50:]  # Keep recent entries only
    return update_deployment(deployment_id, state=state)


