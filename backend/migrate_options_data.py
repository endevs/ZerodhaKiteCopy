"""
Database migration script for Options Trading Analysis feature
Creates tables for storing index and option contract data
Run this script once to create the required tables
"""
import sqlite3
import config
import logging
from datetime import datetime

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def migrate_options_tables():
    """Create tables for options data storage"""
    conn = sqlite3.connect(config.DATABASE_PATH)
    cursor = conn.cursor()
    
    try:
        # Table 1: index_daily_data - Stores daily OHLC for indices
        logger.info("Creating 'index_daily_data' table...")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS index_daily_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                index_name TEXT NOT NULL,
                date DATE NOT NULL,
                open REAL NOT NULL,
                high REAL NOT NULL,
                low REAL NOT NULL,
                close REAL NOT NULL,
                volume INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(index_name, date)
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_index_daily_data_index_date 
            ON index_daily_data(index_name, date)
        """)
        logger.info("✓ Created 'index_daily_data' table")
        
        # Table 2: option_contracts - Stores option contract metadata
        logger.info("Creating 'option_contracts' table...")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS option_contracts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                index_name TEXT NOT NULL,
                date DATE NOT NULL,
                instrument_token INTEGER NOT NULL,
                tradingsymbol TEXT NOT NULL,
                strike REAL NOT NULL,
                expiry_date DATE NOT NULL,
                instrument_type TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(instrument_token, date)
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_option_contracts_index_date 
            ON option_contracts(index_name, date)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_option_contracts_expiry 
            ON option_contracts(expiry_date)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_option_contracts_token 
            ON option_contracts(instrument_token)
        """)
        logger.info("✓ Created 'option_contracts' table")
        
        # Table 3: option_candles_5min - Stores 5-minute candle data for options
        logger.info("Creating 'option_candles_5min' table...")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS option_candles_5min (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                instrument_token INTEGER NOT NULL,
                tradingsymbol TEXT NOT NULL,
                timestamp DATETIME NOT NULL,
                open REAL NOT NULL,
                high REAL NOT NULL,
                low REAL NOT NULL,
                close REAL NOT NULL,
                volume INTEGER,
                date DATE NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(instrument_token, timestamp)
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_option_candles_token_date 
            ON option_candles_5min(instrument_token, date)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_option_candles_timestamp 
            ON option_candles_5min(timestamp)
        """)
        logger.info("✓ Created 'option_candles_5min' table")
        
        # Table 4: index_candles_5min - Stores 5-minute candle data for indices
        logger.info("Creating 'index_candles_5min' table...")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS index_candles_5min (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                index_name TEXT NOT NULL,
                timestamp DATETIME NOT NULL,
                open REAL NOT NULL,
                high REAL NOT NULL,
                low REAL NOT NULL,
                close REAL NOT NULL,
                volume INTEGER,
                date DATE NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(index_name, timestamp)
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_index_candles_name_date 
            ON index_candles_5min(index_name, date)
        """)
        logger.info("✓ Created 'index_candles_5min' table")
        
        conn.commit()
        logger.info("\n" + "="*60)
        logger.info("✓ All options tables created successfully!")
        logger.info("="*60)
        
    except Exception as e:
        logger.error(f"✗ Error creating tables: {e}", exc_info=True)
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == '__main__':
    logger.info("="*60)
    logger.info("Options Data Migration Script")
    logger.info("="*60)
    migrate_options_tables()
    logger.info("\nMigration complete!")
