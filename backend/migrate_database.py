"""
Database migration script to add new columns to strategies table
Run this script once to update existing databases
"""
import sqlite3
import config
import logging

def migrate_strategies_table():
    """Add new columns to strategies table if they don't exist"""
    conn = sqlite3.connect(config.DATABASE_PATH)
    cursor = conn.cursor()
    
    try:
        # Check if columns exist by trying to select them
        cursor.execute("PRAGMA table_info(strategies)")
        columns = [row[1] for row in cursor.fetchall()]
        
        # Add indicators column if it doesn't exist
        if 'indicators' not in columns:
            logging.info("Adding 'indicators' column to strategies table")
            cursor.execute("ALTER TABLE strategies ADD COLUMN indicators TEXT")
        
        # Add entry_rules column if it doesn't exist
        if 'entry_rules' not in columns:
            logging.info("Adding 'entry_rules' column to strategies table")
            cursor.execute("ALTER TABLE strategies ADD COLUMN entry_rules TEXT")
        
        # Add exit_rules column if it doesn't exist
        if 'exit_rules' not in columns:
            logging.info("Adding 'exit_rules' column to strategies table")
            cursor.execute("ALTER TABLE strategies ADD COLUMN exit_rules TEXT")
        
        # Add visibility column if it doesn't exist
        if 'visibility' not in columns:
            logging.info("Adding 'visibility' column to strategies table")
            cursor.execute("ALTER TABLE strategies ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'")
            cursor.execute("UPDATE strategies SET visibility = 'private' WHERE visibility IS NULL")
        
        # Add blueprint column if it doesn't exist
        if 'blueprint' not in columns:
            logging.info("Adding 'blueprint' column to strategies table")
            cursor.execute("ALTER TABLE strategies ADD COLUMN blueprint TEXT")
        
        # Add created_at column if it doesn't exist
        if 'created_at' not in columns:
            logging.info("Adding 'created_at' column to strategies table")
            cursor.execute("ALTER TABLE strategies ADD COLUMN created_at DATETIME")
            # Update existing rows with current timestamp
            cursor.execute("UPDATE strategies SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL")
        
        # Add updated_at column if it doesn't exist
        if 'updated_at' not in columns:
            logging.info("Adding 'updated_at' column to strategies table")
            cursor.execute("ALTER TABLE strategies ADD COLUMN updated_at DATETIME")
            # Update existing rows with current timestamp
            cursor.execute("UPDATE strategies SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL")
        
        conn.commit()
        logging.info("Database migration completed successfully")
        print("SUCCESS: Database migration completed successfully!")
        print("   Added columns: indicators, entry_rules, exit_rules, visibility, blueprint, created_at, updated_at")
        
    except Exception as e:
        conn.rollback()
        logging.error(f"Error during database migration: {e}")
        print(f"ERROR: Error during migration: {e}")
        raise
    finally:
        conn.close()

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    migrate_strategies_table()

