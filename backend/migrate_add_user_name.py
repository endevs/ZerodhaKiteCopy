"""
Database migration script to add user_name column to users table
Run this script once to add the user_name column for storing Zerodha Kite user names
"""
import sqlite3
import config
import logging

def migrate_add_user_name():
    """Add user_name column to users table if it doesn't exist"""
    conn = sqlite3.connect(config.DATABASE_PATH)
    cursor = conn.cursor()
    
    try:
        # Check if column exists
        cursor.execute("PRAGMA table_info(users)")
        columns = [column[1] for column in cursor.fetchall()]
        
        if 'user_name' not in columns:
            logging.info("Adding 'user_name' column to 'users' table")
            cursor.execute("""
                ALTER TABLE users 
                ADD COLUMN user_name TEXT
            """)
            conn.commit()
            logging.info("Successfully added 'user_name' column to 'users' table")
        else:
            logging.info("'user_name' column already exists in 'users' table")
        
    except Exception as e:
        logging.error(f"Error adding user_name column: {e}", exc_info=True)
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    migrate_add_user_name()






