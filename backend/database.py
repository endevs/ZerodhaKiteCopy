import os
import sqlite3
import config
import time
import logging


def ensure_core_schema():
    """
    Create core tables if missing (e.g. fresh Docker volume with empty SQLite file).
    Idempotent: safe on every startup. Does not DROP existing data.
    """
    db_path = config.DATABASE_PATH
    parent = os.path.dirname(os.path.abspath(db_path))
    if parent and not os.path.exists(parent):
        os.makedirs(parent, exist_ok=True)

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                mobile TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                email_verified BOOLEAN NOT NULL DEFAULT 0,
                app_key TEXT,
                app_secret TEXT,
                otp TEXT,
                otp_expiry DATETIME,
                zerodha_access_token TEXT,
                zerodha_token_created_at DATETIME,
                user_name TEXT,
                google_picture TEXT,
                is_admin BOOLEAN NOT NULL DEFAULT 0,
                current_subscription_id INTEGER,
                subscription_trial_ends_at DATETIME,
                kite_user_id TEXT,
                kite_password TEXT,
                kite_totp_secret TEXT,
                auto_auth_configured_at DATETIME
            )
        """)
        cur.execute("PRAGMA table_info(users)")
        user_columns = {row[1] for row in cur.fetchall()}
        for column_name, column_def in (
            ("kite_user_id", "TEXT"),
            ("kite_password", "TEXT"),
            ("kite_totp_secret", "TEXT"),
            ("auto_auth_configured_at", "DATETIME"),
        ):
            if column_name not in user_columns:
                cur.execute(f"ALTER TABLE users ADD COLUMN {column_name} {column_def}")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_contact_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                mobile TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS strategies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                strategy_name TEXT NOT NULL,
                strategy_type TEXT NOT NULL,
                instrument TEXT NOT NULL,
                candle_time TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                stop_loss REAL NOT NULL,
                target_profit REAL NOT NULL,
                total_lot INTEGER NOT NULL,
                trailing_stop_loss REAL NOT NULL,
                segment TEXT NOT NULL,
                trade_type TEXT NOT NULL,
                strike_price TEXT NOT NULL,
                expiry_type TEXT NOT NULL,
                ema_period INTEGER,
                status TEXT NOT NULL DEFAULT 'saved',
                visibility TEXT NOT NULL DEFAULT 'private',
                indicators TEXT,
                entry_rules TEXT,
                exit_rules TEXT,
                blueprint TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                approval_status TEXT NOT NULL DEFAULT 'approved',
                submitted_for_approval_at DATETIME,
                approved_at DATETIME,
                approved_by INTEGER,
                rejected_at DATETIME,
                rejected_by INTEGER,
                rejection_reason TEXT,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS market_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                instrument_token INTEGER NOT NULL,
                trading_symbol TEXT NOT NULL,
                timestamp DATETIME NOT NULL,
                last_price REAL,
                volume INTEGER,
                instrument_type TEXT
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS tick_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                instrument_token INTEGER NOT NULL,
                timestamp DATETIME NOT NULL,
                last_price REAL NOT NULL,
                volume INTEGER
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS tick_data_status (
                instrument_token INTEGER PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'Stopped'
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS simulated_market_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                instrument_token INTEGER NOT NULL,
                timestamp DATETIME NOT NULL,
                last_price REAL NOT NULL
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS five_minute_candles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                instrument_token INTEGER NOT NULL,
                timestamp DATETIME NOT NULL,
                open REAL NOT NULL,
                high REAL NOT NULL,
                low REAL NOT NULL,
                close REAL NOT NULL,
                volume INTEGER NOT NULL,
                ema REAL
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS legacy_kite_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                legacy_user_id TEXT NOT NULL UNIQUE,
                name TEXT,
                email TEXT,
                api_key TEXT,
                api_secret TEXT,
                request_token TEXT,
                access_token TEXT,
                public_token TEXT,
                totp_secret TEXT,
                kite_password TEXT,
                strategy TEXT,
                allowed_exchanges TEXT,
                paper_trade_strategies TEXT,
                nfo_buy_and_sell TEXT,
                account_status TEXT,
                metadata_json TEXT,
                imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS legacy_kite_access_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                admin_user_id INTEGER NOT NULL,
                action TEXT NOT NULL,
                legacy_account_id INTEGER,
                legacy_user_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_auto_auth_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                scheduled_for TEXT NOT NULL,
                started_at TEXT,
                finished_at TEXT,
                status TEXT NOT NULL,
                reason TEXT,
                trigger TEXT NOT NULL DEFAULT 'schedule',
                UNIQUE(user_id, scheduled_for),
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS auto_auth_schedule_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                hour INTEGER NOT NULL DEFAULT 8,
                minute INTEGER NOT NULL DEFAULT 45,
                weekdays TEXT NOT NULL DEFAULT '0,1,2,3,4',
                timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
                updated_at TEXT,
                updated_by INTEGER,
                FOREIGN KEY (updated_by) REFERENCES users (id)
            )
        """)
        cur.execute("SELECT id FROM auto_auth_schedule_settings WHERE id = 1")
        if cur.fetchone() is None:
            cur.execute(
                """
                INSERT INTO auto_auth_schedule_settings (id, hour, minute, weekdays, timezone)
                VALUES (1, 8, 45, '0,1,2,3,4', 'Asia/Kolkata')
                """
            )

        conn.commit()
        logging.info("Core database schema ensured (tables present or created).")
    except Exception as e:
        logging.error(f"ensure_core_schema failed: {e}", exc_info=True)
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        try:
            conn.close()
        except Exception:
            pass


def get_db_connection(timeout=30.0, retries=3):
    """
    Get a database connection with proper timeout and retry logic.
    
    Args:
        timeout: Timeout in seconds for database operations (default: 30)
        retries: Number of retries if database is locked (default: 3)
    
    Returns:
        sqlite3.Connection with row_factory set
    """
    for attempt in range(retries):
        try:
            conn = sqlite3.connect(
                config.DATABASE_PATH,
                timeout=timeout,
                check_same_thread=False  # Allow use from multiple threads/eventlet
            )
            conn.row_factory = sqlite3.Row
            # Enable WAL mode for better concurrency
            conn.execute('PRAGMA journal_mode=WAL')
            return conn
        except sqlite3.OperationalError as e:
            if 'locked' in str(e).lower() and attempt < retries - 1:
                wait_time = (attempt + 1) * 0.1  # Exponential backoff: 0.1s, 0.2s, 0.3s
                logging.warning(f"Database locked, retrying in {wait_time}s (attempt {attempt + 1}/{retries})")
                time.sleep(wait_time)
                continue
            else:
                logging.error(f"Database connection failed after {retries} attempts: {e}")
                raise
        except Exception as e:
            logging.error(f"Unexpected error connecting to database: {e}")
            raise

def create_tables():
    conn = get_db_connection()
    conn.execute('DROP TABLE IF EXISTS users')
    conn.execute("""
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mobile TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            email_verified BOOLEAN NOT NULL DEFAULT 0,
            app_key TEXT,
            app_secret TEXT,
            otp TEXT,
            otp_expiry DATETIME,
            zerodha_access_token TEXT,
            zerodha_token_created_at DATETIME,
            kite_user_id TEXT,
            kite_password TEXT,
            kite_totp_secret TEXT,
            auto_auth_configured_at DATETIME
        )
    """)
    conn.execute('DROP TABLE IF EXISTS user_contact_messages')
    conn.execute("""
        CREATE TABLE user_contact_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            mobile TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    """)
    conn.execute('DROP TABLE IF EXISTS strategies')
    conn.execute("""
        CREATE TABLE strategies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            strategy_name TEXT NOT NULL,
            strategy_type TEXT NOT NULL,
            instrument TEXT NOT NULL,
            candle_time TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            stop_loss REAL NOT NULL,
            target_profit REAL NOT NULL,
            total_lot INTEGER NOT NULL,
            trailing_stop_loss REAL NOT NULL,
            segment TEXT NOT NULL,
            trade_type TEXT NOT NULL,
            strike_price TEXT NOT NULL,
            expiry_type TEXT NOT NULL,
            ema_period INTEGER,
            status TEXT NOT NULL DEFAULT 'saved',
            visibility TEXT NOT NULL DEFAULT 'private',
            indicators TEXT,
            entry_rules TEXT,
            exit_rules TEXT,
            blueprint TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    """)
    conn.execute('DROP TABLE IF EXISTS market_data')
    conn.execute('''
        CREATE TABLE market_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            instrument_token INTEGER NOT NULL,
            trading_symbol TEXT NOT NULL,
            timestamp DATETIME NOT NULL,
            last_price REAL,
            volume INTEGER,
            instrument_type TEXT
        )
    ''')
    conn.execute('DROP TABLE IF EXISTS tick_data')
    conn.execute('''
        CREATE TABLE tick_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            instrument_token INTEGER NOT NULL,
            timestamp DATETIME NOT NULL,
            last_price REAL NOT NULL,
            volume INTEGER
        )
    ''')
    conn.execute('DROP TABLE IF EXISTS tick_data_status')
    conn.execute('''
        CREATE TABLE tick_data_status (
            instrument_token INTEGER PRIMARY KEY,
            status TEXT NOT NULL DEFAULT 'Stopped'
        )
    ''')
    conn.execute('DROP TABLE IF EXISTS simulated_market_data')
    conn.execute('''
        CREATE TABLE simulated_market_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            instrument_token INTEGER NOT NULL,
            timestamp DATETIME NOT NULL,
            last_price REAL NOT NULL
        )
    ''')
    conn.execute('DROP TABLE IF EXISTS five_minute_candles')
    conn.execute('''
        CREATE TABLE five_minute_candles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            instrument_token INTEGER NOT NULL,
            timestamp DATETIME NOT NULL,
            open REAL NOT NULL,
            high REAL NOT NULL,
            low REAL NOT NULL,
            close REAL NOT NULL,
            volume INTEGER NOT NULL,
            ema REAL
        )
    ''')
    conn.execute('DROP TABLE IF EXISTS legacy_kite_accounts')
    conn.execute('''
        CREATE TABLE legacy_kite_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            legacy_user_id TEXT NOT NULL UNIQUE,
            name TEXT,
            email TEXT,
            api_key TEXT,
            api_secret TEXT,
            request_token TEXT,
            access_token TEXT,
            public_token TEXT,
            totp_secret TEXT,
            kite_password TEXT,
            strategy TEXT,
            allowed_exchanges TEXT,
            paper_trade_strategies TEXT,
            nfo_buy_and_sell TEXT,
            account_status TEXT,
            metadata_json TEXT,
            imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.execute('DROP TABLE IF EXISTS legacy_kite_access_audit')
    conn.execute('''
        CREATE TABLE legacy_kite_access_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_user_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            legacy_account_id INTEGER,
            legacy_user_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

if __name__ == '__main__':
    create_tables()
