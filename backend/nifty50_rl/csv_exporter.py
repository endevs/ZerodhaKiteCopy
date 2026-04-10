"""
CSV Export module for detailed trade reports
"""
import logging
import pandas as pd
import os
import datetime
from typing import Dict, Any, List, Optional
# Import config from local nifty50_rl package
import sys
import importlib.util
_current_dir = os.path.dirname(os.path.abspath(__file__))
_config_path = os.path.join(_current_dir, 'config.py')
spec = importlib.util.spec_from_file_location("nifty50_rl_config", _config_path)
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)

logger = logging.getLogger(__name__)


def export_trade_report(
    raw_data: pd.DataFrame,
    processed_data: pd.DataFrame,
    trade_history: List[Dict[str, Any]],
    portfolio_history: List[float],
    results: Dict[str, Any],
    output_dir: Optional[str] = None,
    test_data_start_idx: int = 0
) -> str:
    """
    Export comprehensive trade report to CSV.
    
    Args:
        raw_data: Raw OHLC data from Zerodha
        processed_data: Processed data with indicators
        trade_history: List of executed trades
        portfolio_history: Portfolio value over time
        results: Evaluation results dictionary
        output_dir: Optional output directory (default: reports/ in nifty50_rl)
    
    Returns:
        Path to exported CSV file
    """
    logger.info("Generating detailed trade report CSV...")
    
    # Create reports directory
    if output_dir is None:
        output_dir = os.path.join(os.path.dirname(__file__), 'reports')
    os.makedirs(output_dir, exist_ok=True)
    
    # Start with processed data (has indicators)
    report_df = processed_data.copy()
    
    # Add raw OHLC if not already present (use original close for prices)
    if '_orig_close' in report_df.columns:
        report_df['close'] = report_df['_orig_close']
        # Estimate open, high, low from normalized values if needed
        if 'open_norm' in report_df.columns:
            price_min = report_df['close'].min()
            price_max = report_df['close'].max()
            price_range = price_max - price_min if price_max > price_min else 1
            
            if 'open' not in report_df.columns:
                report_df['open'] = price_min + report_df['open_norm'] * price_range
            if 'high' not in report_df.columns:
                report_df['high'] = price_min + report_df['high_norm'] * price_range
            if 'low' not in report_df.columns:
                report_df['low'] = price_min + report_df['low_norm'] * price_range
    
    # Ensure we have timestamp
    if 'timestamp' not in report_df.columns and 'date' in report_df.columns:
        report_df['timestamp'] = pd.to_datetime(report_df['date'])
    
    # Initialize trade action columns
    report_df['trade_action'] = 'NONE'
    report_df['entry_price'] = None
    report_df['exit_price'] = None
    report_df['pnl'] = None
    report_df['pnl_pct'] = None
    report_df['action_reason'] = ''
    report_df['portfolio_value'] = None
    report_df['position_type'] = None
    
    # Map trades to dataframe rows
    # CRITICAL: Entry and Exit must be in separate rows
    for trade in trade_history:
        entry_idx = trade.get('entry_index')
        exit_idx = trade.get('exit_index')
        entry_price = trade.get('entry_price')
        exit_price = trade.get('exit_price')
        pnl = trade.get('pnl', 0)
        pnl_pct = trade.get('pnl_pct', 0)
        position_type = trade.get('position_type', 'long')
        
        # Adjust indices if trades are from test data
        adjusted_entry_idx = entry_idx + test_data_start_idx if entry_idx is not None else None
        adjusted_exit_idx = exit_idx + test_data_start_idx if exit_idx is not None else None
        
        # ENTRY ROW: Only entry information
        if adjusted_entry_idx is not None and 0 <= adjusted_entry_idx < len(report_df):
            entry_row = report_df.iloc[adjusted_entry_idx]
            actual_entry_price = float(entry_row['close'])
            
            report_df.iloc[adjusted_entry_idx, report_df.columns.get_loc('trade_action')] = 'ENTRY'
            report_df.iloc[adjusted_entry_idx, report_df.columns.get_loc('entry_price')] = actual_entry_price
            report_df.iloc[adjusted_entry_idx, report_df.columns.get_loc('position_type')] = position_type
            report_df.iloc[adjusted_entry_idx, report_df.columns.get_loc('action_reason')] = _generate_entry_reason(
                entry_row, actual_entry_price, position_type
            )
            # Clear exit fields at entry
            report_df.iloc[adjusted_entry_idx, report_df.columns.get_loc('exit_price')] = None
            report_df.iloc[adjusted_entry_idx, report_df.columns.get_loc('pnl')] = None
            report_df.iloc[adjusted_entry_idx, report_df.columns.get_loc('pnl_pct')] = None
        
        # EXIT ROW: Only exit information (must be different row)
        if adjusted_exit_idx is not None and 0 <= adjusted_exit_idx < len(report_df):
            # If exit is same as entry, move to next candle (or previous if at start)
            if adjusted_exit_idx == adjusted_entry_idx:
                # Move exit to next candle if possible
                if adjusted_exit_idx + 1 < len(report_df):
                    adjusted_exit_idx = adjusted_exit_idx + 1
                elif adjusted_exit_idx > 0:
                    adjusted_exit_idx = adjusted_exit_idx - 1
            
            exit_row = report_df.iloc[adjusted_exit_idx]
            actual_exit_price = float(exit_row['close'])
            
            # Only set exit if this row doesn't already have an entry
            current_action = report_df.iloc[adjusted_exit_idx, report_df.columns.get_loc('trade_action')]
            if current_action != 'ENTRY':
                report_df.iloc[adjusted_exit_idx, report_df.columns.get_loc('trade_action')] = 'EXIT'
            else:
                # If same row has entry, mark as both
                report_df.iloc[adjusted_exit_idx, report_df.columns.get_loc('trade_action')] = 'ENTRY_EXIT'
            
            report_df.iloc[adjusted_exit_idx, report_df.columns.get_loc('exit_price')] = actual_exit_price
            report_df.iloc[adjusted_exit_idx, report_df.columns.get_loc('pnl')] = pnl
            report_df.iloc[adjusted_exit_idx, report_df.columns.get_loc('pnl_pct')] = pnl_pct
            report_df.iloc[adjusted_exit_idx, report_df.columns.get_loc('action_reason')] = _generate_exit_reason(
                exit_row, actual_exit_price, pnl, pnl_pct, position_type
            )
            # Clear entry fields at exit (if not same row)
            if adjusted_exit_idx != adjusted_entry_idx:
                report_df.iloc[adjusted_exit_idx, report_df.columns.get_loc('entry_price')] = None
    
    # Add portfolio value history
    if portfolio_history and len(portfolio_history) == len(report_df):
        report_df['portfolio_value'] = portfolio_history
    elif portfolio_history:
        # Interpolate if lengths don't match
        import numpy as np
        portfolio_array = np.interp(
            np.arange(len(report_df)),
            np.linspace(0, len(report_df) - 1, len(portfolio_history)),
            portfolio_history
        )
        report_df['portfolio_value'] = portfolio_array
    
    # Select and reorder columns for final report
    columns_to_include = [
        'timestamp', 'open', 'high', 'low', 'close', 'volume',
        'rsi', 'ema5', 'ema12', 'vwap', 'atr', 'adx',
        'trade_action', 'position_type', 'entry_price', 'exit_price', 
        'pnl', 'pnl_pct', 'action_reason', 'portfolio_value'
    ]
    
    # Only include columns that exist
    available_columns = [col for col in columns_to_include if col in report_df.columns]
    final_df = report_df[available_columns].copy()
    
    # Sort by timestamp
    if 'timestamp' in final_df.columns:
        final_df = final_df.sort_values('timestamp').reset_index(drop=True)
    
    # Generate filename with timestamp
    timestamp_str = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f"banknifty_trade_report_{timestamp_str}.csv"
    filepath = os.path.join(output_dir, filename)
    
    # Export to CSV
    final_df.to_csv(filepath, index=False, encoding='utf-8')
    
    # Generate summary
    total_rows = len(final_df)
    date_from = final_df['timestamp'].min() if 'timestamp' in final_df.columns else 'N/A'
    date_to = final_df['timestamp'].max() if 'timestamp' in final_df.columns else 'N/A'
    total_trades = len(trade_history)
    
    logger.info(f"✓ Trade report exported: {filepath}")
    logger.info(f"  Total Data Points: {total_rows}")
    logger.info(f"  Date Range: {date_from} to {date_to}")
    logger.info(f"  Total Trades: {total_trades}")
    
    return filepath


def _generate_entry_reason(row: pd.Series, entry_price: float, position_type: str) -> str:
    """Generate detailed reason for trade entry using actual indicators."""
    reasons = []
    
    # Get indicators
    rsi = row.get('rsi', 50)
    ema5 = row.get('ema5', entry_price)
    ema12 = row.get('ema12', entry_price)
    vwap = row.get('vwap', entry_price)
    adx = row.get('adx', 0)
    plus_di = row.get('plus_di', 0)
    minus_di = row.get('minus_di', 0)
    close = row.get('close', entry_price)
    
    # Position type
    pos_label = "LONG" if position_type == 'long' else "SHORT"
    reasons.append(f"Entering {pos_label} position")
    
    # RSI signals
    if rsi < 30:
        reasons.append(f"RSI oversold ({rsi:.1f}) - potential bottom")
    elif rsi > 70:
        reasons.append(f"RSI overbought ({rsi:.1f}) - potential top")
    else:
        reasons.append(f"RSI neutral ({rsi:.1f})")
    
    # EMA crossover
    if ema5 > ema12:
        reasons.append("EMA5 > EMA12 (bullish crossover)")
    elif ema5 < ema12:
        reasons.append("EMA5 < EMA12 (bearish crossover)")
    
    # Price vs VWAP
    price_vs_vwap_pct = ((close - vwap) / vwap * 100) if vwap > 0 else 0
    if price_vs_vwap_pct > 0.5:
        reasons.append(f"Price {price_vs_vwap_pct:.2f}% above VWAP - potential top")
    elif price_vs_vwap_pct < -0.5:
        reasons.append(f"Price {abs(price_vs_vwap_pct):.2f}% below VWAP - potential bottom")
    else:
        reasons.append(f"Price near VWAP ({price_vs_vwap_pct:.2f}%)")
    
    # ADX trend strength
    if adx > 25:
        if plus_di > minus_di:
            reasons.append(f"Strong uptrend (ADX={adx:.1f}, +DI > -DI)")
        elif minus_di > plus_di:
            reasons.append(f"Strong downtrend (ADX={adx:.1f}, -DI > +DI)")
    else:
        reasons.append(f"Weak trend (ADX={adx:.1f})")
    
    if not reasons:
        reasons.append("RL agent signal")
    
    return " | ".join(reasons)


def _generate_exit_reason(row: pd.Series, exit_price: float, pnl: float, pnl_pct: float, position_type: str) -> str:
    """Generate detailed reason for trade exit."""
    reasons = []
    
    # PnL information
    if pnl > 0:
        reasons.append(f"PROFIT: +₹{pnl:.2f} (+{pnl_pct:.2f}%)")
    elif pnl < 0:
        reasons.append(f"LOSS: ₹{pnl:.2f} ({pnl_pct:.2f}%)")
    else:
        reasons.append("BREAKEVEN")
    
    # Position type
    pos_label = "LONG" if position_type == 'long' else "SHORT"
    reasons.append(f"Exiting {pos_label} position")
    
    # Get indicators
    rsi = row.get('rsi', 50)
    ema5 = row.get('ema5', exit_price)
    ema12 = row.get('ema12', exit_price)
    vwap = row.get('vwap', exit_price)
    adx = row.get('adx', 0)
    close = row.get('close', exit_price)
    
    # Exit signals
    if position_type == 'long':
        # For long positions, exit if overbought or price too high
        if rsi > 70:
            reasons.append("RSI overbought - exit signal")
        price_vs_vwap_pct = ((close - vwap) / vwap * 100) if vwap > 0 else 0
        if price_vs_vwap_pct > 1.0:
            reasons.append(f"Price {price_vs_vwap_pct:.2f}% above VWAP - taking profit")
        if ema5 < ema12:
            reasons.append("EMA5 < EMA12 - bearish crossover - exit")
    else:  # short position
        # For short positions, exit if oversold or price too low
        if rsi < 30:
            reasons.append("RSI oversold - exit signal")
        price_vs_vwap_pct = ((close - vwap) / vwap * 100) if vwap > 0 else 0
        if price_vs_vwap_pct < -1.0:
            reasons.append(f"Price {abs(price_vs_vwap_pct):.2f}% below VWAP - taking profit")
        if ema5 > ema12:
            reasons.append("EMA5 > EMA12 - bullish crossover - exit")
    
    reasons.append("RL agent exit decision")
    
    return " | ".join(reasons)

