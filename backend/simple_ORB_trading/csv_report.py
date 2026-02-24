"""
Generate detailed CSV report for ORB trades
"""
import pandas as pd
import os
import datetime
import logging
import importlib.util

# Explicitly import LOCAL config (not backend config)
_current_dir = os.path.dirname(os.path.abspath(__file__))
_config_path = os.path.join(_current_dir, 'config.py')
_spec = importlib.util.spec_from_file_location("orb_config", _config_path)
config = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(config)

logger = logging.getLogger(__name__)


def generate_trade_report(trades_df: pd.DataFrame, output_dir: str = None) -> str:
    """
    Generate detailed CSV report with clear date/time for entry and exit.
    Includes summary analytics at the bottom.
    """
    if output_dir is None:
        output_dir = config.REPORTS_DIR
    
    os.makedirs(output_dir, exist_ok=True)
    
    if len(trades_df) == 0:
        logger.warning("No trades to report")
        return None
    
    # Add datetime columns only (no separate date/time)
    trades_df = trades_df.copy()
    trades_df['entry_datetime'] = pd.to_datetime(trades_df['entry_timestamp']).dt.strftime('%Y-%m-%d %H:%M:%S')
    trades_df['exit_datetime'] = pd.to_datetime(trades_df['exit_timestamp']).dt.strftime('%Y-%m-%d %H:%M:%S')
    trades_df['entry_date'] = pd.to_datetime(trades_df['entry_timestamp']).dt.date
    
    # Reorder columns for clarity
    columns = [
        'entry_datetime',
        'exit_datetime',
        'position_type', 'entry_price', 'exit_price',
        'pnl', 'pnl_pct', 'exit_reason',
        'entry_rsi', 'exit_rsi',  # NEW: Add RSI columns
        'exit_ema5',
        'orb_high', 'orb_low'
    ]
    
    report_df = trades_df[columns].copy()
    report_df = report_df.sort_values('entry_datetime').reset_index(drop=True)
    
    # Calculate summary statistics
    total_trades = len(report_df)
    winning_trades = len(report_df[report_df['pnl'] > 0])
    losing_trades = len(report_df[report_df['pnl'] < 0])
    breakeven_trades = len(report_df[report_df['pnl'] == 0])
    
    total_profit = report_df[report_df['pnl'] > 0]['pnl'].sum() if winning_trades > 0 else 0
    total_loss = abs(report_df[report_df['pnl'] < 0]['pnl'].sum()) if losing_trades > 0 else 0
    total_pnl = report_df['pnl'].sum()
    
    avg_win = report_df[report_df['pnl'] > 0]['pnl'].mean() if winning_trades > 0 else 0
    avg_loss = report_df[report_df['pnl'] < 0]['pnl'].mean() if losing_trades > 0 else 0
    profit_factor = abs(total_profit / total_loss) if total_loss > 0 else 0
    
    largest_win = report_df['pnl'].max()
    largest_loss = report_df['pnl'].min()
    
    win_rate = (winning_trades / total_trades * 100) if total_trades > 0 else 0
    
    # Calculate day-wise P&L
    daywise_pnl = trades_df.groupby('entry_date')['pnl'].sum().reset_index()
    daywise_pnl.columns = ['date', 'day_pnl']
    daywise_pnl = daywise_pnl.sort_values('date')
    
    profitable_days = len(daywise_pnl[daywise_pnl['day_pnl'] > 0])
    losing_days = len(daywise_pnl[daywise_pnl['day_pnl'] < 0])
    breakeven_days = len(daywise_pnl[daywise_pnl['day_pnl'] == 0])
    
    # Create summary rows
    summary_rows = []
    
    # Add separator
    summary_rows.append({
        'entry_datetime': '',
        'exit_datetime': '',
        'position_type': '',
        'entry_price': '',
        'exit_price': '',
        'pnl': '',
        'pnl_pct': '',
        'exit_reason': '',
        'entry_rsi': '',
        'exit_rsi': '',
        'exit_ema5': '',
        'orb_high': '',
        'orb_low': ''
    })
    
    # Overall Summary
    summary_rows.append({
        'entry_datetime': '=== OVERALL SUMMARY ===',
        'exit_datetime': '',
        'position_type': '',
        'entry_price': '',
        'exit_price': '',
        'pnl': '',
        'pnl_pct': '',
        'exit_reason': '',
        'entry_rsi': '',
        'exit_rsi': '',
        'exit_ema5': '',
        'orb_high': '',
        'orb_low': ''
    })
    
    summary_rows.append({
        'entry_datetime': 'Total Trades',
        'exit_datetime': str(total_trades),
        'position_type': '',
        'entry_price': '',
        'exit_price': '',
        'pnl': '',
        'pnl_pct': '',
        'exit_reason': '',
        'entry_rsi': '',
        'exit_rsi': '',
        'exit_ema5': '',
        'orb_high': '',
        'orb_low': ''
    })
    
    summary_rows.append({
        'entry_datetime': 'Winning Trades',
        'exit_datetime': str(winning_trades),
        'position_type': '',
        'entry_price': '',
        'exit_price': '',
        'pnl': '',
        'pnl_pct': '',
        'exit_reason': '',
        'entry_rsi': '',
        'exit_rsi': '',
        'exit_ema5': '',
        'orb_high': '',
        'orb_low': ''
    })
    
    summary_rows.append({
        'entry_datetime': 'Losing Trades',
        'exit_datetime': str(losing_trades),
        'position_type': '',
        'entry_price': '',
        'exit_price': '',
        'pnl': '',
        'pnl_pct': '',
        'exit_reason': '',
        'entry_rsi': '',
        'exit_rsi': '',
        'exit_ema5': '',
        'orb_high': '',
        'orb_low': ''
    })
    
    summary_rows.append({
        'entry_datetime': 'Breakeven Trades',
        'exit_datetime': str(breakeven_trades),
        'position_type': '',
        'entry_price': '',
        'exit_price': '',
        'pnl': '',
        'pnl_pct': '',
        'exit_reason': '',
        'entry_rsi': '',
        'exit_rsi': '',
        'exit_ema5': '',
        'orb_high': '',
        'orb_low': ''
    })
    
    summary_rows.append({
        'entry_datetime': 'Win Rate',
        'exit_datetime': f'{win_rate:.2f}%',
        'position_type': '',
        'entry_price': '',
        'exit_price': '',
        'pnl': '',
        'pnl_pct': '',
        'exit_reason': '',
        'entry_rsi': '',
        'exit_rsi': '',
        'exit_ema5': '',
        'orb_high': '',
        'orb_low': ''
    })
    
    summary_rows.append({
        'entry_datetime': 'Total Profit',
        'exit_datetime': f'{total_profit:.2f}',
        'position_type': '',
        'entry_price': '',
        'exit_price': '',
        'pnl': '',
        'pnl_pct': '',
        'exit_reason': '',
        'entry_rsi': '',
        'exit_rsi': '',
        'exit_ema5': '',
        'orb_high': '',
        'orb_low': ''
    })
    
    summary_rows.append({
        'entry_datetime': 'Total Loss',
        'exit_datetime': f'{total_loss:.2f}',
        'position_type': '',
        'entry_price': '',
        'exit_price': '',
        'pnl': '',
        'pnl_pct': '',
        'exit_reason': '',
        'entry_rsi': '',
        'exit_rsi': '',
        'exit_ema5': '',
        'orb_high': '',
        'orb_low': ''
    })
    
    summary_rows.append({
        'entry_datetime': 'Net P&L',
        'exit_datetime': f'{total_pnl:.2f}',
        'position_type': '',
        'entry_price': '',
        'exit_price': '',
        'pnl': '',
        'pnl_pct': '',
        'exit_reason': '',
        'entry_rsi': '',
        'exit_rsi': '',
        'exit_ema5': '',
        'orb_high': '',
        'orb_low': ''
    })
    
    summary_rows.append({
        'entry_datetime': 'Average Win',
        'exit_datetime': f'{avg_win:.2f}',
        'position_type': '',
        'entry_price': '',
        'exit_price': '',
        'pnl': '',
        'pnl_pct': '',
        'exit_reason': '',
        'entry_rsi': '',
        'exit_rsi': '',
        'exit_ema5': '',
        'orb_high': '',
        'orb_low': ''
    })
    
    summary_rows.append({
        'entry_datetime': 'Average Loss',
        'exit_datetime': f'{avg_loss:.2f}',
        'position_type': '',
        'entry_price': '',
        'exit_price': '',
        'pnl': '',
        'pnl_pct': '',
        'exit_reason': '',
        'entry_rsi': '',
        'exit_rsi': '',
        'exit_ema5': '',
        'orb_high': '',
        'orb_low': ''
    })
    
    summary_rows.append({
        'entry_datetime': 'Profit Factor',
        'exit_datetime': f'{profit_factor:.2f}',
        'position_type': '',
        'entry_price': '',
        'exit_price': '',
        'pnl': '',
        'pnl_pct': '',
        'exit_reason': '',
        'entry_rsi': '',
        'exit_rsi': '',
        'exit_ema5': '',
        'orb_high': '',
        'orb_low': ''
    })
    
    summary_rows.append({
        'entry_datetime': 'Largest Win',
        'exit_datetime': f'{largest_win:.2f}',
        'position_type': '',
        'entry_price': '',
        'exit_price': '',
        'pnl': '',
        'pnl_pct': '',
        'exit_reason': '',
        'entry_rsi': '',
        'exit_rsi': '',
        'exit_ema5': '',
        'orb_high': '',
        'orb_low': ''
    })
    
    summary_rows.append({
        'entry_datetime': 'Largest Loss',
        'exit_datetime': f'{largest_loss:.2f}',
        'position_type': '',
        'entry_price': '',
        'exit_price': '',
        'pnl': '',
        'pnl_pct': '',
        'exit_reason': '',
        'entry_rsi': '',
        'exit_rsi': '',
        'exit_ema5': '',
        'orb_high': '',
        'orb_low': ''
    })
    
    # Day-wise Summary
    summary_rows.append({
        'entry_datetime': '',
        'exit_datetime': '',
        'position_type': '',
        'entry_price': '',
        'exit_price': '',
        'pnl': '',
        'pnl_pct': '',
        'exit_reason': '',
        'entry_rsi': '',
        'exit_rsi': '',
        'exit_ema5': '',
        'orb_high': '',
        'orb_low': ''
    })
    
    summary_rows.append({
        'entry_datetime': '=== DAY-WISE SUMMARY ===',
        'exit_datetime': '',
        'position_type': '',
        'entry_price': '',
        'exit_price': '',
        'pnl': '',
        'pnl_pct': '',
        'exit_reason': '',
        'entry_rsi': '',
        'exit_rsi': '',
        'exit_ema5': '',
        'orb_high': '',
        'orb_low': ''
    })
    
    summary_rows.append({
        'entry_datetime': 'Date',
        'exit_datetime': 'Day P&L',
        'position_type': '',
        'entry_price': '',
        'exit_price': '',
        'pnl': '',
        'pnl_pct': '',
        'exit_reason': '',
        'entry_rsi': '',
        'exit_rsi': '',
        'exit_ema5': '',
        'orb_high': '',
        'orb_low': ''
    })
    
    # Add day-wise P&L rows
    for _, day_row in daywise_pnl.iterrows():
        summary_rows.append({
            'entry_datetime': str(day_row['date']),
            'exit_datetime': f'{day_row["day_pnl"]:.2f}',
            'position_type': '',
            'entry_price': '',
            'exit_price': '',
            'pnl': '',
            'pnl_pct': '',
            'exit_reason': '',
            'exit_ema5': '',
            'orb_high': '',
            'orb_low': ''
        })
    
    summary_rows.append({
        'entry_datetime': '',
        'exit_datetime': '',
        'position_type': '',
        'entry_price': '',
        'exit_price': '',
        'pnl': '',
        'pnl_pct': '',
        'exit_reason': '',
        'entry_rsi': '',
        'exit_rsi': '',
        'exit_ema5': '',
        'orb_high': '',
        'orb_low': ''
    })
    
    summary_rows.append({
        'entry_datetime': 'Profitable Days',
        'exit_datetime': str(profitable_days),
        'position_type': '',
        'entry_price': '',
        'exit_price': '',
        'pnl': '',
        'pnl_pct': '',
        'exit_reason': '',
        'entry_rsi': '',
        'exit_rsi': '',
        'exit_ema5': '',
        'orb_high': '',
        'orb_low': ''
    })
    
    summary_rows.append({
        'entry_datetime': 'Losing Days',
        'exit_datetime': str(losing_days),
        'position_type': '',
        'entry_price': '',
        'exit_price': '',
        'pnl': '',
        'pnl_pct': '',
        'exit_reason': '',
        'entry_rsi': '',
        'exit_rsi': '',
        'exit_ema5': '',
        'orb_high': '',
        'orb_low': ''
    })
    
    summary_rows.append({
        'entry_datetime': 'Breakeven Days',
        'exit_datetime': str(breakeven_days),
        'position_type': '',
        'entry_price': '',
        'exit_price': '',
        'pnl': '',
        'pnl_pct': '',
        'exit_reason': '',
        'entry_rsi': '',
        'exit_rsi': '',
        'exit_ema5': '',
        'orb_high': '',
        'orb_low': ''
    })
    
    # Convert summary rows to DataFrame and append
    summary_df = pd.DataFrame(summary_rows)
    final_df = pd.concat([report_df, summary_df], ignore_index=True)
    
    # Generate filename
    timestamp_str = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f"orb_trade_report_{timestamp_str}.csv"
    filepath = os.path.join(output_dir, filename)
    
    # Export with UTF-8-sig encoding for better Excel compatibility
    final_df.to_csv(filepath, index=False, encoding='utf-8-sig')
    
    logger.info(f"✓ Trade report exported: {filepath}")
    logger.info(f"  Total Trades: {len(report_df)}")
    logger.info(f"  Summary analytics added at bottom")
    
    return filepath

