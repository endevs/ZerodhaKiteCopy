"""
Zerodha data fetcher for Bank Nifty 5-minute OHLC data
"""
import logging
import time
import datetime
import pandas as pd
from typing import List, Dict, Optional, Tuple
from kiteconnect import KiteConnect
from kiteconnect import exceptions as kite_exceptions
import sys
import os
import sqlite3

# CRITICAL: Add parent directory to path BEFORE importing database
# This ensures database.py imports backend/config.py, not nifty50_rl/config.py
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Remove current directory from path temporarily to avoid config conflicts
_current_dir = os.path.dirname(os.path.abspath(__file__))
if _current_dir in sys.path:
    sys.path.remove(_current_dir)
# Add parent directory first
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

# CRITICAL: Set DATABASE_PATH to absolute path before importing database
# This ensures we use backend/database.db, not a relative path from current working directory
import config as backend_config
if not os.path.isabs(backend_config.DATABASE_PATH):
    # Convert relative path to absolute path relative to backend directory
    backend_config.DATABASE_PATH = os.path.join(parent_dir, backend_config.DATABASE_PATH)

# Now import database (which will use backend/config.py with correct DATABASE_PATH)
from database import get_db_connection
# Re-add current directory for other local imports
if _current_dir not in sys.path:
    sys.path.insert(1, _current_dir)

logger = logging.getLogger(__name__)

# Log the database path after logger is initialized
logger.info(f"Using database: {backend_config.DATABASE_PATH}")

# Cache utility functions will be imported lazily to avoid circular imports
CACHE_AVAILABLE = None  # Will be set when first accessed


def get_banknifty_futures_token(kite_client: KiteConnect, target_date: Optional[datetime.date] = None) -> Optional[int]:
    """
    Get Bank Nifty futures instrument token for current month or target date.
    
    Args:
        kite_client: Authenticated KiteConnect client
        target_date: Target date to find appropriate futures contract (default: today)
    
    Returns:
        Instrument token for Bank Nifty futures, or None if not found
    """
    if target_date is None:
        target_date = datetime.date.today()
    
    try:
        # Get all NFO (Futures & Options) instruments
        instruments = kite_client.instruments('NFO')
        logger.info(f"Fetched {len(instruments)} NFO instruments")
        
        # Filter for BANKNIFTY futures (not options)
        banknifty_futures = [
            inst for inst in instruments
            if inst.get('name') == 'BANKNIFTY' and
               inst.get('instrument_type') == 'FUT' and
               inst.get('expiry') is not None
        ]
        
        if not banknifty_futures:
            logger.warning("No BANKNIFTY futures found")
            return None
        
        # Find the current month futures (expiry >= target_date, closest expiry)
        valid_futures = [
            inst for inst in banknifty_futures
            if inst.get('expiry') >= target_date
        ]
        
        if not valid_futures:
            # If no future expiry >= target_date, use the furthest one
            valid_futures = banknifty_futures
        
        # Sort by expiry and get the nearest one
        valid_futures.sort(key=lambda x: x.get('expiry'))
        selected_future = valid_futures[0]
        
        instrument_token = selected_future.get('instrument_token')
        expiry = selected_future.get('expiry')
        trading_symbol = selected_future.get('tradingsymbol', 'N/A')
        
        logger.info(f"Selected BANKNIFTY futures: {trading_symbol} (token: {instrument_token}, expiry: {expiry})")
        
        return instrument_token
        
    except Exception as e:
        logger.error(f"Error finding NIFTY futures: {e}")
        return None


def get_kite_client_from_db(user_id: Optional[int] = None, user_email: Optional[str] = None) -> KiteConnect:
    """
    Get KiteConnect client using credentials from database.
    
    Args:
        user_id: Optional user ID. If None, searches by email or uses first user with credentials.
        user_email: Optional email address. If provided, fetches credentials for this user.
                   Default: 'raj.bapa@gmail.com'
    
    Returns:
        Authenticated KiteConnect client
    
    Raises:
        RuntimeError: If no user with credentials found or database not initialized
    """
    conn = get_db_connection()
    try:
        # Check if users table exists (do NOT create - would drop existing tables)
        try:
            conn.execute('SELECT 1 FROM users LIMIT 1')
        except sqlite3.OperationalError as e:
            if 'no such table' in str(e).lower():
                conn.close()
                raise RuntimeError(
                    "Database tables not found. The 'users' table does not exist.\n"
                    "Please run the main Flask application first to initialize the database:\n"
                    "  python backend/app.py\n\n"
                    "Note: Do NOT use create_tables() as it will DROP existing tables and lose data."
                )
            else:
                raise
        
        # Default to raj.bapa@gmail.com if no email specified
        if user_email is None:
            user_email = 'raj.bapa@gmail.com'
        
        if user_id:
            user_row = conn.execute(
                'SELECT app_key, app_secret, zerodha_access_token, email FROM users WHERE id = ?',
                (user_id,)
            ).fetchone()
        elif user_email:
            # Get user by email
            logger.info(f"Looking for user with email: {user_email}")
            user_row = conn.execute(
                '''SELECT app_key, app_secret, zerodha_access_token, email FROM users 
                   WHERE email = ? AND app_key IS NOT NULL AND app_secret IS NOT NULL 
                   AND zerodha_access_token IS NOT NULL''',
                (user_email,)
            ).fetchone()
            if not user_row:
                logger.warning(f"User {user_email} not found or missing credentials. Trying first available user...")
                # Fallback to first user with credentials
                user_row = conn.execute(
                    '''SELECT app_key, app_secret, zerodha_access_token, email FROM users 
                       WHERE app_key IS NOT NULL AND app_secret IS NOT NULL 
                       AND zerodha_access_token IS NOT NULL
                       LIMIT 1'''
                ).fetchone()
        else:
            # Get first user with credentials
            user_row = conn.execute(
                '''SELECT app_key, app_secret, zerodha_access_token, email FROM users 
                   WHERE app_key IS NOT NULL AND app_secret IS NOT NULL 
                   AND zerodha_access_token IS NOT NULL
                   LIMIT 1'''
            ).fetchone()
        
        if not user_row:
            raise RuntimeError(
                "No user with Zerodha credentials found in database.\n"
                "Please:\n"
                "1. Run the main Flask app: python backend/app.py\n"
                "2. Sign up/Login via the web interface\n"
                "3. Configure Zerodha API keys on the Welcome page\n"
                "4. Then run this RL system again"
            )
        
        user = dict(user_row)
        user_email_found = user.get('email', 'Unknown')
        app_key = user.get('app_key')
        app_secret = user.get('app_secret')
        access_token = user.get('zerodha_access_token')
        
        logger.info(f"✓ Found user: {user_email_found}")
        
        if not app_key or not access_token:
            raise RuntimeError(
                f"Zerodha credentials incomplete for user {user_email_found}.\n"
                "Please configure API keys and authenticate.\n"
                "Steps:\n"
                "1. Login to the web interface\n"
                "2. Go to Welcome/Profile page\n"
                "3. Enter your Zerodha API Key and Secret\n"
                "4. Authenticate with Zerodha"
            )
        
        # Create and authenticate KiteConnect client
        kite = KiteConnect(api_key=app_key)
        kite.set_access_token(access_token)
        
        # Validate connection
        try:
            profile = kite.profile()
            logger.info(f"✓ Connected to Zerodha as: {profile.get('user_name', 'User')} ({user_email_found})")
        except Exception as e:
            raise RuntimeError(f"Failed to authenticate with Zerodha: {e}")
        
        return kite
    finally:
        conn.close()


def fetch_banknifty_data(
    kite_client: KiteConnect,
    start_date: datetime.date,
    end_date: datetime.date,
    instrument_token: Optional[int] = None,
    use_futures: bool = True,
    use_cache: bool = True
) -> pd.DataFrame:
    """
    Fetch Bank Nifty 5-minute OHLC data from Zerodha with caching support.
    Uses futures for recent data (with volume) and index for historical data (older than 3 months).
    
    Args:
        kite_client: Authenticated KiteConnect client
        start_date: Start date for data fetch
        end_date: End date for data fetch
        instrument_token: Optional instrument token (ignored if using cache)
        use_futures: If True, use futures for volume data when available
        use_cache: If True, check cache first, then fetch missing data
    
    Returns:
        DataFrame with columns: timestamp, open, high, low, close, volume
    
    Raises:
        RuntimeError: If data fetch fails
    """
    # Try to use cache if available and using futures
    if use_cache and use_futures:
        # Lazy import to avoid circular dependency
        global CACHE_AVAILABLE
        if CACHE_AVAILABLE is None:
            try:
                from data_fetcher_utility import combine_cached_data, fetch_and_cache_months
                CACHE_AVAILABLE = True
            except ImportError:
                CACHE_AVAILABLE = False
                logger.warning("Cache utility not available, will use direct fetch only")
        
        if CACHE_AVAILABLE:
            try:
                from data_fetcher_utility import combine_cached_data, fetch_and_cache_months
                logger.info("Checking cached data...")
                cached_df = combine_cached_data(start_date, end_date)
                
                if cached_df is not None and len(cached_df) > 0:
                    # Check if cached data covers the full range
                    cached_start = cached_df['timestamp'].min().date()
                    cached_end = cached_df['timestamp'].max().date()
                    
                    if cached_start <= start_date and cached_end >= end_date:
                        logger.info(f"✓ Using cached data: {len(cached_df):,} candles")
                        logger.info(f"  Date range: {cached_start} to {cached_end}")
                        
                        # Filter to exact date range
                        result = cached_df[
                            (cached_df['timestamp'].dt.date >= start_date) &
                            (cached_df['timestamp'].dt.date <= end_date)
                        ].copy()
                        
                        _validate_data(result)
                        return result
                    else:
                        logger.info(f"Cached data covers {cached_start} to {cached_end}, "
                                   f"need {start_date} to {end_date}")
                        logger.info("Fetching missing data and updating cache...")
                
                # Fetch missing months and cache them
                logger.info("Fetching and caching data...")
                fetch_and_cache_months(kite_client, start_date, end_date, force_refresh=False)
                
                # Load combined cached data
                combined_df = combine_cached_data(start_date, end_date)
                if combined_df is not None and len(combined_df) > 0:
                    _validate_data(combined_df)
                    return combined_df
                else:
                    logger.warning("Cache fetch incomplete, falling back to direct fetch...")
            except Exception as e:
                logger.warning(f"Cache operation failed: {e}, falling back to direct fetch...")
    
    # Fallback to direct fetch (original logic)
    logger.info("Fetching data directly from Zerodha...")
    
    # Auto-detect futures if needed
    if instrument_token is None:
        if use_futures:
            logger.info("Auto-detecting BANKNIFTY futures contract for volume data...")
            instrument_token = get_banknifty_futures_token(kite_client, start_date)
            if instrument_token is None:
                logger.warning("Could not find futures, falling back to index (no volume)")
                instrument_token = 260105  # Fallback to Bank Nifty index
                use_futures = False
        else:
            instrument_token = 260105  # Bank Nifty index
    
    instrument_type = "futures" if use_futures else "index"
    logger.info(f"Fetching Bank Nifty {instrument_type} data from {start_date} to {end_date}...")
    logger.info(f"Instrument token: {instrument_token}")
    
    all_candles = []
    current_date = start_date
    chunk_count = 0
    max_candles_per_request = 2000  # Zerodha limit
    
    # Calculate total days for progress tracking
    total_days = (end_date - start_date).days
    processed_days = 0
    
    while current_date <= end_date:
        chunk_count += 1
        
        # Calculate chunk end date (max 2000 candles = ~69 days of 5-min data)
        # For safety, use 60 days per chunk
        chunk_end = min(current_date + datetime.timedelta(days=60), end_date)
        
        try:
            logger.info(f"Fetching chunk {chunk_count} ({current_date} to {chunk_end})...")
            
            # Fetch historical data
            from_date_str = current_date.strftime('%Y-%m-%d')
            to_date_str = chunk_end.strftime('%Y-%m-%d')
            
            candles = kite_client.historical_data(
                instrument_token=instrument_token,
                from_date=from_date_str,
                to_date=to_date_str,
                interval='5minute',
                continuous=False,
                oi=False
            )
            
            if candles:
                all_candles.extend(candles)
                processed_days += (chunk_end - current_date).days
                progress = (processed_days / total_days * 100) if total_days > 0 else 0
                logger.info(f"  ✓ Fetched {len(candles)} candles | Progress: {progress:.1f}%")
            else:
                logger.warning(f"  ⚠ No data for chunk {chunk_count}")
            
            # Rate limiting: max 3 requests per second
            time.sleep(0.35)
            
        except kite_exceptions.NetworkException as e:
            logger.warning(f"Network error on chunk {chunk_count}, retrying...: {e}")
            time.sleep(2)
            continue
        except Exception as e:
            logger.error(f"Error fetching chunk {chunk_count}: {e}")
            raise RuntimeError(f"Failed to fetch data chunk: {e}")
        
        current_date = chunk_end + datetime.timedelta(days=1)
    
    if not all_candles:
        raise RuntimeError("No data fetched from Zerodha")
    
    # Convert to DataFrame
    df = pd.DataFrame(all_candles)
    
    # Rename columns for consistency
    df.rename(columns={
        'date': 'timestamp',
        'open': 'open',
        'high': 'high',
        'low': 'low',
        'close': 'close',
        'volume': 'volume'
    }, inplace=True)
    
    # Ensure timestamp is datetime
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    
    # Sort by timestamp
    df = df.sort_values('timestamp').reset_index(drop=True)
    
    # Validate data
    _validate_data(df)
    
    logger.info(f"✓ Successfully fetched {len(df)} candles")
    logger.info(f"  Date range: {df['timestamp'].min()} to {df['timestamp'].max()}")
    
    return df


def _validate_data(df: pd.DataFrame) -> None:
    """
    Validate OHLC data integrity.
    
    Args:
        df: DataFrame with OHLC data
    
    Raises:
        ValueError: If data validation fails
    """
    required_columns = ['timestamp', 'open', 'high', 'low', 'close', 'volume']
    missing = [col for col in required_columns if col not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")
    
    # Check for missing values
    missing_count = df[required_columns[1:]].isnull().sum().sum()
    if missing_count > 0:
        logger.warning(f"Found {missing_count} missing values in OHLC data")
    
    # Check if volume is actually present (not all zeros/None)
    if 'volume' in df.columns:
        volume_sum = df['volume'].sum()
        volume_nonzero = (df['volume'] > 0).sum()
        volume_avg = df['volume'].mean()
        if volume_sum == 0 or volume_nonzero == 0:
            logger.warning(f"⚠️ Volume data appears to be missing (all zeros). "
                         f"This is expected for Nifty index. Consider using futures for volume data.")
        else:
            logger.info(f"✓ Volume data present: {volume_nonzero}/{len(df)} candles have volume > 0")
            logger.info(f"  Average volume: {volume_avg:,.0f}")
    
    # Validate OHLC relationships
    invalid_ohlc = df[(df['high'] < df['low']) | 
                      (df['high'] < df['open']) | 
                      (df['high'] < df['close']) |
                      (df['low'] > df['open']) |
                      (df['low'] > df['close'])]
    
    if len(invalid_ohlc) > 0:
        logger.warning(f"Found {len(invalid_ohlc)} rows with invalid OHLC relationships")
    
    logger.info("✓ Data validation passed")

