"""
Database migration script to add paper trade tables
Run this script once to create paper trade session and audit trail tables
"""
import sqlite3
import config
import logging

def migrate_paper_trade_tables():
    """Create paper trade session and audit trail tables"""
    conn = sqlite3.connect(config.DATABASE_PATH)
    cursor = conn.cursor()
    
    try:
        # Check if tables exist
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='paper_trade_sessions'")
        if not cursor.fetchone():
            logging.info("Creating 'paper_trade_sessions' table")
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS paper_trade_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    strategy_id INTEGER NOT NULL,
                    strategy_name TEXT NOT NULL,
                    instrument TEXT NOT NULL,
                    expiry_type TEXT NOT NULL,
                    candle_time TEXT NOT NULL,
                    ema_period INTEGER,
                    started_at DATETIME NOT NULL,
                    stopped_at DATETIME,
                    status TEXT NOT NULL DEFAULT 'running',
                    total_trades INTEGER DEFAULT 0,
                    total_pnl REAL DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users (id),
                    FOREIGN KEY (strategy_id) REFERENCES strategies (id)
                )
            """)
            logging.info("Created 'paper_trade_sessions' table")
        else:
            logging.info("'paper_trade_sessions' table already exists")
        
        # Check if audit trail table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='paper_trade_audit_trail'")
        if not cursor.fetchone():
            logging.info("Creating 'paper_trade_audit_trail' table")
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS paper_trade_audit_trail (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id INTEGER NOT NULL,
                    timestamp DATETIME NOT NULL,
                    log_type TEXT NOT NULL,
                    message TEXT NOT NULL,
                    details TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (session_id) REFERENCES paper_trade_sessions (id) ON DELETE CASCADE
                )
            """)
            # Create index for faster queries
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_session_timestamp ON paper_trade_audit_trail(session_id, timestamp)")
            logging.info("Created 'paper_trade_audit_trail' table")
        else:
            logging.info("'paper_trade_audit_trail' table already exists")
        
        conn.commit()
        logging.info("Paper trade tables migration completed successfully")
    except Exception as e:
        logging.error(f"Error during migration: {e}", exc_info=True)
        conn.rollback()
        raise
    finally:
        conn.close()

if __name__ == '__main__':
    migrate_paper_trade_tables()





