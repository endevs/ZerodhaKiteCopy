"""
Indicator Calculations
EMA5 and RSI14 calculations
"""
import pandas as pd
import numpy as np
from typing import List, Optional


def calculate_ema(data: pd.Series, period: int) -> pd.Series:
    """
    Calculate Exponential Moving Average (EMA)
    
    Args:
        data: Series of closing prices
        period: EMA period (default: 5 for EMA5)
    
    Returns:
        Series of EMA values
    """
    if len(data) == 0:
        return pd.Series([], dtype=float)
    
    return data.ewm(span=period, adjust=False).mean()


def calculate_rsi(data: pd.Series, period: int = 14) -> pd.Series:
    """
    Calculate Relative Strength Index (RSI)
    
    Args:
        data: Series of closing prices
        period: RSI period (default: 14)
    
    Returns:
        Series of RSI values (0-100)
    """
    if len(data) < period + 1:
        return pd.Series([np.nan] * len(data), dtype=float)
    
    delta = data.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    
    return rsi


def calculate_indicators(df: pd.DataFrame, ema_period: int = 5, rsi_period: int = 14) -> pd.DataFrame:
    """
    Calculate all indicators for a DataFrame
    
    Args:
        df: DataFrame with 'close' column
        ema_period: EMA period (default: 5)
        rsi_period: RSI period (default: 14)
    
    Returns:
        DataFrame with 'ema' and 'rsi' columns added
    """
    # #region agent log - DISABLED for performance
    # DEBUG_LOGGING = False  # Set to True only when debugging
    # if DEBUG_LOGGING:
    #     import json
    #     import os
    #     from datetime import datetime
    #     try:
    #         log_dir = r'd:\WorkSpace\ZerodhaKiteGit\.cursor'
    #         os.makedirs(log_dir, exist_ok=True)
    #         log_file = os.path.join(log_dir, 'debug.log')
    #         with open(log_file, 'a', encoding='utf-8') as f:
    #             f.write(json.dumps({'location': 'indicators.py:calculate_indicators', 'message': 'calculating indicators', 'data': {'df_length': len(df), 'has_close': 'close' in df.columns, 'ema_period': ema_period, 'rsi_period': rsi_period}, 'timestamp': int(datetime.now().timestamp() * 1000), 'sessionId': 'debug-session', 'runId': 'run1', 'hypothesisId': 'H1'}) + '\n')
    #     except Exception as e:
    #         pass
    # #endregion
    
    df = df.copy()
    
    if 'close' not in df.columns:
        raise ValueError("DataFrame must have 'close' column")
    
    df['ema'] = calculate_ema(df['close'], ema_period)
    df['rsi'] = calculate_rsi(df['close'], rsi_period)
    
    # #region agent log - DISABLED for performance
    # if DEBUG_LOGGING:
    #     try:
    #         ema_valid = df['ema'].notna().sum()
    #         rsi_valid = df['rsi'].notna().sum()
    #         ema_first_10 = df['ema'].head(10).tolist()
    #         rsi_first_10 = df['rsi'].head(10).tolist()
    #         log_file = os.path.join(r'd:\WorkSpace\ZerodhaKiteGit\.cursor', 'debug.log')
    #         with open(log_file, 'a', encoding='utf-8') as f:
    #             f.write(json.dumps({'location': 'indicators.py:calculate_indicators', 'message': 'indicators calculated', 'data': {'ema_valid_count': int(ema_valid), 'rsi_valid_count': int(rsi_valid), 'ema_first_10': ema_first_10, 'rsi_first_10': rsi_first_10}, 'timestamp': int(datetime.now().timestamp() * 1000), 'sessionId': 'debug-session', 'runId': 'run1', 'hypothesisId': 'H1'}) + '\n')
    #     except Exception as e:
    #         pass
    # #endregion
    
    return df
