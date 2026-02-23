"""
ORB (Opening Range Breakout) Strategy Implementation

Strategy Rules:
1. ORB Candle: 4th 15-minute candle (10:00 AM)
2. SELL Entry: Candle closes BELOW ORB low
3. BUY Entry: Candle closes ABOVE ORB high
4. SELL Exit: 2 consecutive candles close ABOVE EMA5
5. BUY Exit: 2 consecutive candles close BELOW EMA5
"""
import pandas as pd
import numpy as np
import logging
from typing import Dict, List, Optional, Tuple
from datetime import time

logger = logging.getLogger(__name__)


def calculate_ema(data: pd.Series, period: int) -> pd.Series:
    """Calculate Exponential Moving Average."""
    return data.ewm(span=period, adjust=False).mean()


def identify_orb_candle(df: pd.DataFrame, orb_candle_number: int = 4) -> pd.DataFrame:
    """
    Identify ORB candle for each trading day.
    
    Args:
        df: DataFrame with timestamp column
        orb_candle_number: Which candle to use as ORB (4 = 4th candle at 10:00 AM)
                          Candle sequence: 1st (9:15 AM), 2nd (9:30 AM), 3rd (9:45 AM), 4th (10:00 AM)
    
    Returns:
        DataFrame with 'is_orb' column
    """
    df = df.copy()
    df['date'] = df['timestamp'].dt.date
    df['time'] = df['timestamp'].dt.time
    df['is_orb'] = False
    
    # Group by date and mark the specified candle number
    for date, group in df.groupby('date'):
        # Sort by timestamp to get candles in order
        day_candles = group.sort_values('timestamp')
        
        # Select the nth candle (4th = index 3, since index starts at 0)
        # 1st candle: 9:15 AM (index 0)
        # 2nd candle: 9:30 AM (index 1)
        # 3rd candle: 9:45 AM (index 2)
        # 4th candle: 10:00 AM (index 3)
        if len(day_candles) >= orb_candle_number:
            orb_idx = day_candles.index[orb_candle_number - 1]  # -1 because index starts at 0
            df.loc[orb_idx, 'is_orb'] = True
    
    return df


def backtest_orb_strategy(
    df: pd.DataFrame,
    initial_balance: float = 100000.0,
    lot_size: int = 15,
    ema_period: int = 5,
    orb_candle_number: int = 4  # 4th candle (10:00 AM) as ORB
) -> Tuple[pd.DataFrame, Dict]:
    """
    Backtest ORB strategy on historical data.
    
    Args:
        orb_candle_number: Which candle to use as ORB (4 = 10:00 AM)
    
    Returns:
        (trades_df, results_dict)
    """
    df = df.copy()
    df = identify_orb_candle(df, orb_candle_number=orb_candle_number)
    
    # Calculate EMA5
    df['ema5'] = calculate_ema(df['close'], ema_period)
    
    # Initialize trading state
    current_position = None  # 'BUY' or 'SELL' or None
    entry_price = None
    entry_index = None
    entry_timestamp = None
    orb_high = None
    orb_low = None
    orb_date = None
    
    # Track consecutive candles for exit
    consecutive_above_ema = 0
    consecutive_below_ema = 0
    
    trades = []
    balance = initial_balance
    
    # Process each candle
    for idx, row in df.iterrows():
        timestamp = row['timestamp']
        close = row['close']
        high = row['high']
        low = row['low']
        ema5 = row['ema5']
        is_orb = row['is_orb']
        current_date = timestamp.date()
        
        # CRITICAL: Close any open position when a new trading day starts
        # This ensures no position carries over to the next day (intraday only)
        if orb_date is not None and current_date != orb_date and current_position is not None:
            # Force close position from previous day
            # Use previous candle's close price (get from previous row)
            if idx > 0:
                prev_row = df.iloc[idx - 1]
                prev_close = prev_row['close']
                prev_timestamp = prev_row['timestamp']
                
                if current_position == 'SELL':
                    pnl = (entry_price - prev_close) * lot_size
                else:  # BUY
                    pnl = (prev_close - entry_price) * lot_size
                
                balance += pnl
                pnl_pct = (pnl / (entry_price * lot_size)) * 100
                
                trades.append({
                    'entry_timestamp': entry_timestamp,
                    'exit_timestamp': prev_timestamp,  # Exit at last candle of previous day
                    'entry_price': entry_price,
                    'exit_price': prev_close,
                    'position_type': current_position,
                    'pnl': pnl,
                    'pnl_pct': pnl_pct,
                    'exit_reason': 'End of day (market close)',
                    'orb_high': orb_high,
                    'orb_low': orb_low,
                    'exit_ema5': prev_row.get('ema5', ema5)
                })
                
                logger.info(
                    f"[EXIT] {current_position} at ₹{prev_close:.2f} | "
                    f"Entry: ₹{entry_price:.2f} | "
                    f"PnL: ₹{pnl:.2f} ({pnl_pct:+.2f}%) | "
                    f"Reason: End of day (market close) | "
                    f"EMA5: ₹{prev_row.get('ema5', ema5):.2f}"
                )
                
                # Reset position
                current_position = None
                entry_price = None
                entry_index = None
                entry_timestamp = None
                consecutive_above_ema = 0
                consecutive_below_ema = 0
        
        # Reset ORB at start of new day (after closing position if any)
        if orb_date is None or current_date != orb_date:
            orb_high = None
            orb_low = None
            orb_date = current_date
            consecutive_above_ema = 0
            consecutive_below_ema = 0
        
        # Identify ORB candle
        if is_orb:
            orb_high = high
            orb_low = low
            logger.debug(f"ORB identified: High={orb_high:.2f}, Low={orb_low:.2f} at {timestamp}")
            continue  # No trading during ORB candle
        
        # Skip if no ORB defined for this day
        if orb_high is None or orb_low is None:
            continue
        
        # Check exit conditions first (if position exists)
        if current_position is not None:
            # Check for exit signals
            exit_triggered = False
            exit_reason = ""
            
            if current_position == 'SELL':
                # SELL exit: 2 consecutive candles close ABOVE EMA5
                # Check current candle first
                if close > ema5:
                    consecutive_above_ema += 1
                    consecutive_below_ema = 0
                else:
                    consecutive_above_ema = 0
                
                # Exit IMMEDIATELY when condition is satisfied (don't wait for next candle)
                if consecutive_above_ema >= 2:
                    exit_triggered = True
                    exit_reason = "2 consecutive candles above EMA5"
            
            elif current_position == 'BUY':
                # BUY exit: 2 consecutive candles close BELOW EMA5
                # Check current candle first
                if close < ema5:
                    consecutive_below_ema += 1
                    consecutive_above_ema = 0
                else:
                    consecutive_below_ema = 0
                
                # Exit IMMEDIATELY when condition is satisfied (don't wait for next candle)
                if consecutive_below_ema >= 2:
                    exit_triggered = True
                    exit_reason = "2 consecutive candles below EMA5"
            
            # Force close at end of day (3:25 PM) - Close any open position at 15:25
            if timestamp.hour == 15 and timestamp.minute >= 25:
                if not exit_triggered:
                    exit_triggered = True
                    exit_reason = "End of day (market close 3:25 PM)"
            
            # Execute exit IMMEDIATELY when condition is met
            if exit_triggered:
                if current_position == 'SELL':
                    pnl = (entry_price - close) * lot_size
                else:  # BUY
                    pnl = (close - entry_price) * lot_size
                
                balance += pnl
                pnl_pct = (pnl / (entry_price * lot_size)) * 100
                
                # Get EMA5 value at exit for CSV report
                exit_ema5 = ema5
                
                trades.append({
                    'entry_timestamp': entry_timestamp,
                    'exit_timestamp': timestamp,  # Exit at current candle (immediate)
                    'entry_price': entry_price,
                    'exit_price': close,
                    'position_type': current_position,
                    'pnl': pnl,
                    'pnl_pct': pnl_pct,
                    'exit_reason': exit_reason,
                    'orb_high': orb_high,
                    'orb_low': orb_low,
                    'exit_ema5': exit_ema5  # Add EMA5 at exit
                })
                
                logger.info(
                    f"[EXIT] {current_position} at ₹{close:.2f} | "
                    f"Entry: ₹{entry_price:.2f} | "
                    f"PnL: ₹{pnl:.2f} ({pnl_pct:+.2f}%) | "
                    f"Reason: {exit_reason} | "
                    f"EMA5: ₹{ema5:.2f}"
                )
                
                # Reset position IMMEDIATELY
                current_position = None
                entry_price = None
                entry_index = None
                entry_timestamp = None
                consecutive_above_ema = 0
                consecutive_below_ema = 0
                
                # Continue to next iteration (don't check entry conditions for this candle)
                continue
        
        # Check entry conditions (only if no position)
        if current_position is None:
            # SELL Entry: Candle closes BELOW ORB low AND candle high must have touched/gone above ORB low
            # This ensures the candle actually broke through the ORB range
            if close < orb_low and high > orb_low:
                current_position = 'SELL'
                entry_price = close
                entry_index = idx
                entry_timestamp = timestamp
                consecutive_above_ema = 0
                consecutive_below_ema = 0
                
                logger.info(
                    f"[ENTRY] SELL SHORT at ₹{close:.2f} | "
                    f"ORB Low: ₹{orb_low:.2f} | "
                    f"Candle High: ₹{high:.2f} (touched ORB range)"
                )
            
            # BUY Entry: Candle closes ABOVE ORB high AND candle low must have touched/gone below ORB high
            # This ensures the candle actually broke through the ORB range
            elif close > orb_high and low < orb_high:
                current_position = 'BUY'
                entry_price = close
                entry_index = idx
                entry_timestamp = timestamp
                consecutive_above_ema = 0
                consecutive_below_ema = 0
                
                logger.info(
                    f"[ENTRY] BUY LONG at ₹{close:.2f} | "
                    f"ORB High: ₹{orb_high:.2f} | "
                    f"Candle Low: ₹{low:.2f} (touched ORB range)"
                )
    
    # Close any open position at end
    if current_position is not None:
        last_row = df.iloc[-1]
        if current_position == 'SELL':
            pnl = (entry_price - last_row['close']) * lot_size
        else:
            pnl = (last_row['close'] - entry_price) * lot_size
        
        balance += pnl
        pnl_pct = (pnl / (entry_price * lot_size)) * 100
        
        trades.append({
            'entry_timestamp': entry_timestamp,
            'exit_timestamp': last_row['timestamp'],
            'entry_price': entry_price,
            'exit_price': last_row['close'],
            'position_type': current_position,
            'pnl': pnl,
            'pnl_pct': pnl_pct,
            'exit_reason': 'End of data',
            'orb_high': orb_high,
            'orb_low': orb_low
        })
    
    # Create trades DataFrame
    trades_df = pd.DataFrame(trades)
    
    # Calculate results
    if len(trades_df) > 0:
        total_trades = len(trades_df)
        winning_trades = len(trades_df[trades_df['pnl'] > 0])
        losing_trades = len(trades_df[trades_df['pnl'] < 0])
        win_rate = (winning_trades / total_trades) * 100 if total_trades > 0 else 0
        
        total_pnl = trades_df['pnl'].sum()
        avg_win = trades_df[trades_df['pnl'] > 0]['pnl'].mean() if winning_trades > 0 else 0
        avg_loss = trades_df[trades_df['pnl'] < 0]['pnl'].mean() if losing_trades > 0 else 0
        
        cumulative_return = ((balance - initial_balance) / initial_balance) * 100
        
        results = {
            'total_trades': total_trades,
            'winning_trades': winning_trades,
            'losing_trades': losing_trades,
            'win_rate': win_rate,
            'total_pnl': total_pnl,
            'final_balance': balance,
            'cumulative_return': cumulative_return,
            'avg_win': avg_win,
            'avg_loss': avg_loss,
            'profit_factor': abs(avg_win / avg_loss) if avg_loss != 0 else 0
        }
    else:
        results = {
            'total_trades': 0,
            'winning_trades': 0,
            'losing_trades': 0,
            'win_rate': 0,
            'total_pnl': 0,
            'final_balance': initial_balance,
            'cumulative_return': 0,
            'avg_win': 0,
            'avg_loss': 0,
            'profit_factor': 0
        }
    
    return trades_df, results

