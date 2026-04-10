"""
Options Data Collector
Fetches and stores index and option contract data from Zerodha API
"""
import logging
import datetime
import time
from typing import Optional, List, Dict
from database import get_db_connection
from kiteconnect import KiteConnect

logger = logging.getLogger(__name__)


def get_kite_client(user_email: str = None, user_id: int = None) -> KiteConnect:
    """Get KiteConnect client from database"""
    conn = get_db_connection()
    try:
        if user_id:
            cursor = conn.execute(
                'SELECT app_key, app_secret, zerodha_access_token FROM users WHERE id = ? LIMIT 1',
                (user_id,)
            )
        elif user_email:
            cursor = conn.execute(
                'SELECT app_key, app_secret, zerodha_access_token FROM users WHERE email = ? LIMIT 1',
                (user_email,)
            )
        else:
            # For scheduler, get first user with valid credentials
            cursor = conn.execute(
                'SELECT app_key, app_secret, zerodha_access_token FROM users WHERE app_key IS NOT NULL AND zerodha_access_token IS NOT NULL LIMIT 1'
            )
        
        user = cursor.fetchone()
        if not user or not user[0] or not user[2]:
            raise ValueError("Zerodha credentials not found")
        
        kite = KiteConnect(api_key=user[0], access_token=user[2])
        return kite
    finally:
        conn.close()


def collect_index_data(index_name: str, date: datetime.date, kite: Optional[KiteConnect] = None) -> bool:
    """
    Collect index 5-minute candles for a date and store daily OHLC
    
    Args:
        index_name: 'NIFTY' or 'BANKNIFTY'
        date: Trading date
        kite: Optional KiteConnect instance (will create if not provided)
    
    Returns:
        True if successful, False otherwise
    """
    try:
        if not kite:
            kite = get_kite_client()
        
        # Get instrument token
        if index_name == 'BANKNIFTY':
            instrument_token = 260105  # Bank Nifty Index
        elif index_name == 'NIFTY':
            instrument_token = 256265  # Nifty 50 Index
        else:
            logger.error(f"Invalid index name: {index_name}")
            return False
        
        # Fetch 5-minute candles
        logger.info(f"Fetching 5-minute candles for {index_name} on {date}")
        candles = kite.historical_data(
            instrument_token=instrument_token,
            from_date=date,
            to_date=date,
            interval='5minute'
        )
        
        if not candles:
            logger.warning(f"No candles found for {index_name} on {date}")
            return False
        
        # Calculate daily OHLC
        opens = [c['open'] for c in candles]
        highs = [c['high'] for c in candles]
        lows = [c['low'] for c in candles]
        closes = [c['close'] for c in candles]
        volumes = [c.get('volume', 0) for c in candles]
        
        daily_open = opens[0] if opens else 0
        daily_high = max(highs) if highs else 0
        daily_low = min(lows) if lows else 0
        daily_close = closes[-1] if closes else 0
        daily_volume = sum(volumes) if volumes else 0
        
        # Store in database
        conn = get_db_connection()
        try:
            # Store daily OHLC
            conn.execute("""
                INSERT OR REPLACE INTO index_daily_data 
                (index_name, date, open, high, low, close, volume)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (index_name, date, daily_open, daily_high, daily_low, daily_close, daily_volume))
            
            # Store 5-minute candles
            for candle in candles:
                timestamp = candle['date']
                if isinstance(timestamp, str):
                    timestamp = datetime.datetime.fromisoformat(timestamp.replace('+05:30', ''))
                
                conn.execute("""
                    INSERT OR REPLACE INTO index_candles_5min
                    (index_name, timestamp, open, high, low, close, volume, date)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    index_name,
                    timestamp,
                    candle['open'],
                    candle['high'],
                    candle['low'],
                    candle['close'],
                    candle.get('volume', 0),
                    date
                ))
            
            conn.commit()
            logger.info(f"✓ Stored {len(candles)} candles for {index_name} on {date}")
            return True
        finally:
            conn.close()
            
    except Exception as e:
        logger.error(f"Error collecting index data for {index_name} on {date}: {e}", exc_info=True)
        return False


def collect_option_chain(index_name: str, date: datetime.date, kite: Optional[KiteConnect] = None) -> bool:
    """
    Collect option chain for a date based on index high/low range
    
    Args:
        index_name: 'NIFTY' or 'BANKNIFTY'
        date: Trading date
        kite: Optional KiteConnect instance
    
    Returns:
        True if successful, False otherwise
    """
    try:
        if not kite:
            kite = get_kite_client()
        
        # Get index OHLC for the date
        conn = get_db_connection()
        try:
            cursor = conn.execute("""
                SELECT high, low FROM index_daily_data
                WHERE index_name = ? AND date = ?
            """, (index_name, date))
            row = cursor.fetchone()
            
            if not row:
                logger.warning(f"No index data found for {index_name} on {date}. Collecting index data first...")
                if not collect_index_data(index_name, date, kite):
                    return False
                # Retry fetching
                cursor = conn.execute("""
                    SELECT high, low FROM index_daily_data
                    WHERE index_name = ? AND date = ?
                """, (index_name, date))
                row = cursor.fetchone()
                if not row:
                    logger.error(f"Still no index data after collection attempt")
                    return False
            
            index_high = row[0]
            index_low = row[1]
        finally:
            conn.close()
        
        # Calculate strike range
        strike_step = 100 if index_name == 'BANKNIFTY' else 50
        min_strike = int((index_low // strike_step) * strike_step)
        max_strike = int((index_high // strike_step) * strike_step) + strike_step
        
        logger.info(f"Collecting option chain for {index_name} on {date}")
        logger.info(f"  Strike range: {min_strike} to {max_strike} (step: {strike_step})")
        
        # Fetch instruments from NFO
        instruments = kite.instruments('NFO')
        
        # Filter options for this index and date range
        # Get all expiries that were active on this date
        today = datetime.date.today()
        if date >= today:
            # For future dates, get current active expiries
            active_expiries = sorted(list(set([
                inst['expiry'] for inst in instruments
                if inst.get('name') == index_name and inst.get('expiry') and inst.get('expiry') >= date
            ])))[:3]  # Get next 3 expiries
        else:
            # For past dates, we need to get expiries that were active then
            # This is approximate - we'll get expiries that would have been active
            active_expiries = sorted(list(set([
                inst['expiry'] for inst in instruments
                if inst.get('name') == index_name and inst.get('expiry')
            ])))[:10]  # Get multiple expiries to cover historical
        
        if not active_expiries:
            logger.warning(f"No active expiries found for {index_name}")
            return False
        
        # Collect options for each expiry in the strike range
        conn = get_db_connection()
        contracts_stored = 0
        
        try:
            for expiry in active_expiries:
                expiry_str = expiry.strftime('%Y-%m-%d') if hasattr(expiry, 'strftime') else str(expiry)
                
                # Filter options
                options = [
                    inst for inst in instruments
                    if inst.get('name') == index_name and
                       inst.get('expiry') and
                       (inst.get('expiry').strftime('%Y-%m-%d') if hasattr(inst.get('expiry'), 'strftime') else str(inst.get('expiry'))) == expiry_str and
                       inst.get('strike') and
                       min_strike <= inst.get('strike') <= max_strike
                ]
                
                # Store option contracts
                for opt in options:
                    try:
                        conn.execute("""
                            INSERT OR REPLACE INTO option_contracts
                            (index_name, date, instrument_token, tradingsymbol, strike, expiry_date, instrument_type)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        """, (
                            index_name,
                            date,
                            opt['instrument_token'],
                            opt['tradingsymbol'],
                            opt['strike'],
                            expiry_str,
                            opt['instrument_type']
                        ))
                        contracts_stored += 1
                    except Exception as e:
                        logger.warning(f"Error storing contract {opt.get('tradingsymbol')}: {e}")
                        continue
                
                logger.info(f"  Stored {len(options)} contracts for expiry {expiry_str}")
            
            conn.commit()
            logger.info(f"✓ Stored {contracts_stored} option contracts for {index_name} on {date}")
            return True
        finally:
            conn.close()
            
    except Exception as e:
        logger.error(f"Error collecting option chain for {index_name} on {date}: {e}", exc_info=True)
        return False


def collect_option_candles(instrument_token: int, tradingsymbol: str, date: datetime.date, 
                          kite: Optional[KiteConnect] = None) -> bool:
    """
    Collect 5-minute candles for an option contract
    
    Args:
        instrument_token: Option instrument token
        tradingsymbol: Option trading symbol
        date: Trading date
        kite: Optional KiteConnect instance
    
    Returns:
        True if successful, False otherwise
    """
    try:
        if not kite:
            kite = get_kite_client()
        
        # Fetch 5-minute candles
        candles = kite.historical_data(
            instrument_token=instrument_token,
            from_date=date,
            to_date=date,
            interval='5minute'
        )
        
        if not candles:
            logger.debug(f"No candles found for {tradingsymbol} on {date}")
            return False
        
        # Store in database
        conn = get_db_connection()
        try:
            for candle in candles:
                timestamp = candle['date']
                if isinstance(timestamp, str):
                    timestamp = datetime.datetime.fromisoformat(timestamp.replace('+05:30', ''))
                
                conn.execute("""
                    INSERT OR REPLACE INTO option_candles_5min
                    (instrument_token, tradingsymbol, timestamp, open, high, low, close, volume, date)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    instrument_token,
                    tradingsymbol,
                    timestamp,
                    candle['open'],
                    candle['high'],
                    candle['low'],
                    candle['close'],
                    candle.get('volume', 0),
                    date
                ))
            
            conn.commit()
            logger.debug(f"✓ Stored {len(candles)} candles for {tradingsymbol} on {date}")
            return True
        finally:
            conn.close()
            
    except Exception as e:
        logger.warning(f"Error collecting candles for {tradingsymbol} on {date}: {e}")
        return False


def run_daily_collection(date: Optional[datetime.date] = None, user_email: str = None) -> Dict[str, bool]:
    """
    Run daily data collection for both NIFTY and BANKNIFTY
    
    Args:
        date: Trading date (defaults to yesterday if None)
        user_email: Optional user email for credentials
    
    Returns:
        Dictionary with collection status for each index
    """
    if date is None:
        # Use yesterday (market closed)
        date = datetime.date.today() - datetime.timedelta(days=1)
    
    logger.info("="*60)
    logger.info(f"Starting daily data collection for {date}")
    logger.info("="*60)
    
    kite = get_kite_client(user_email) if user_email else get_kite_client()
    
    results = {}
    
    for index_name in ['NIFTY', 'BANKNIFTY']:
        logger.info(f"\nCollecting data for {index_name}...")
        
        # Collect index data
        index_success = collect_index_data(index_name, date, kite)
        
        if index_success:
            # Collect option chain
            chain_success = collect_option_chain(index_name, date, kite)
            
            if chain_success:
                # Collect candles for a sample of options (to avoid rate limits)
                # In production, you might want to collect all or use a scheduler
                conn = get_db_connection()
                try:
                    cursor = conn.execute("""
                        SELECT instrument_token, tradingsymbol
                        FROM option_contracts
                        WHERE index_name = ? AND date = ?
                        LIMIT 50
                    """, (index_name, date))
                    
                    sample_contracts = cursor.fetchall()
                    candles_collected = 0
                    
                    for contract in sample_contracts:
                        if collect_option_candles(contract[0], contract[1], date, kite):
                            candles_collected += 1
                        time.sleep(0.2)  # Rate limiting
                    
                    logger.info(f"  Collected candles for {candles_collected} contracts")
                finally:
                    conn.close()
            
            results[index_name] = chain_success
        else:
            results[index_name] = False
        
        time.sleep(1)  # Rate limiting between indices
    
    logger.info("\n" + "="*60)
    logger.info("Daily collection complete!")
    logger.info("="*60)
    
    return results


if __name__ == '__main__':
    # Test collection for yesterday
    logging.basicConfig(level=logging.INFO)
    run_daily_collection()
