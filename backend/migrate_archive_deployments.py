"""
Migration script to create archived_deployments table for storing historical deployment data.
This allows users to review past deployments for strategy improvement.
"""
import sqlite3
import logging
from database import get_db_connection

logging.basicConfig(level=logging.INFO)

def migrate():
    """Create archived_deployments table if it doesn't exist."""
    conn = get_db_connection()
    try:
        # Create archived_deployments table (same structure as live_trade_deployments + archived_at)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS archived_deployments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original_deployment_id INTEGER,
                user_id INTEGER NOT NULL,
                strategy_id INTEGER,
                strategy_name TEXT,
                status TEXT NOT NULL,
                initial_investment REAL NOT NULL,
                scheduled_start DATETIME,
                started_at DATETIME,
                last_run_at DATETIME,
                archived_at DATETIME,
                state_json TEXT,
                kite_access_token TEXT,
                error_message TEXT,
                created_at DATETIME,
                updated_at DATETIME,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (strategy_id) REFERENCES strategies(id)
            )
            """
        )
        
        # Create index for faster queries
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_archived_deployments_user_id 
            ON archived_deployments(user_id)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_archived_deployments_archived_at 
            ON archived_deployments(archived_at DESC)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_archived_deployments_strategy_id 
            ON archived_deployments(strategy_id)
            """
        )
        
        conn.commit()
        logging.info("Migration completed: archived_deployments table created successfully")
    except Exception as e:
        logging.error(f"Migration failed: {e}", exc_info=True)
        conn.rollback()
        raise
    finally:
        conn.close()

if __name__ == '__main__':
    migrate()






