"""
Simple backtester for ORB strategy
"""
import logging
import pandas as pd
import os
import sys
import importlib.util
from orb_strategy import backtest_orb_strategy

# Explicitly import LOCAL config (not backend config)
_current_dir = os.path.dirname(os.path.abspath(__file__))
_config_path = os.path.join(_current_dir, 'config.py')
_spec = importlib.util.spec_from_file_location("orb_config", _config_path)
config = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(config)

logger = logging.getLogger(__name__)


def run_backtest(df: pd.DataFrame, orb_candle_number: int = 4) -> tuple:
    """Run ORB strategy backtest."""
    logger.info("=" * 60)
    orb_time = f"{orb_candle_number}th candle (10:00 AM)" if orb_candle_number == 4 else f"{orb_candle_number}th candle"
    logger.info(f"ORB Strategy Backtest - {orb_time} as ORB")
    logger.info("=" * 60)
    
    trades_df, results = backtest_orb_strategy(
        df,
        initial_balance=config.INITIAL_BALANCE,
        lot_size=config.LOT_SIZE,
        ema_period=config.EMA_PERIOD,
        orb_candle_number=orb_candle_number
    )
    
    # Print results
    logger.info("\n" + "=" * 60)
    logger.info("BACKTEST RESULTS")
    logger.info("=" * 60)
    logger.info(f"Total Trades: {results['total_trades']}")
    logger.info(f"Winning Trades: {results['winning_trades']}")
    logger.info(f"Losing Trades: {results['losing_trades']}")
    logger.info(f"Win Rate: {results['win_rate']:.2f}%")
    logger.info(f"Total P&L: ₹{results['total_pnl']:.2f}")
    logger.info(f"Final Balance: ₹{results['final_balance']:.2f}")
    logger.info(f"Cumulative Return: {results['cumulative_return']:.2f}%")
    logger.info(f"Average Win: ₹{results['avg_win']:.2f}")
    logger.info(f"Average Loss: ₹{results['avg_loss']:.2f}")
    logger.info(f"Profit Factor: {results['profit_factor']:.2f}")
    logger.info("=" * 60)
    
    return trades_df, results

