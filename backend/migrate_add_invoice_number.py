"""
Migration script to add invoice_number column to payments table.
"""
import sqlite3
import logging
import os

# Use the same database path as the main application
try:
    import config
    DATABASE_PATH = config.DATABASE_PATH
except ImportError:
    DATABASE_PATH = os.getenv('DATABASE_PATH', 'database.db')
    if not os.path.isabs(DATABASE_PATH):
        script_dir = os.path.dirname(os.path.abspath(__file__))
        DATABASE_PATH = os.path.join(script_dir, DATABASE_PATH)

print(f"Using database path: {DATABASE_PATH}")

def migrate():
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()

    try:
        # Add invoice_number column to payments table if it doesn't exist
        try:
            cursor.execute("ALTER TABLE payments ADD COLUMN invoice_number TEXT")
            conn.commit()
            logging.info("Migration completed: invoice_number column added to payments table")
            print("SUCCESS: invoice_number column added to payments table")
        except sqlite3.OperationalError as e:
            if "duplicate column" in str(e).lower():
                logging.info("invoice_number column already exists, skipping migration")
                print("INFO: invoice_number column already exists, skipping migration")
            else:
                raise
    except Exception as e:
        logging.error(f"Error during migration: {e}", exc_info=True)
        conn.rollback()
        print(f"ERROR: Error during migration: {e}")
    finally:
        conn.close()

if __name__ == '__main__':
    migrate()


