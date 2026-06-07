"""
Add kite_developer_plan / is_market_data_provider and backfill known accounts.
"""
from __future__ import annotations

import logging

from database import get_db_connection

logger = logging.getLogger(__name__)

PLAN_CONNECT = "connect"
PLAN_PERSONAL = "personal"


def ensure_kite_developer_plan_schema() -> None:
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("PRAGMA table_info(users)")
        columns = {row[1] for row in cur.fetchall()}
        if "kite_developer_plan" not in columns:
            cur.execute("ALTER TABLE users ADD COLUMN kite_developer_plan TEXT")
        if "is_market_data_provider" not in columns:
            cur.execute(
                "ALTER TABLE users ADD COLUMN is_market_data_provider BOOLEAN NOT NULL DEFAULT 0"
            )
        conn.commit()
    finally:
        conn.close()


def backfill_known_plans() -> None:
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE users
            SET kite_developer_plan = ?, is_market_data_provider = 1
            WHERE UPPER(COALESCE(kite_user_id, '')) = 'RD2033'
            """,
            (PLAN_CONNECT,),
        )
        rd = cur.rowcount
        cur.execute(
            """
            UPDATE users
            SET kite_developer_plan = ?
            WHERE UPPER(COALESCE(kite_user_id, '')) = 'VF4962'
            """,
            (PLAN_PERSONAL,),
        )
        vf = cur.rowcount
        conn.commit()
        if rd or vf:
            logger.info(
                "Kite developer plan backfill: RD2033=%s VF4962=%s",
                rd,
                vf,
            )
    finally:
        conn.close()


def migrate() -> None:
    ensure_kite_developer_plan_schema()
    backfill_known_plans()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    migrate()
    print("Kite developer plan migration complete.")
