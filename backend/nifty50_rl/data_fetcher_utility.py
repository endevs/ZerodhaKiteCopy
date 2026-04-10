"""
Standalone utility to fetch and cache Bank Nifty futures data month-by-month.
Uses futures for recent data (with volume) and index for historical data (older than 3 months).
Run this script independently to populate the data cache.

Usage:
    python data_fetcher_utility.py --start-date 2025-01-01 --end-date 2025-12-31
    python data_fetcher_utility.py --months 12  # Last 12 months
    python data_fetcher_utility.py --update    # Update recent months only
"""
import os
import sys
import logging
import datetime
import argparse
import json
import pandas as pd
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import time
from logging.handlers import RotatingFileHandler

# Add parent directory to path for imports
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_current_dir = os.path.dirname(os.path.abspath(__file__))
# Remove current directory from path temporarily to avoid config conflicts
if _current_dir in sys.path:
    sys.path.remove(_current_dir)
# Add parent directory first
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

# CRITICAL: Set DATABASE_PATH to absolute path before importing database
import config as backend_config
if not os.path.isabs(backend_config.DATABASE_PATH):
    backend_config.DATABASE_PATH = os.path.join(parent_dir, backend_config.DATABASE_PATH)

from database import get_db_connection
# Re-add current directory for other local imports
if _current_dir not in sys.path:
    sys.path.insert(1, _current_dir)

from kiteconnect import KiteConnect
from kiteconnect import exceptions as kite_exceptions

# Import from data_fetcher (avoiding circular import by importing only what we need)
def get_kite_client_from_db(user_id=None, user_email=None):
    """Wrapper to get KiteConnect client from database."""
    import sqlite3
    conn = get_db_connection()
    try:
        if user_email is None:
            user_email = 'raj.bapa@gmail.com'
        
        user_row = conn.execute(
            '''SELECT app_key, app_secret, zerodha_access_token, email FROM users 
               WHERE email = ? AND app_key IS NOT NULL AND app_secret IS NOT NULL 
               AND zerodha_access_token IS NOT NULL''',
            (user_email,)
        ).fetchone()
        
        if not user_row:
            raise RuntimeError(f"No user with credentials found for {user_email}")
        
        user = dict(user_row)
        kite = KiteConnect(api_key=user['app_key'])
        kite.set_access_token(user['zerodha_access_token'])
        return kite
    finally:
        conn.close()

def get_banknifty_futures_token(kite_client, target_date=None):
    """Get Bank Nifty futures token for a target date."""
    if target_date is None:
        target_date = datetime.date.today()
    
    try:
        instruments = kite_client.instruments('NFO')
        banknifty_futures = [
            inst for inst in instruments
            if inst.get('name') == 'BANKNIFTY' and
               inst.get('instrument_type') == 'FUT' and
               inst.get('expiry') is not None
        ]
        
        if not banknifty_futures:
            return None
        
        valid_futures = [inst for inst in banknifty_futures if inst.get('expiry') >= target_date]
        if not valid_futures:
            valid_futures = banknifty_futures
        
        valid_futures.sort(key=lambda x: x.get('expiry'))
        return valid_futures[0].get('instrument_token')
    except Exception:
        return None

# Setup logging
log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, f'data_fetcher_utility_{datetime.datetime.now().strftime("%Y%m%d_%H%M%S")}.log')

# Configure root logger
root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)

# Clear existing handlers
if root_logger.handlers:
    root_logger.handlers.clear()

# Create formatters
console_formatter = logging.Formatter('[%(levelname)s] [%(asctime)s] %(message)s', datefmt='%Y-%m-%d %H:%M:%S')
file_formatter = logging.Formatter('[%(levelname)s] [%(asctime)s] [%(name)s] %(message)s', datefmt='%Y-%m-%d %H:%M:%S')

# Console handler
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(logging.INFO)
console_handler.setFormatter(console_formatter)
root_logger.addHandler(console_handler)

# File handler with rotation
file_handler = RotatingFileHandler(
    log_file,
    maxBytes=10*1024*1024,  # 10MB
    backupCount=10,
    encoding='utf-8'
)
file_handler.setLevel(logging.INFO)
file_handler.setFormatter(file_formatter)
root_logger.addHandler(file_handler)

# Ensure all child loggers propagate to root
root_logger.propagate = True

logger = logging.getLogger(__name__)
logger.info("=" * 60)
logger.info("Bank Nifty Futures Data Fetcher Utility")
logger.info("=" * 60)
logger.info(f"Console logging: ENABLED (logs appear in console)")
logger.info(f"File logging: ENABLED (logs saved to: {log_file})")
logger.info("=" * 60)

# Data directory
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
METADATA_FILE = os.path.join(DATA_DIR, 'metadata.json')
os.makedirs(DATA_DIR, exist_ok=True)


def get_month_range(year: int, month: int) -> Tuple[datetime.date, datetime.date]:
    """
    Get start and end dates for a given month.
    
    Args:
        year: Year (e.g., 2025)
        month: Month (1-12)
    
    Returns:
        (start_date, end_date) tuple
    """
    start_date = datetime.date(year, month, 1)
    
    # Get last day of month
    if month == 12:
        end_date = datetime.date(year + 1, 1, 1) - datetime.timedelta(days=1)
    else:
        end_date = datetime.date(year, month + 1, 1) - datetime.timedelta(days=1)
    
    return start_date, end_date


def should_use_index(year: int, month: int) -> bool:
    """
    Determine if we should use index instead of futures for historical data.
    
    Futures contracts expire monthly, so historical contracts (>3 months old) 
    are not available. Use index for historical data.
    
    Args:
        year: Year
        month: Month (1-12)
    
    Returns:
        True if should use index, False if should use futures
    """
    target_date = datetime.date(year, month, 15)
    cutoff_date = datetime.date.today() - datetime.timedelta(days=90)  # 3 months
    
    # If month is older than 3 months, use index (futures won't have historical data)
    return target_date < cutoff_date


def get_futures_token_for_month(kite_client: KiteConnect, year: int, month: int) -> Optional[int]:
    """
    Get the appropriate futures contract token for a given month.
    Uses the contract that was active during that month.
    
    Args:
        kite_client: Authenticated KiteConnect client
        year: Year
        month: Month (1-12)
    
    Returns:
        Instrument token or None
    """
    # Use the 15th of the month as reference date
    target_date = datetime.date(year, month, 15)
    
    try:
        instruments = kite_client.instruments('NFO')
        
        # Filter for BANKNIFTY futures
        banknifty_futures = [
            inst for inst in instruments
            if inst.get('name') == 'BANKNIFTY' and
               inst.get('instrument_type') == 'FUT' and
               inst.get('expiry') is not None
        ]
        
        if not banknifty_futures:
            logger.warning(f"No BANKNIFTY futures found for {year}-{month:02d}")
            return None
        
        # Find futures that were active during this month
        # Contract should expire >= target_date and ideally be the nearest month contract
        valid_futures = [
            inst for inst in banknifty_futures
            if inst.get('expiry') >= target_date
        ]
        
        if not valid_futures:
            # Fallback: use the contract with expiry closest to target_date
            valid_futures = banknifty_futures
        
        # Sort by expiry and get the nearest one
        valid_futures.sort(key=lambda x: abs((x.get('expiry') - target_date).days))
        selected = valid_futures[0]
        
        token = selected.get('instrument_token')
        expiry = selected.get('expiry')
        symbol = selected.get('tradingsymbol', 'N/A')
        
        logger.info(f"Selected contract for {year}-{month:02d}: {symbol} (token: {token}, expiry: {expiry})")
        return token
        
    except Exception as e:
        logger.error(f"Error finding futures for {year}-{month:02d}: {e}")
        return None


def fetch_month_data(
    kite_client: KiteConnect,
    year: int,
    month: int,
    instrument_token: Optional[int] = None
) -> Optional[pd.DataFrame]:
    """
    Fetch 5-minute OHLC data for a specific month.
    
    For historical months (>3 months old), uses index (no volume).
    For recent months, uses futures (with volume).
    
    Args:
        kite_client: Authenticated KiteConnect client
        year: Year
        month: Month (1-12)
        instrument_token: Optional token. If None, auto-detects.
    
    Returns:
        DataFrame with OHLC data or None if fetch fails
    """
    start_date, end_date = get_month_range(year, month)
    
    # Check if we should use index for historical data
    use_index = should_use_index(year, month)
    
    if use_index:
        # Use index for historical data (no volume, but has full history)
        logger.info(f"Historical month detected ({year}-{month:02d}). Using index (no volume)...")
        instrument_token = 260105  # Bank Nifty index token
    elif instrument_token is None:
        # Try to get futures contract for recent month
        instrument_token = get_futures_token_for_month(kite_client, year, month)
        if instrument_token is None:
            logger.warning(f"Could not find futures for {year}-{month:02d}, falling back to index")
            instrument_token = 260105
            use_index = True
    
    instrument_type = "index" if use_index else "futures"
    logger.info(f"Fetching data for {year}-{month:02d} ({start_date} to {end_date}) using {instrument_type}...")
    
    all_candles = []
    current_date = start_date
    
    # Fetch in chunks (max 60 days per chunk)
    chunk_count = 0
    while current_date <= end_date:
        chunk_count += 1
        chunk_end = min(current_date + datetime.timedelta(days=60), end_date)
        
        try:
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
                logger.info(f"  Chunk {chunk_count}: Fetched {len(candles)} candles")
            else:
                logger.warning(f"  Chunk {chunk_count}: No data")
            
            time.sleep(0.35)  # Rate limiting
            
        except kite_exceptions.NetworkException as e:
            logger.warning(f"Network error on chunk {chunk_count}, retrying...: {e}")
            time.sleep(2)
            continue
        except Exception as e:
            logger.error(f"Error fetching chunk {chunk_count}: {e}")
            return None
        
        current_date = chunk_end + datetime.timedelta(days=1)
    
    if not all_candles:
        logger.warning(f"No data fetched for {year}-{month:02d}")
        return None
    
    # Convert to DataFrame
    df = pd.DataFrame(all_candles)
    df.rename(columns={'date': 'timestamp'}, inplace=True)
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df = df.sort_values('timestamp').reset_index(drop=True)
    
    # Ensure volume column exists (fill with 0 if missing, e.g., for index)
    if 'volume' not in df.columns:
        df['volume'] = 0
    
    # Validate volume
    if 'volume' in df.columns:
        volume_count = (df['volume'] > 0).sum()
        if volume_count > 0:
            logger.info(f"  ✓ Fetched {len(df)} candles with volume data ({volume_count} non-zero)")
        else:
            if use_index:
                logger.info(f"  ✓ Fetched {len(df)} candles from index (no volume - expected for historical data)")
            else:
                logger.warning(f"  ⚠ No volume data in fetched candles")
    else:
        logger.warning(f"  ⚠ Volume column missing")
    
    return df


def get_data_filename(year: int, month: int) -> str:
    """Get filename for cached month data."""
    return f"banknifty_futures_{year}_{month:02d}.csv"


def save_month_data(df: pd.DataFrame, year: int, month: int, source: str = "futures") -> str:
    """
    Save month data to CSV file.
    
    Args:
        df: DataFrame to save
        year: Year
        month: Month
        source: "futures" or "index" (for metadata)
    
    Returns:
        Path to saved file
    """
    filename = get_data_filename(year, month)
    filepath = os.path.join(DATA_DIR, filename)
    
    df.to_csv(filepath, index=False)
    logger.info(f"  ✓ Saved {len(df)} candles to {filename} (source: {source})")
    
    return filepath


def load_month_data(year: int, month: int) -> Optional[pd.DataFrame]:
    """
    Load cached month data from CSV.
    
    Args:
        year: Year
        month: Month
    
    Returns:
        DataFrame or None if not found
    """
    filename = get_data_filename(year, month)
    filepath = os.path.join(DATA_DIR, filename)
    
    if not os.path.exists(filepath):
        return None
    
    try:
        df = pd.read_csv(filepath)
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        logger.info(f"  ✓ Loaded {len(df)} candles from {filename}")
        return df
    except Exception as e:
        logger.error(f"Error loading {filename}: {e}")
        return None


def load_metadata() -> Dict:
    """Load metadata about cached data."""
    if not os.path.exists(METADATA_FILE):
        return {}
    
    try:
        with open(METADATA_FILE, 'r') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error loading metadata: {e}")
        return {}


def save_metadata(metadata: Dict):
    """Save metadata about cached data."""
    try:
        with open(METADATA_FILE, 'w') as f:
            json.dump(metadata, f, indent=2)
    except Exception as e:
        logger.error(f"Error saving metadata: {e}")


def update_metadata(year: int, month: int, row_count: int, date_range: Tuple[str, str], source: str = "futures"):
    """Update metadata for a month."""
    metadata = load_metadata()
    key = f"{year}_{month:02d}"
    metadata[key] = {
        'year': year,
        'month': month,
        'row_count': row_count,
        'start_date': date_range[0],
        'end_date': date_range[1],
        'source': source,  # "futures" or "index"
        'cached_at': datetime.datetime.now().isoformat()
    }
    save_metadata(metadata)


def fetch_and_cache_months(
    kite_client: KiteConnect,
    start_date: datetime.date,
    end_date: datetime.date,
    force_refresh: bool = False
) -> Dict[str, pd.DataFrame]:
    """
    Fetch and cache data for multiple months.
    
    Args:
        kite_client: Authenticated KiteConnect client
        start_date: Start date
        end_date: End date
        force_refresh: If True, re-fetch even if cached
    
    Returns:
        Dictionary mapping "YYYY_MM" to DataFrame
    """
    cached_data = {}
    current_date = datetime.date(start_date.year, start_date.month, 1)
    
    while current_date <= end_date:
        year = current_date.year
        month = current_date.month
        
        # Check if already cached
        if not force_refresh:
            df = load_month_data(year, month)
            if df is not None:
                cached_data[f"{year}_{month:02d}"] = df
                logger.info(f"✓ Using cached data for {year}-{month:02d}")
                # Move to next month
                if month == 12:
                    current_date = datetime.date(year + 1, 1, 1)
                else:
                    current_date = datetime.date(year, month + 1, 1)
                continue
        
        # Fetch new data
        logger.info(f"\nFetching data for {year}-{month:02d}...")
        df = fetch_month_data(kite_client, year, month)
        
        if df is not None and len(df) > 0:
            # Determine source (index or futures)
            source = "index" if should_use_index(year, month) else "futures"
            
            # Save to cache
            save_month_data(df, year, month, source=source)
            
            # Update metadata
            date_range = (df['timestamp'].min().isoformat(), df['timestamp'].max().isoformat())
            update_metadata(year, month, len(df), date_range, source=source)
            
            cached_data[f"{year}_{month:02d}"] = df
        else:
            logger.warning(f"⚠ No data available for {year}-{month:02d}")
        
        # Move to next month
        if month == 12:
            current_date = datetime.date(year + 1, 1, 1)
        else:
            current_date = datetime.date(year, month + 1, 1)
    
    return cached_data


def combine_cached_data(start_date: datetime.date, end_date: datetime.date) -> Optional[pd.DataFrame]:
    """
    Load and combine cached data for date range.
    
    Args:
        start_date: Start date
        end_date: End date
    
    Returns:
        Combined DataFrame or None if no data available
    """
    all_dataframes = []
    current_date = datetime.date(start_date.year, start_date.month, 1)
    
    while current_date <= end_date:
        year = current_date.year
        month = current_date.month
        
        df = load_month_data(year, month)
        if df is not None:
            # Filter to date range
            df_filtered = df[
                (df['timestamp'].dt.date >= start_date) &
                (df['timestamp'].dt.date <= end_date)
            ]
            if len(df_filtered) > 0:
                all_dataframes.append(df_filtered)
        
        # Move to next month
        if month == 12:
            current_date = datetime.date(year + 1, 1, 1)
        else:
            current_date = datetime.date(year, month + 1, 1)
    
    if not all_dataframes:
        return None
    
    # Combine all dataframes
    combined = pd.concat(all_dataframes, ignore_index=True)
    combined = combined.sort_values('timestamp').reset_index(drop=True)
    combined = combined.drop_duplicates(subset=['timestamp'], keep='last')
    
    return combined


def main():
    parser = argparse.ArgumentParser(description='Fetch and cache Bank Nifty futures data')
    parser.add_argument('--start-date', type=str, help='Start date (YYYY-MM-DD)')
    parser.add_argument('--end-date', type=str, help='End date (YYYY-MM-DD)')
    parser.add_argument('--months', type=int, help='Number of months to fetch (from today backwards)')
    parser.add_argument('--update', action='store_true', help='Update recent months only (last 3 months)')
    parser.add_argument('--force-refresh', action='store_true', help='Re-fetch even if cached')
    parser.add_argument('--user-email', type=str, default='raj.bapa@gmail.com', help='User email for Zerodha credentials')
    
    args = parser.parse_args()
    
    # Determine date range
    end_date = datetime.date.today()
    
    if args.update:
        # Update last 3 months
        start_date = end_date - datetime.timedelta(days=90)
        logger.info(f"Update mode: Fetching data for last 3 months")
    elif args.months:
        start_date = end_date - datetime.timedelta(days=args.months * 30)
        logger.info(f"Fetching data for last {args.months} months")
    elif args.start_date and args.end_date:
        start_date = datetime.datetime.strptime(args.start_date, '%Y-%m-%d').date()
        end_date = datetime.datetime.strptime(args.end_date, '%Y-%m-%d').date()
        logger.info(f"Fetching data from {start_date} to {end_date}")
    else:
        # Default: last 12 months
        start_date = end_date - datetime.timedelta(days=365)
        logger.info(f"Default: Fetching data for last 12 months")
    
    logger.info("=" * 60)
    logger.info("Bank Nifty Futures Data Fetcher Utility")
    logger.info("=" * 60)
    logger.info(f"Date range: {start_date} to {end_date}")
    logger.info(f"Data directory: {DATA_DIR}")
    logger.info("")
    
    try:
        # Get Zerodha client
        logger.info("Connecting to Zerodha...")
        kite_client = get_kite_client_from_db(user_email=args.user_email)
        logger.info("✓ Connected to Zerodha")
        
        # Fetch and cache data
        logger.info("\nStarting data fetch...")
        cached_data = fetch_and_cache_months(
            kite_client,
            start_date,
            end_date,
            force_refresh=args.force_refresh
        )
        
        # Combine and show summary
        combined = combine_cached_data(start_date, end_date)
        
        if combined is not None and len(combined) > 0:
            logger.info("\n" + "=" * 60)
            logger.info("Data Fetch Summary")
            logger.info("=" * 60)
            logger.info(f"Total candles: {len(combined):,}")
            logger.info(f"Date range: {combined['timestamp'].min()} to {combined['timestamp'].max()}")
            
            if 'volume' in combined.columns:
                volume_count = (combined['volume'] > 0).sum()
                avg_volume = combined['volume'].mean()
                logger.info(f"Volume data: {volume_count:,} candles with volume (avg: {avg_volume:,.0f})")
            
            logger.info(f"\nCached months: {len(cached_data)}")
            for key, df in sorted(cached_data.items()):
                logger.info(f"  {key}: {len(df):,} candles")
            
            logger.info(f"\n✓ Data cached successfully in: {DATA_DIR}")
        else:
            logger.warning("⚠ No data available for the specified date range")
    
    except Exception as e:
        logger.error(f"Error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == '__main__':
    main()

