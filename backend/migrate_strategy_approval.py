"""
Migration script to add approval fields to strategies table
"""
import sqlite3
import config
import logging

def migrate_strategy_approval():
    """Add approval fields to strategies table and set existing strategies to approved"""
    try:
        conn = sqlite3.connect(config.DATABASE_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Check if approval_status column exists
        cursor.execute("PRAGMA table_info(strategies)")
        columns = [column[1] for column in cursor.fetchall()]
        
        if 'approval_status' not in columns:
            logging.info("Adding approval fields to strategies table...")
            
            # Add approval_status column
            cursor.execute("ALTER TABLE strategies ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved'")
            
            # Add submitted_for_approval_at column
            cursor.execute("ALTER TABLE strategies ADD COLUMN submitted_for_approval_at DATETIME")
            
            # Add approved_at column
            cursor.execute("ALTER TABLE strategies ADD COLUMN approved_at DATETIME")
            
            # Add approved_by column
            cursor.execute("ALTER TABLE strategies ADD COLUMN approved_by INTEGER")
            
            # Add rejected_at column
            cursor.execute("ALTER TABLE strategies ADD COLUMN rejected_at DATETIME")
            
            # Add rejected_by column
            cursor.execute("ALTER TABLE strategies ADD COLUMN rejected_by INTEGER")
            
            # Add rejection_reason column
            cursor.execute("ALTER TABLE strategies ADD COLUMN rejection_reason TEXT")
            
            # Set all existing strategies to approved (backward compatibility)
            cursor.execute("UPDATE strategies SET approval_status = 'approved' WHERE approval_status IS NULL OR approval_status = ''")
            
            conn.commit()
            logging.info("Approval fields added successfully. All existing strategies set to 'approved'.")
        else:
            logging.info("Approval fields already exist")
        
        conn.close()
        logging.info("Strategy approval migration completed successfully")
    except Exception as e:
        logging.error(f"Error in strategy approval migration: {e}")
        raise

if __name__ == '__main__':
    migrate_strategy_approval()




