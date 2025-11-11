
import sqlite3
import config

def get_db_connection():
    conn = sqlite3.connect(config.DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn

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
            otp_expiry DATETIME
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
    conn.commit()
    conn.close()

if __name__ == '__main__':
    create_tables()
