"""Quick script to check if subscription tables exist"""
import sqlite3
import config

try:
    conn = sqlite3.connect(config.DATABASE_PATH)
    cursor = conn.cursor()
    
    # Check for tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('payments', 'subscriptions', 'payment_history')")
    tables = [row[0] for row in cursor.fetchall()]
    
    print(f"Database path: {config.DATABASE_PATH}")
    print(f"Tables found: {tables}")
    
    if 'payments' in tables:
        cursor.execute("SELECT COUNT(*) FROM payments")
        count = cursor.fetchone()[0]
        print(f"Payments table has {count} records")
    else:
        print("ERROR: payments table does not exist!")
    
    if 'subscriptions' in tables:
        cursor.execute("SELECT COUNT(*) FROM subscriptions")
        count = cursor.fetchone()[0]
        print(f"Subscriptions table has {count} records")
    else:
        print("ERROR: subscriptions table does not exist!")
    
    if 'payment_history' in tables:
        cursor.execute("SELECT COUNT(*) FROM payment_history")
        count = cursor.fetchone()[0]
        print(f"Payment_history table has {count} records")
    else:
        print("ERROR: payment_history table does not exist!")
    
    conn.close()
except Exception as e:
    print(f"Error: {e}")



