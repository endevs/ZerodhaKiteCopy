"""
Main entry point for Mountain Signal Strategy
Runs backtest and generates CSV report
"""
import sys
import os
import logging
from datetime import datetime, date, timedelta
import argparse

# Configure logging first (before any other imports that might log)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)

# Add parent directory to path for imports
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

# Try to import pandas - check backend first, then try direct import
try:
    # Try importing from backend first (if available)
    backend_path = os.path.join(parent_dir, 'backend')
    if backend_path not in sys.path:
        sys.path.insert(0, backend_path)
    
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    try:
        # Try direct import
        import pandas as pd
        HAS_PANDAS = True
    except ImportError:
        HAS_PANDAS = False
        logger.error("=" * 60)
        logger.error("ERROR: pandas is required for backtesting!")
        logger.error("Please install it with: pip install pandas")
        logger.error("Or activate the backend virtual environment that has pandas installed")
        logger.error("=" * 60)
        sys.exit(1)

from Mountain_signal.backtest import MountainSignalBacktester
from Mountain_signal.config import CANDLE_INTERVAL

# Try to import data fetcher from existing codebase (optional)
try:
    import sys as _sys
    import os as _os
    _current_dir = _os.path.dirname(os.path.abspath(__file__))
    _backend_path = _os.path.join(parent_dir, 'backend', 'simple_ORB_trading')
    if _backend_path not in _sys.path:
        _sys.path.insert(0, _backend_path)
    
    from data_fetcher import get_kite_client, fetch_data
    HAS_ZERODHA_API = True
    logger.info("Zerodha API data fetcher available")
except ImportError as e:
    HAS_ZERODHA_API = False
    logger.warning(f"Zerodha API not available: {e}. Using sample data for testing.")


def create_sample_data() -> pd.DataFrame:
    """
    Create sample data for testing when Zerodha API is not available
    """
    logger.info("Creating sample data for testing...")
    
    # Generate sample OHLC data for multiple days
    dates = []
    base_price = 50000.0
    
    # Generate data for 10 trading days
    start_date = datetime(2025, 1, 1, 9, 15)
    for day in range(10):
        current_date = start_date + timedelta(days=day)
        # Skip weekends
        if current_date.weekday() >= 5:
            continue
        
        # Generate 5-minute candles from 9:15 to 15:30
        for minute in range(0, 375, 5):  # 9:15 to 15:30 = 375 minutes, 5-minute intervals
            candle_time = current_date.replace(hour=9, minute=15) + timedelta(minutes=minute)
            if candle_time.hour >= 15 and candle_time.minute > 30:
                break
            if candle_time.hour < 9 or (candle_time.hour == 9 and candle_time.minute < 15):
                continue
            
            # Simulate realistic price movement with multiple periods of strong upward movement
            # (to create conditions where low > ema5 and RSI > 70 for PE signal detection)
            candle_index = len(dates)
            price_change = (candle_index % 10 - 5) * 10  # Oscillating pattern
            
            # Create MORE frequent periods of strong upward movement for PE signal detection
            # Pattern: Strong up -> Consolidation -> Correction -> Recovery (repeats every ~30 candles)
            cycle_pos = (candle_index // 30) % 4
            if cycle_pos == 0:  # Strong upward trend period (RSI > 70, low > ema5)
                price_change = 80 + (candle_index % 15)  # Strong upward movement
            elif cycle_pos == 1:  # Consolidation (still elevated)
                price_change = 40 + (candle_index % 10)  # Moderate up
            elif cycle_pos == 2:  # Correction period (price breaks below signal low for entry)
                price_change = -60 - (candle_index % 15)  # Correction down (triggers entry)
            else:  # Recovery (builds up for next cycle)
                price_change = 20 + (candle_index % 10)  # Gradual recovery
            
            trend = (candle_index * 0.2)  # Slight upward trend
            close = base_price + price_change + trend + (day * 40)
            high = close + abs(price_change * 0.5) + 20
            low = close - abs(price_change * 0.5) - 20
            
            # Ensure low can be above EMA5 in strong upward periods (for PE signal)
            if cycle_pos == 0 or cycle_pos == 1:
                low = close - 8  # Tighter range during strong moves (low stays above ema5)
                high = close + 45  # Strong highs
            elif cycle_pos == 2:
                # Correction: price breaks below previous signal low (triggers entry)
                low = close - 25  # Lower low to trigger entry
                high = close + 15
            
            open_price = close + (price_change * 0.2)
            
            dates.append({
                'date': candle_time,
                'open': round(open_price, 2),
                'high': round(high, 2),
                'low': round(low, 2),
                'close': round(close, 2),
                'volume': 1000000 + (candle_index * 1000)
            })
    
    df = pd.DataFrame(dates)
    logger.info(f"Generated {len(df)} sample candles")
    return df


def fetch_historical_data(instrument: str = "BANKNIFTY", from_date: date = None, 
                         to_date: date = None, interval: str = "5minute") -> pd.DataFrame:
    """
    Fetch historical data from Zerodha Kite API or create sample data
    
    Args:
        instrument: Instrument name (BANKNIFTY or NIFTY)
        from_date: Start date (default: 30 days ago)
        to_date: End date (default: today)
        interval: Candle interval (default: 5minute)
    
    Returns:
        DataFrame with OHLC data
    """
    if not from_date:
        from_date = date.today() - timedelta(days=30)
    if not to_date:
        to_date = date.today()
    
    if HAS_ZERODHA_API:
        try:
            logger.info(f"Fetching data from Zerodha API: {instrument} from {from_date} to {to_date}")
            kite = get_kite_client()
            df = fetch_data(kite, from_date, to_date, interval)
            
            # Ensure date column exists
            if 'date' not in df.columns and 'timestamp' in df.columns:
                df['date'] = pd.to_datetime(df['timestamp'])
            elif 'date' not in df.columns:
                logger.warning("DataFrame missing 'date' column, using index")
                df['date'] = pd.date_range(start=from_date, periods=len(df), freq='5min')
            
            logger.info(f"Fetched {len(df)} candles from Zerodha API")
            return df
        except Exception as e:
            logger.error(f"Error fetching from Zerodha API: {e}")
            logger.info("Falling back to sample data...")
            return create_sample_data()
    else:
        logger.info("Zerodha API not available, using sample data...")
        return create_sample_data()


def main():
    """Main function to run backtest and generate CSV report"""
    parser = argparse.ArgumentParser(description='Mountain Signal Strategy Backtest')
    parser.add_argument('--instrument', type=str, default='BANKNIFTY', 
                       choices=['BANKNIFTY', 'NIFTY'],
                       help='Instrument to backtest (default: BANKNIFTY)')
    parser.add_argument('--from-date', type=str, default=None,
                       help='Start date (YYYY-MM-DD, default: 30 days ago)')
    parser.add_argument('--to-date', type=str, default=None,
                       help='End date (YYYY-MM-DD, default: today)')
    parser.add_argument('--interval', type=str, default='5minute',
                       choices=['5minute', '15minute'],
                       help='Candle interval (default: 5minute)')
    parser.add_argument('--sample', action='store_true',
                       help='Use sample data instead of fetching from API')
    
    args = parser.parse_args()
    
    logger.info("=" * 60)
    logger.info("Mountain Signal Strategy - Backtest & Report Generation")
    logger.info("=" * 60)
    
    try:
        # Parse dates
        from_date = datetime.strptime(args.from_date, '%Y-%m-%d').date() if args.from_date else None
        to_date = datetime.strptime(args.to_date, '%Y-%m-%d').date() if args.to_date else None
        
        # Fetch or create data
        if args.sample:
            logger.info("Using sample data as requested...")
            df = create_sample_data()
        else:
            df = fetch_historical_data(args.instrument, from_date, to_date, args.interval)
        
        if df.empty:
            logger.error("No data available for backtesting")
            return 1
        
        # Ensure date column exists
        if 'date' not in df.columns:
            if 'time' in df.columns:
                df['date'] = pd.to_datetime(df['time'])
            elif 'timestamp' in df.columns:
                df['date'] = pd.to_datetime(df['timestamp'])
            else:
                logger.error("DataFrame must have 'date', 'time', or 'timestamp' column")
                return 1
        
        logger.info(f"Data prepared: {len(df)} candles from {df.iloc[0]['date']} to {df.iloc[-1]['date']}")
        
        # Initialize backtester
        logger.info(f"Initializing backtester for {args.instrument}...")
        backtester = MountainSignalBacktester(instrument_key=args.instrument)
        
        # Run backtest
        logger.info("Running backtest...")
        trades_df, summary_stats, report_path = backtester.run_backtest(df, from_date, to_date)
        
        # Print summary
        logger.info("=" * 60)
        logger.info("BACKTEST RESULTS")
        logger.info("=" * 60)
        logger.info(f"Total Trades: {summary_stats.get('total_trades', 0)}")
        logger.info(f"Winning Trades: {summary_stats.get('winning_trades', 0)}")
        logger.info(f"Losing Trades: {summary_stats.get('losing_trades', 0)}")
        logger.info(f"Win Rate: {summary_stats.get('win_rate', 0):.2f}%")
        logger.info(f"Total Index P&L: {summary_stats.get('total_index_pnl', 0):.2f}")
        logger.info("=" * 60)
        logger.info(f"CSV Report generated: {report_path}")
        logger.info("=" * 60)
        logger.info("SUCCESS: Backtest complete!")
        logger.info("=" * 60)
        
        return 0
        
    except Exception as e:
        logger.error(f"Error running backtest: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
