"""
Migration script to create plan_prices table for admin-configurable plan pricing.
"""
import sqlite3
import os
import config
import logging

def migrate_plan_prices():
    """Create plan_prices table if it doesn't exist and initialize with default prices."""
    db_path = getattr(config, 'DATABASE_PATH', None)
    if not db_path:
        db_path = os.getenv('DATABASE_PATH', 'database.db')
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        cursor.execute("PRAGMA journal_mode=WAL")
        
        # Create plan_prices table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS plan_prices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plan_type TEXT UNIQUE NOT NULL,
                price REAL NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_by INTEGER,
                FOREIGN KEY (updated_by) REFERENCES users(id)
            )
        """)
        
        # Check if table already has data
        cursor.execute("SELECT COUNT(*) FROM plan_prices")
        count = cursor.fetchone()[0]
        
        if count == 0:
            # Initialize with default prices
            default_prices = [
                ('premium', 1499.0),
                ('super_premium', 3499.0),
                ('customization', 4899.0)
            ]
            
            cursor.executemany(
                "INSERT INTO plan_prices (plan_type, price) VALUES (?, ?)",
                default_prices
            )
            logging.info("Initialized plan_prices table with default prices.")
        else:
            logging.info("plan_prices table already has data, skipping initialization.")
        
        conn.commit()
        logging.info("plan_prices table migration completed successfully.")
        
    except Exception as e:
        logging.error(f"Error during plan_prices migration: {e}", exc_info=True)
        conn.rollback()
    finally:
        conn.close()

if __name__ == '__main__':
    migrate_plan_prices()



