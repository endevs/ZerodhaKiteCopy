"""
Simple data fetcher for 15-minute Bank Nifty data
"""
import logging
import pandas as pd
import datetime
import time
from typing import Optional
from kiteconnect import KiteConnect
import sys
import os

# CRITICAL: Add parent directory to path BEFORE importing database
# This ensures database.py imports backend/config.py, not simple_ORB_trading/config.py
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Remove current directory from path temporarily to avoid config conflicts
_current_dir = os.path.dirname(os.path.abspath(__file__))
if _current_dir in sys.path:
    sys.path.remove(_current_dir)
# Add parent directory first
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

# CRITICAL: Import config from parent directory explicitly
# Use importlib to ensure we get backend/config.py, not local config.py
import importlib.util
_config_path = os.path.join(parent_dir, 'config.py')
_spec = importlib.util.spec_from_file_location("backend_config", _config_path)
backend_config = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(backend_config)

# CRITICAL: Set DATABASE_PATH to absolute path before importing database
# This ensures we use backend/database.db, not a relative path from current working directory
# Force absolute path to D:\WorkSpace\ZerodhaKiteGit\backend\database.db
database_path = os.path.join(parent_dir, 'database.db')
backend_config.DATABASE_PATH = database_path

# Set the config module in sys.modules so database.py can import it
sys.modules['config'] = backend_config

# Now import database (which will use backend/config.py with correct DATABASE_PATH)
from database import get_db_connection
# Re-add current directory for other local imports
if _current_dir not in sys.path:
    sys.path.insert(1, _current_dir)

logger = logging.getLogger(__name__)

# Log the database path after logger is initialized
logger.info(f"Using database: {backend_config.DATABASE_PATH}")


def get_kite_client(user_email: Optional[str] = None) -> KiteConnect:
    """Get KiteConnect client from database."""
    conn = get_db_connection()
    try:
        if user_email:
            cursor = conn.execute(
                'SELECT app_key, app_secret, zerodha_access_token FROM users WHERE email = ? LIMIT 1',
                (user_email,)
            )
        else:
            cursor = conn.execute(
                'SELECT app_key, app_secret, zerodha_access_token FROM users LIMIT 1'
            )
        
        user = cursor.fetchone()
        if not user or not user[0] or not user[1] or not user[2]:
            raise ValueError("Zerodha credentials not found in database")
        
        kite = KiteConnect(api_key=user[0], access_token=user[2])
        profile = kite.profile()
        logger.info(f"✓ Connected to Zerodha as: {profile.get('user_name', 'Unknown')}")
        return kite
    finally:
        conn.close()


def fetch_15min_data(kite: KiteConnect, from_date: datetime.date, to_date: datetime.date) -> pd.DataFrame:
    """
    Fetch 15-minute Bank Nifty data.
    
    Args:
        kite: KiteConnect client
        from_date: Start date
        to_date: End date
    
    Returns:
        DataFrame with columns: timestamp, open, high, low, close, volume
    """
    logger.info(f"Fetching 15-minute Bank Nifty data from {from_date} to {to_date}...")
    
    # Use Bank Nifty Index directly (token 260105)
    instrument_token = 260105  # Bank Nifty Index
    logger.info("Using instrument: Bank Nifty Index (260105)")
    
    # Fetch data in chunks (Zerodha limit: 2000 candles)
    all_data = []
    current_date = from_date
    
    while current_date <= to_date:
        chunk_end = min(current_date + datetime.timedelta(days=60), to_date)
        
        try:
            data = kite.historical_data(
                instrument_token=instrument_token,
                from_date=current_date,
                to_date=chunk_end,
                interval='15minute'
            )
            
            if data:
                all_data.extend(data)
                logger.info(f"✓ Fetched {len(data)} candles ({current_date} to {chunk_end})")
            
            current_date = chunk_end + datetime.timedelta(days=1)
            time.sleep(0.2)  # Rate limiting
            
        except Exception as e:
            logger.error(f"Error fetching data: {e}")
            break
    
    if not all_data:
        raise ValueError("No data fetched")
    
    # Convert to DataFrame
    df = pd.DataFrame(all_data)
    df['timestamp'] = pd.to_datetime(df['date'])
    df = df.sort_values('timestamp').reset_index(drop=True)
    
    logger.info(f"✓ Total candles fetched: {len(df)}")
    logger.info(f"  Date range: {df['timestamp'].min()} to {df['timestamp'].max()}")
    
    return df[['timestamp', 'open', 'high', 'low', 'close', 'volume']]

