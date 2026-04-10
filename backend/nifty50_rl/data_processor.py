"""
Data processing: cleaning, normalization, indicators, and train/test split
"""
import logging
import pandas as pd
import numpy as np
from typing import Tuple
import sys
import os

# Add parent directory to path
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)
from utils.indicators import (
    calculate_rsi, calculate_ema, calculate_macd, 
    calculate_stochastic, calculate_atr, calculate_vwap, calculate_adx
)
# Import config from local nifty50_rl package
import sys
import os
import importlib.util
_current_dir = os.path.dirname(os.path.abspath(__file__))
_config_path = os.path.join(_current_dir, 'config.py')
spec = importlib.util.spec_from_file_location("nifty50_rl_config", _config_path)
nifty_config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nifty_config)

logger = logging.getLogger(__name__)


def process_raw_data(df: pd.DataFrame) -> pd.DataFrame:
    """
    Clean and validate OHLC data.
    
    Args:
        df: Raw DataFrame with OHLC data
    
    Returns:
        Cleaned DataFrame
    """
    logger.info("Processing raw data...")
    
    # Remove duplicates
    initial_len = len(df)
    df = df.drop_duplicates(subset=['timestamp']).reset_index(drop=True)
    if len(df) < initial_len:
        logger.info(f"  Removed {initial_len - len(df)} duplicate rows")
    
    # Handle missing values
    df = df.ffill().bfill()
    
    # Remove outliers using 3-sigma rule
    for col in ['open', 'high', 'low', 'close']:
        mean = df[col].mean()
        std = df[col].std()
        lower_bound = mean - 3 * std
        upper_bound = mean + 3 * std
        outliers = ((df[col] < lower_bound) | (df[col] > upper_bound)).sum()
        if outliers > 0:
            logger.warning(f"  Found {outliers} outliers in {col}, clipping...")
            df[col] = df[col].clip(lower=lower_bound, upper=upper_bound)
    
    logger.info(f"✓ Processed {len(df)} candles")
    return df


def calculate_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """
    Calculate comprehensive technical indicators for RL observation space.
    
    Includes:
    - EMA 5, 12, 50, 200 and EMA crossover signal
    - VWAP (Volume Weighted Average Price)
    - (Removed: MACD, Stochastic - conflicting signals for intraday)
    - RSI (14)
    - ATR (14)
    - ADX (14) with +DI and -DI
    
    Args:
        df: DataFrame with OHLC and volume data
    
    Returns:
        DataFrame with added indicator columns
    """
    logger.info("Calculating comprehensive technical indicators...")
    
    # Check if volume is available (required for VWAP)
    has_volume = 'volume' in df.columns and (df['volume'] > 0).sum() > 0
    
    # EMA 5 and EMA 12 (short-term momentum for intraday)
    df['ema5'] = calculate_ema(df['close'], period=5)
    df['ema12'] = calculate_ema(df['close'], period=12)
    
    # EMA crossover signal: 1 if EMA5 > EMA12 (bullish), -1 if EMA5 < EMA12 (bearish), 0 if equal
    df['ema_crossover'] = np.where(df['ema5'] > df['ema12'], 1.0,
                                   np.where(df['ema5'] < df['ema12'], -1.0, 0.0))
    
    # VWAP (Volume Weighted Average Price) - intraday reference price
    if has_volume:
        df['vwap'] = calculate_vwap(df['high'], df['low'], df['close'], df['volume'])
    else:
        logger.warning("Volume data not available, using close price as VWAP")
        df['vwap'] = df['close']  # Fallback to close price
    
    # RSI(14) - overbought/oversold for top/bottom identification
    if len(df) >= 14:
        df['rsi'] = calculate_rsi(df['close'], period=14)
    else:
        df['rsi'] = 50.0  # Neutral default
    
    # ATR(14) - Average True Range for volatility and stop-loss
    df['atr'] = calculate_atr(df['high'], df['low'], df['close'], period=14)
    
    # ADX(14) with +DI and -DI - trend strength indicator
    adx, plus_di, minus_di = calculate_adx(df['high'], df['low'], df['close'], period=14)
    df['adx'] = adx
    df['plus_di'] = plus_di
    df['minus_di'] = minus_di
    
    # Fill NaN values for indicators (first few rows)
    # EMAs: fill with close price
    df['ema5'] = df['ema5'].fillna(df['close'])
    df['ema12'] = df['ema12'].fillna(df['close'])
    
    # VWAP: fill with close if missing
    df['vwap'] = df['vwap'].fillna(df['close'])
    
    # RSI: fill with 50 (neutral)
    df['rsi'] = df['rsi'].fillna(50.0)
    
    # ATR: fill with 0 or a small value
    df['atr'] = df['atr'].fillna(0.0)
    
    # ADX: fill with 0 (no trend)
    df['adx'] = df['adx'].fillna(0.0)
    df['plus_di'] = df['plus_di'].fillna(0.0)
    df['minus_di'] = df['minus_di'].fillna(0.0)
    
    logger.info("✓ Indicators calculated: EMA(5,12), EMA Crossover, VWAP, RSI(14), ATR(14), ADX(14)")
    return df


def normalize_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Normalize OHLC and all indicators to [0, 1] range.
    
    Args:
        df: DataFrame with OHLC and indicators
    
    Returns:
        DataFrame with normalized features
    """
    logger.info("Normalizing features to [0, 1] range...")
    
    # Store original values for denormalization
    df['_orig_close'] = df['close'].copy()
    
    # Normalize OHLC using min-max scaling per column
    price_cols = ['open', 'high', 'low', 'close']
    for col in price_cols:
        col_min = df[col].min()
        col_max = df[col].max()
        if col_max > col_min:
            df[f'{col}_norm'] = (df[col] - col_min) / (col_max - col_min)
        else:
            df[f'{col}_norm'] = 0.5
    
    # Normalize EMAs (5, 12) using same scaling as close price
    close_min = df['close'].min()
    close_max = df['close'].max()
    if close_max > close_min:
        for ema_period in [5, 12]:
            df[f'ema{ema_period}_norm'] = (df[f'ema{ema_period}'] - close_min) / (close_max - close_min)
    else:
        for ema_period in [5, 12]:
            df[f'ema{ema_period}_norm'] = 0.5
    
    # Normalize EMA crossover signal: map from [-1, 1] to [0, 1]
    df['ema_crossover_norm'] = (df['ema_crossover'] + 1.0) / 2.0
    
    # Normalize VWAP using same scaling as close price
    if close_max > close_min:
        df['vwap_norm'] = (df['vwap'] - close_min) / (close_max - close_min)
    else:
        df['vwap_norm'] = 0.5
    
    # Normalize RSI (already 0-100, scale to 0-1)
    df['rsi_norm'] = df['rsi'] / 100.0
    
    # Normalize ATR: normalize relative to close price (ATR / close)
    # Then scale to [0, 1] using min-max
    atr_ratio = df['atr'] / df['close'].replace(0, np.nan)
    atr_ratio = atr_ratio.fillna(0.0)
    atr_ratio_min = atr_ratio.min()
    atr_ratio_max = atr_ratio.max()
    if atr_ratio_max > atr_ratio_min:
        df['atr_norm'] = (atr_ratio - atr_ratio_min) / (atr_ratio_max - atr_ratio_min)
    else:
        df['atr_norm'] = 0.5
    
    # Normalize ADX, +DI, -DI (already 0-100, scale to 0-1)
    df['adx_norm'] = df['adx'] / 100.0
    df['plus_di_norm'] = df['plus_di'] / 100.0
    df['minus_di_norm'] = df['minus_di'] / 100.0
    
    logger.info("✓ Features normalized")
    return df


def split_train_test(df: pd.DataFrame, train_ratio: float = None) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """
    Time-series split into train and test sets (preserves temporal order).
    
    Args:
        df: DataFrame with processed data
        train_ratio: Ratio of data for training (default: 0.7)
    
    Returns:
        Tuple of (train_df, test_df)
    """
    if train_ratio is None:
        train_ratio = nifty_config.TRAIN_TEST_SPLIT
    logger.info(f"Splitting data into train ({train_ratio*100:.0f}%) and test ({(1-train_ratio)*100:.0f}%)...")
    
    # Ensure data is sorted by timestamp
    df = df.sort_values('timestamp').reset_index(drop=True)
    
    # Calculate split index
    split_index = int(len(df) * train_ratio)
    
    train_df = df.iloc[:split_index].copy()
    test_df = df.iloc[split_index:].copy()
    
    logger.info(f"  Train: {len(train_df)} candles ({train_df['timestamp'].min()} to {train_df['timestamp'].max()})")
    logger.info(f"  Test: {len(test_df)} candles ({test_df['timestamp'].min()} to {test_df['timestamp'].max()})")
    
    return train_df, test_df


def create_state_vectors(df: pd.DataFrame) -> np.ndarray:
    """
    Create observation vectors for RL from processed DataFrame.
    
    Args:
        df: DataFrame with normalized features
    
    Returns:
        NumPy array of shape (n_samples, state_dim) with state vectors
    """
    # Extract normalized features in order matching STATE_DIM (15 features)
    state_cols = [
        # OHLC (4)
        'open_norm', 'high_norm', 'low_norm', 'close_norm',
        # EMA 5, 12 (2)
        'ema5_norm', 'ema12_norm',
        # EMA crossover signal (1)
        'ema_crossover_norm',
        # VWAP (1)
        'vwap_norm',
        # RSI (1)
        'rsi_norm',
        # ATR (1)
        'atr_norm',
        # ADX (3)
        'adx_norm', 'plus_di_norm', 'minus_di_norm',
    ]
    
    # Add portfolio value change % and position (will be updated during episode)
    states = df[state_cols].values
    
    # Add placeholder columns for portfolio %, position, and Mountain Signal features
    portfolio_col = np.zeros((len(states), 1))
    position_col = np.zeros((len(states), 1))
    
    # Mountain Signal features (3): signal_active, signal_age, price_vs_signal
    signal_active_col = np.zeros((len(states), 1))
    signal_age_col = np.zeros((len(states), 1))
    price_vs_signal_col = np.full((len(states), 1), 0.5)  # Default to 0.5 (neutral)
    
    state_vectors = np.hstack([states, portfolio_col, position_col, 
                               signal_active_col, signal_age_col, price_vs_signal_col])
    
    return state_vectors


def process_and_split(raw_data: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """
    Complete data processing pipeline: clean → indicators → normalize → split.
    
    Args:
        raw_data: Raw DataFrame from data fetcher
    
    Returns:
        Tuple of (train_df, test_df) with fully processed data
    """
    # Step 1: Clean data
    df = process_raw_data(raw_data)
    
    # Step 2: Calculate indicators
    df = calculate_indicators(df)
    
    # Step 3: Normalize features
    df = normalize_features(df)
    
    # Step 4: Split train/test
    train_df, test_df = split_train_test(df)
    
    return train_df, test_df

