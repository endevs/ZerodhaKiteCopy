"""
Subscription management module for handling user subscriptions and feature access.
"""
import datetime
import json
import logging
import time
import random
from typing import Dict, List, Optional, Any
from database import get_db_connection

PLAN_TYPES = {
    'freemium': {
        'name': 'Freemium',
        'price': 0,
        'trial_days': 7,
        'features': {
            'ai_strategy_generation': True,
            'paper_trading': True,
            'backtest_1_month': True,
            'expert_review': True,
            'live_deployment': False,
            'strategy_optimization': False,
            'ai_ml_customization': False,
            'unlimited_backtest': False,
        }
    },
    'premium': {
        'name': 'Premium',
        'price': 1.90,  # Testing price
        'trial_days': 7,
        'features': {
            'ai_strategy_generation': True,
            'paper_trading': True,
            'backtest_1_month': True,
            'expert_review': True,
            'live_deployment': True,
            'strategy_optimization': True,
            'ai_ml_customization': False,
            'unlimited_backtest': True,
        }
    },
    'super_premium': {
        'name': 'Super Premium',
        'price': 1.90,  # Testing price
        'trial_days': 7,
        'features': {
            'ai_strategy_generation': True,
            'paper_trading': True,
            'backtest_1_month': True,
            'expert_review': True,
            'live_deployment': True,
            'strategy_optimization': True,
            'ai_ml_customization': True,
            'unlimited_backtest': True,
        }
    }
}

CUSTOMIZATION_PRICE = 1.90  # Testing price


def get_user_subscription(user_id: int) -> Optional[Dict[str, Any]]:
    """Get the current active subscription for a user."""
    conn = get_db_connection()
    try:
        row = conn.execute(
            """
            SELECT * FROM subscriptions 
            WHERE user_id = ? AND status IN ('active', 'trial')
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (user_id,)
        ).fetchone()
        
        if row:
            subscription = dict(row)
            # Parse dates
            if subscription.get('start_date'):
                subscription['start_date'] = datetime.datetime.fromisoformat(subscription['start_date'])
            if subscription.get('end_date'):
                subscription['end_date'] = datetime.datetime.fromisoformat(subscription['end_date'])
            if subscription.get('trial_end_date'):
                subscription['trial_end_date'] = datetime.datetime.fromisoformat(subscription['trial_end_date'])
            return subscription
        return None
    finally:
        conn.close()


def create_subscription(
    user_id: int,
    plan_type: str,
    start_date: Optional[datetime.datetime] = None,
    trial_days: int = 7
) -> Dict[str, Any]:
    """Create a new subscription for a user with retry logic for database locks."""
    if plan_type not in PLAN_TYPES:
        raise ValueError(f"Invalid plan type: {plan_type}")
    
    if start_date is None:
        start_date = datetime.datetime.now(datetime.timezone.utc)
    
    plan_info = PLAN_TYPES[plan_type]
    
    # Only Freemium plans get trial status and trial_end_date
    # Paid plans (Premium, Super Premium) are immediately 'active' with no trial
    if plan_type == 'freemium':
        # Freemium: trial status with 7-day trial period
        subscription_status = 'trial' if trial_days > 0 else 'active'
        trial_end_date = start_date + datetime.timedelta(days=trial_days) if trial_days > 0 else None
        end_date = None  # Free forever after trial
    else:
        # Paid plans: immediately active, no trial period
        subscription_status = 'active'
        trial_end_date = None  # No trial for paid plans
        end_date = start_date + datetime.timedelta(days=30)  # 30-day subscription period
    
    # Retry logic for database locks
    max_retries = 5
    retry_delay = 0.2  # Start with 200ms
    import random
    
    for attempt in range(max_retries):
        conn = None
        try:
            # Add small random delay before retrying to avoid thundering herd
            if attempt > 0:
                jitter = random.uniform(0, 0.1)  # Random 0-100ms jitter
                time.sleep(retry_delay * (2 ** (attempt - 1)) + jitter)
            
            # Use longer timeout for subscription creation
            conn = get_db_connection(timeout=60.0, retries=3)
            
            # Try to start transaction immediately (may fail if DB is locked)
            try:
                conn.execute('BEGIN IMMEDIATE')
            except Exception as begin_error:
                error_str = str(begin_error).lower()
                if 'locked' in error_str:
                    # Close connection and retry
                    conn.close()
                    conn = None
                    raise begin_error
                raise
            
            try:
                # Cancel any existing active subscriptions
                conn.execute(
                    """
                    UPDATE subscriptions 
                    SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = ? AND status IN ('active', 'trial')
                    """,
                    (user_id,)
                )
                
                # Create new subscription
                cursor = conn.execute(
                    """
                    INSERT INTO subscriptions (
                        user_id, plan_type, status, start_date, end_date, trial_end_date, auto_renew
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        user_id,
                        plan_type,
                        subscription_status,
                        start_date.isoformat(),
                        end_date.isoformat() if end_date else None,
                        trial_end_date.isoformat() if trial_end_date else None,
                        1 if plan_type != 'freemium' else 0
                    )
                )
                subscription_id = cursor.lastrowid
                
                # Update user's current subscription
                conn.execute(
                    """
                    UPDATE users 
                    SET current_subscription_id = ?, subscription_trial_ends_at = ?
                    WHERE id = ?
                    """,
                    (
                        subscription_id,
                        trial_end_date.isoformat() if trial_end_date else None,
                        user_id
                    )
                )
                
                conn.commit()
                
                # Get the created subscription (separate query after commit to avoid lock)
                row = conn.execute(
                    "SELECT * FROM subscriptions WHERE id = ?",
                    (subscription_id,)
                ).fetchone()
                
                subscription = dict(row)
                if subscription.get('start_date'):
                    subscription['start_date'] = datetime.datetime.fromisoformat(subscription['start_date'])
                if subscription.get('end_date'):
                    subscription['end_date'] = datetime.datetime.fromisoformat(subscription['end_date'])
                if subscription.get('trial_end_date'):
                    subscription['trial_end_date'] = datetime.datetime.fromisoformat(subscription['trial_end_date'])
                
                return subscription
            except Exception as inner_e:
                conn.rollback()
                raise inner_e
            
        except Exception as e:
            if conn:
                try:
                    conn.rollback()
                except:
                    pass
                finally:
                    conn.close()
            
            # Check if it's a database lock error
            error_str = str(e).lower()
            is_lock_error = 'locked' in error_str or 'database is locked' in error_str
            
            if is_lock_error and attempt < max_retries - 1:
                # Exponential backoff with jitter: 0.2s, 0.4s, 0.8s, 1.6s, 3.2s
                base_wait = retry_delay * (2 ** attempt)
                jitter = random.uniform(0, base_wait * 0.2)  # 20% jitter
                wait_time = base_wait + jitter
                logging.warning(f"Database locked during subscription creation (attempt {attempt + 1}/{max_retries}), retrying in {wait_time:.2f}s")
                time.sleep(wait_time)
                continue
            else:
                logging.error(f"Error creating subscription after {max_retries} attempts: {e}", exc_info=True)
                # If it's still locked after all retries, raise a more descriptive error
                if is_lock_error:
                    raise Exception(f"Database is busy. Please try again in a few moments. (Original error: {str(e)})")
                raise


def activate_subscription(subscription_id: int) -> bool:
    """Activate a subscription (move from trial to active)."""
    conn = get_db_connection()
    try:
        conn.execute(
            """
            UPDATE subscriptions 
            SET status = 'active', updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'trial'
            """,
            (subscription_id,)
        )
        conn.commit()
        return conn.rowcount > 0
    except Exception as e:
        conn.rollback()
        logging.error(f"Error activating subscription: {e}", exc_info=True)
        return False
    finally:
        conn.close()


def check_feature_access(user_id: int, feature: str) -> bool:
    """Check if a user has access to a specific feature based on their subscription."""
    subscription = get_user_subscription(user_id)
    
    if not subscription:
        # No subscription, check if feature is available in freemium
        return PLAN_TYPES['freemium']['features'].get(feature, False)
    
    plan_type = subscription['plan_type']
    if plan_type not in PLAN_TYPES:
        return False
    
    # Check if subscription is still valid
    now = datetime.datetime.now(datetime.timezone.utc)
    if subscription.get('end_date') and subscription['end_date'] < now:
        # Subscription expired, check freemium features
        return PLAN_TYPES['freemium']['features'].get(feature, False)
    
    # Check trial period
    if subscription.get('trial_end_date') and subscription['trial_end_date'] < now:
        # Trial expired, activate subscription if it's a paid plan
        if subscription['status'] == 'trial' and plan_type != 'freemium':
            activate_subscription(subscription['id'])
    
    # Return feature access based on plan
    return PLAN_TYPES[plan_type]['features'].get(feature, False)


def get_user_subscription_info(user_id: int) -> Dict[str, Any]:
    """Get comprehensive subscription information for a user."""
    subscription = get_user_subscription(user_id)
    
    if not subscription:
        return {
            'has_subscription': False,
            'plan_type': 'freemium',
            'plan_name': 'Freemium',
            'status': 'none',
            'features': PLAN_TYPES['freemium']['features'],
            'trial_days_remaining': 0,
            'days_remaining': None
        }
    
    plan_type = subscription['plan_type']
    plan_info = PLAN_TYPES[plan_type]
    now = datetime.datetime.now(datetime.timezone.utc)
    
    trial_days_remaining = 0
    if subscription.get('trial_end_date'):
        trial_end = subscription['trial_end_date']
        if trial_end > now:
            trial_days_remaining = (trial_end - now).days
    
    days_remaining = None
    if subscription.get('end_date'):
        end_date = subscription['end_date']
        if end_date > now:
            days_remaining = (end_date - now).days
    
    return {
        'has_subscription': True,
        'subscription_id': subscription['id'],
        'plan_type': plan_type,
        'plan_name': plan_info['name'],
        'status': subscription['status'],
        'features': plan_info['features'],
        'trial_days_remaining': trial_days_remaining,
        'days_remaining': days_remaining,
        'start_date': subscription.get('start_date'),
        'end_date': subscription.get('end_date'),
        'trial_end_date': subscription.get('trial_end_date'),
        'auto_renew': subscription.get('auto_renew', False)
    }

