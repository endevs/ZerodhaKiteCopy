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
from data_fetcher import get_kite_client, fetch_data
from backtester import run_backtest
from csv_report import generate_trade_report


def main():
    """Main function to run ORB strategy backtest."""
    logger.info("=" * 60)
    
    # Determine trading mode from config
    trading_mode = getattr(config, 'TRADING_MODE', 'swing')
    candle_interval = getattr(config, 'CANDLE_INTERVAL', '15minute')
    orb_candle_number = getattr(config, 'ORB_CANDLE_NUMBER', 4)
    one_trade_per_day = getattr(config, 'ONE_TRADE_PER_DAY', False)  # NEW: Get one trade per day flag
    
    mode_name = "SCALPING" if trading_mode == "scalping" else "SWING"
    mode_text = " (ONE TRADE PER DAY)" if one_trade_per_day else ""
    logger.info(f"ORB {mode_name} Trading System{mode_text}")
    logger.info(f"Mode: {trading_mode} | Interval: {candle_interval} | ORB Candle: {orb_candle_number}")
    if one_trade_per_day:
        logger.info("Strategy: Take only ONE trade per day based on 1st candle ORB")
    logger.info("=" * 60)
    
    # Step 1: Get Zerodha credentials
    logger.info(f"\n[1/4] Connecting to Zerodha...")
    try:
        kite = get_kite_client(user_email='raj.bapa@gmail.com')
    except Exception as e:
        logger.error(f"Failed to connect to Zerodha: {e}")
        return None, None
    
    # Step 2: Fetch data (last 3 months for testing)
    logger.info(f"\n[2/4] Fetching {candle_interval} Bank Nifty data...")
    end_date = datetime.date.today()
    start_date = end_date - datetime.timedelta(days=90)  # 3 months
    
    try:
        df = fetch_data(kite, start_date, end_date, interval=candle_interval)
        logger.info(f"✓ Fetched {len(df)} {candle_interval} candles")
    except Exception as e:
        logger.error(f"Failed to fetch data: {e}")
        return None, None
    
    # Step 3: Run backtest
    orb_time = f"{orb_candle_number}st candle (9:15 AM)" if orb_candle_number == 1 else f"{orb_candle_number}th candle (10:00 AM)"
    logger.info(f"\n[3/4] Running ORB strategy backtest ({orb_time} as ORB)...")
    try:
        trades_df, results = run_backtest(df, orb_candle_number=orb_candle_number, one_trade_per_day=one_trade_per_day)
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
    logger.info(f"SUCCESS: {mode_name} backtest complete!")
    logger.info("=" * 60)
    
    return trades_df, results


if __name__ == "__main__":
    main()

