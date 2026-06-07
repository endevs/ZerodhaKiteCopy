"""
Migration for option chain quote / tick / spike tables.
Safe to run multiple times (CREATE IF NOT EXISTS).
"""
import logging
import os

import config
from database import get_db_connection

logger = logging.getLogger(__name__)

OPTION_TICK_RETENTION_DAYS = int(os.getenv("OPTION_TICK_RETENTION_DAYS", "60"))


def ensure_option_chain_quote_schema() -> None:
    conn = get_db_connection()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS option_chain_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                index_name TEXT NOT NULL,
                trading_date DATE NOT NULL,
                expiry_date DATE NOT NULL,
                snapshot_ts TEXT NOT NULL,
                spot REAL,
                atm_strike REAL,
                payload_json TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(index_name, trading_date, expiry_date, snapshot_ts)
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_ocs_index_date_expiry
            ON option_chain_snapshots(index_name, trading_date, expiry_date)
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS option_quote_latest (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                instrument_token INTEGER NOT NULL,
                tradingsymbol TEXT NOT NULL,
                index_name TEXT NOT NULL,
                trading_date DATE NOT NULL,
                expiry_date DATE NOT NULL,
                strike REAL NOT NULL,
                instrument_type TEXT NOT NULL,
                ltp REAL,
                ltp_chg REAL,
                ltp_chg_pct REAL,
                iv REAL,
                iv_chg REAL,
                iv_chg_pct REAL,
                oi INTEGER,
                oi_lakh REAL,
                oi_chg INTEGER,
                volume INTEGER,
                updated_at TEXT NOT NULL,
                UNIQUE(instrument_token, trading_date)
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_oql_board
            ON option_quote_latest(index_name, trading_date, expiry_date)
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS option_quote_ticks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                instrument_token INTEGER NOT NULL,
                tradingsymbol TEXT,
                index_name TEXT NOT NULL,
                trading_date DATE NOT NULL,
                expiry_date DATE NOT NULL,
                strike REAL,
                instrument_type TEXT,
                ts TEXT NOT NULL,
                ltp REAL,
                iv REAL,
                oi INTEGER,
                volume INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(instrument_token, trading_date, ts)
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_oqt_token_date_ts
            ON option_quote_ticks(instrument_token, trading_date, ts)
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_oqt_index_date
            ON option_quote_ticks(index_name, trading_date)
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS option_spike_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                instrument_token INTEGER NOT NULL,
                tradingsymbol TEXT,
                index_name TEXT NOT NULL,
                trading_date DATE NOT NULL,
                expiry_date DATE NOT NULL,
                strike REAL,
                instrument_type TEXT,
                ts TEXT NOT NULL,
                metric TEXT NOT NULL,
                value REAL NOT NULL,
                window_sec INTEGER NOT NULL,
                severity TEXT NOT NULL DEFAULT 'medium',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_spike_index_date_ts
            ON option_spike_events(index_name, trading_date, ts DESC)
        """)

        conn.commit()
        logger.info("Option chain quote schema ensured at %s", config.DATABASE_PATH)
    except Exception as exc:
        conn.rollback()
        logger.error("Option chain quote schema failed: %s", exc, exc_info=True)
        raise
    finally:
        conn.close()


def purge_old_option_ticks(retention_days: int | None = None) -> int:
    days = retention_days if retention_days is not None else OPTION_TICK_RETENTION_DAYS
    conn = get_db_connection()
    try:
        cur = conn.execute(
            """
            DELETE FROM option_quote_ticks
            WHERE trading_date < date('now', ?)
            """,
            (f"-{int(days)} days",),
        )
        conn.commit()
        deleted = cur.rowcount
        if deleted:
            logger.info("Purged %s option_quote_ticks older than %s days", deleted, days)
        return deleted
    finally:
        conn.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    ensure_option_chain_quote_schema()
    print("Migration complete.")
