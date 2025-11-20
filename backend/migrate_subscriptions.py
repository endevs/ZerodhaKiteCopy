"""
Migration script to create subscriptions and payments tables for tracking user subscriptions and transactions.
"""
import sqlite3
import logging
import os

# Use the same database path as the main application
# Try to import config to get the database path, fallback to default
try:
    import config
    DATABASE_PATH = config.DATABASE_PATH
except ImportError:
    DATABASE_PATH = os.getenv('DATABASE_PATH', 'database.db')
    # If relative path, make it relative to the script's directory
    if not os.path.isabs(DATABASE_PATH):
        script_dir = os.path.dirname(os.path.abspath(__file__))
        DATABASE_PATH = os.path.join(script_dir, DATABASE_PATH)

print(f"Using database path: {DATABASE_PATH}")

def migrate():
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()

    try:
        # Create subscriptions table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                plan_type TEXT NOT NULL CHECK(plan_type IN ('freemium', 'premium', 'super_premium')),
                status TEXT NOT NULL CHECK(status IN ('active', 'trial', 'expired', 'cancelled', 'suspended')),
                start_date DATETIME NOT NULL,
                end_date DATETIME,
                trial_end_date DATETIME,
                auto_renew BOOLEAN NOT NULL DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)
        
        # Create payments table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                subscription_id INTEGER,
                razorpay_order_id TEXT UNIQUE,
                razorpay_payment_id TEXT UNIQUE,
                razorpay_signature TEXT,
                amount REAL NOT NULL,
                currency TEXT NOT NULL DEFAULT 'INR',
                plan_type TEXT NOT NULL CHECK(plan_type IN ('freemium', 'premium', 'super_premium', 'customization')),
                payment_status TEXT NOT NULL CHECK(payment_status IN ('pending', 'completed', 'failed', 'refunded', 'cancelled')),
                payment_method TEXT,
                transaction_date DATETIME,
                failure_reason TEXT,
                metadata TEXT, -- JSON string for additional data
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
            )
        """)
        
        # Create payment_history table for audit trail
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS payment_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payment_id INTEGER NOT NULL,
                status TEXT NOT NULL,
                status_message TEXT,
                razorpay_response TEXT, -- JSON string of Razorpay response
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (payment_id) REFERENCES payments(id)
            )
        """)
        
        # Create indexes for better query performance
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id 
            ON subscriptions(user_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_subscriptions_status 
            ON subscriptions(status)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_payments_user_id 
            ON payments(user_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_payments_subscription_id 
            ON payments(subscription_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_payments_razorpay_order_id 
            ON payments(razorpay_order_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_payments_status 
            ON payments(payment_status)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_payment_history_payment_id 
            ON payment_history(payment_id)
        """)
        
        # Add subscription columns to users table if they don't exist
        try:
            cursor.execute("ALTER TABLE users ADD COLUMN current_subscription_id INTEGER")
            cursor.execute("ALTER TABLE users ADD COLUMN subscription_trial_ends_at DATETIME")
        except sqlite3.OperationalError:
            # Column already exists, ignore
            pass
        
        conn.commit()
        logging.info("Migration completed: subscriptions and payments tables created successfully")
        print("SUCCESS: Subscriptions and payments tables created successfully")
    except Exception as e:
        logging.error(f"Error during migration: {e}", exc_info=True)
        conn.rollback()
        print(f"ERROR: Error during migration: {e}")
    finally:
        conn.close()

if __name__ == '__main__':
    migrate()

