"""
Migration script to set all existing users without subscriptions to freemium.
This ensures all users have at least a freemium subscription.
"""
import logging
import os
import sys

# Add parent directory to path to import modules
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import config
    DATABASE_PATH = config.DATABASE_PATH
except ImportError:
    DATABASE_PATH = os.getenv('DATABASE_PATH', 'database.db')
    if not os.path.isabs(DATABASE_PATH):
        script_dir = os.path.dirname(os.path.abspath(__file__))
        DATABASE_PATH = os.path.join(script_dir, DATABASE_PATH)

from database import get_db_connection
from subscription_manager import get_user_subscription, create_subscription

def migrate_users_to_freemium():
    """Set all users without subscriptions to freemium."""
    conn = get_db_connection()
    try:
        # Get all users
        users = conn.execute('SELECT id, email FROM users').fetchall()
        migrated_count = 0
        skipped_count = 0
        error_count = 0
        
        for user in users:
            user_id = user['id']
            email = user['email']
            
            try:
                # Check if user already has a subscription
                existing_subscription = get_user_subscription(user_id)
                
                if not existing_subscription:
                    # Create freemium subscription
                    create_subscription(user_id, 'freemium', trial_days=7)
                    migrated_count += 1
                    logging.info(f"Created freemium subscription for user {user_id} ({email})")
                else:
                    skipped_count += 1
                    logging.debug(f"User {user_id} ({email}) already has subscription: {existing_subscription.get('plan_type')}")
            except Exception as e:
                error_count += 1
                logging.error(f"Error migrating user {user_id} ({email}): {e}", exc_info=True)
        
        logging.info(f"Migration completed: {migrated_count} users migrated, {skipped_count} skipped, {error_count} errors")
        print(f"SUCCESS: Migration completed - {migrated_count} users migrated to freemium, {skipped_count} already had subscriptions, {error_count} errors")
        
    except Exception as e:
        logging.error(f"Error during migration: {e}", exc_info=True)
        print(f"ERROR: Error during migration: {e}")
    finally:
        conn.close()

if __name__ == '__main__':
    migrate_users_to_freemium()



