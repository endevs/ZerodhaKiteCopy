"""
Migration script to add admin field to users table and initialize admin user
"""
import sqlite3
import config
import logging

def migrate_admin_field():
    """Add is_admin field to users table and set raj.bapa@gmail.com as admin"""
    try:
        conn = sqlite3.connect(config.DATABASE_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Check if is_admin column exists
        cursor.execute("PRAGMA table_info(users)")
        columns = [column[1] for column in cursor.fetchall()]
        
        if 'is_admin' not in columns:
            logging.info("Adding is_admin column to users table...")
            cursor.execute("ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT 0")
            conn.commit()
            logging.info("is_admin column added successfully")
        else:
            logging.info("is_admin column already exists")
        
        # Set raj.bapa@gmail.com as admin
        cursor.execute("SELECT id, email, is_admin FROM users WHERE email = ?", ('raj.bapa@gmail.com',))
        user = cursor.fetchone()
        
        if user:
            if not user['is_admin']:
                cursor.execute("UPDATE users SET is_admin = 1 WHERE email = ?", ('raj.bapa@gmail.com',))
                conn.commit()
                logging.info(f"Set {user['email']} as admin")
            else:
                logging.info(f"{user['email']} is already an admin")
        else:
            logging.warning("raj.bapa@gmail.com not found in users table")
        
        conn.close()
        logging.info("Admin migration completed successfully")
    except Exception as e:
        logging.error(f"Error in admin migration: {e}")
        raise

if __name__ == '__main__':
    migrate_admin_field()







