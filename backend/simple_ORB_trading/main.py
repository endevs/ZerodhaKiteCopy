"""
Main entry point for ORB Trading System
Run this file to backtest the ORB strategy
"""
import logging
import datetime
import sys
import os

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(levelname)s] %(message)s'
)
logger = logging.getLogger(__name__)

# Add current directory to path
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

import config
from data_fetcher import get_kite_client, fetch_15min_data
from backtester import run_backtest
from csv_report import generate_trade_report


def main():
    """Main function to run ORB strategy backtest."""
    logger.info("=" * 60)
    logger.info("ORB (Opening Range Breakout) Trading System")
    logger.info("=" * 60)
    
    # Step 1: Get Zerodha credentials
    logger.info("\n[1/4] Connecting to Zerodha...")
    try:
        kite = get_kite_client(user_email='raj.bapa@gmail.com')
    except Exception as e:
        logger.error(f"Failed to connect to Zerodha: {e}")
        return None, None
    
    # Step 2: Fetch data (last 3 months for testing)
    logger.info("\n[2/4] Fetching 15-minute Bank Nifty data...")
    end_date = datetime.date.today()
    start_date = end_date - datetime.timedelta(days=90)  # 3 months
    
    try:
        df = fetch_15min_data(kite, start_date, end_date)
        logger.info(f"✓ Fetched {len(df)} candles")
    except Exception as e:
        logger.error(f"Failed to fetch data: {e}")
        return None, None
    
    # Step 3: Run backtest
    logger.info("\n[3/4] Running ORB strategy backtest...")
    try:
        trades_df, results = run_backtest(df)
    except Exception as e:
        logger.error(f"Backtest failed: {e}")
        import traceback
        traceback.print_exc()
        return None, None
    
    # Step 4: Generate report
    logger.info("\n[4/4] Generating trade report...")
    try:
        report_path = generate_trade_report(trades_df)
        if report_path:
            logger.info(f"✓ Report saved: {report_path}")
    except Exception as e:
        logger.error(f"Failed to generate report: {e}")
    
    logger.info("\n" + "=" * 60)
    logger.info("SUCCESS: Backtest complete!")
    logger.info("=" * 60)
    
    return trades_df, results


if __name__ == "__main__":
    main()

