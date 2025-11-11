"""
Technical Indicators Library
Provides common technical analysis indicators for trading strategies
"""
import pandas as pd
import numpy as np
from typing import List, Tuple, Optional


def calculate_sma(data: pd.Series, period: int) -> pd.Series:
    """
    Simple Moving Average
    
    Args:
        data: Price series (typically close prices)
        period: Number of periods for SMA calculation
    
    Returns:
        Series containing SMA values
    """
    return data.rolling(window=period).mean()


def calculate_ema(data: pd.Series, period: int) -> pd.Series:
    """
    Exponential Moving Average
    
    Args:
        data: Price series (typically close prices)
        period: Number of periods for EMA calculation
    
    Returns:
        Series containing EMA values
    """
    return data.ewm(span=period, adjust=False).mean()


def calculate_wma(data: pd.Series, period: int) -> pd.Series:
    """
    Weighted Moving Average
    
    Args:
        data: Price series
        period: Number of periods for WMA calculation
    
    Returns:
        Series containing WMA values
    """
    weights = np.arange(1, period + 1)
    return data.rolling(window=period).apply(lambda x: np.dot(x, weights) / weights.sum(), raw=True)


def calculate_rsi(data: pd.Series, period: int = 14) -> pd.Series:
    """
    Relative Strength Index
    
    Args:
        data: Price series (typically close prices)
        period: Number of periods for RSI calculation (default: 14)
    
    Returns:
        Series containing RSI values (0-100)
    """
    delta = data.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    return rsi


def calculate_macd(data: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> Tuple[pd.Series, pd.Series, pd.Series]:
    """
    Moving Average Convergence Divergence
    
    Args:
        data: Price series (typically close prices)
        fast: Fast EMA period (default: 12)
        slow: Slow EMA period (default: 26)
        signal: Signal line EMA period (default: 9)
    
    Returns:
        Tuple of (MACD line, Signal line, Histogram)
    """
    ema_fast = calculate_ema(data, fast)
    ema_slow = calculate_ema(data, slow)
    macd_line = ema_fast - ema_slow
    signal_line = calculate_ema(macd_line, signal)
    histogram = macd_line - signal_line
    
    return macd_line, signal_line, histogram


def calculate_bollinger_bands(data: pd.Series, period: int = 20, std_dev: float = 2.0) -> Tuple[pd.Series, pd.Series, pd.Series]:
    """
    Bollinger Bands
    
    Args:
        data: Price series (typically close prices)
        period: Moving average period (default: 20)
        std_dev: Standard deviation multiplier (default: 2.0)
    
    Returns:
        Tuple of (Upper Band, Middle Band (SMA), Lower Band)
    """
    middle_band = calculate_sma(data, period)
    std = data.rolling(window=period).std()
    upper_band = middle_band + (std * std_dev)
    lower_band = middle_band - (std * std_dev)
    
    return upper_band, middle_band, lower_band


def calculate_atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    """
    Average True Range
    
    Args:
        high: High price series
        low: Low price series
        close: Close price series
        period: ATR period (default: 14)
    
    Returns:
        Series containing ATR values
    """
    high_low = high - low
    high_close = np.abs(high - close.shift())
    low_close = np.abs(low - close.shift())
    
    ranges = pd.concat([high_low, high_close, low_close], axis=1)
    true_range = np.max(ranges, axis=1)
    
    atr = true_range.rolling(window=period).mean()
    return atr


def calculate_stochastic(high: pd.Series, low: pd.Series, close: pd.Series, 
                        k_period: int = 14, d_period: int = 3) -> Tuple[pd.Series, pd.Series]:
    """
    Stochastic Oscillator
    
    Args:
        high: High price series
        low: Low price series
        close: Close price series
        k_period: %K period (default: 14)
        d_period: %D period (default: 3)
    
    Returns:
        Tuple of (%K line, %D line)
    """
    lowest_low = low.rolling(window=k_period).min()
    highest_high = high.rolling(window=k_period).max()
    
    k_percent = 100 * ((close - lowest_low) / (highest_high - lowest_low))
    d_percent = k_percent.rolling(window=d_period).mean()
    
    return k_percent, d_percent


def calculate_obv(close: pd.Series, volume: pd.Series) -> pd.Series:
    """
    On-Balance Volume
    
    Args:
        close: Close price series
        volume: Volume series
    
    Returns:
        Series containing OBV values
    """
    obv = (volume * np.sign(close.diff())).fillna(0).cumsum()
    return obv


def detect_support_resistance(prices: pd.Series, window: int = 20, threshold: float = 0.02) -> Tuple[List[float], List[float]]:
    """
    Detect Support and Resistance Levels
    
    Args:
        prices: Price series
        window: Rolling window for local min/max detection
        threshold: Minimum distance threshold for levels
    
    Returns:
        Tuple of (support_levels, resistance_levels)
    """
    # Find local minima (support) and maxima (resistance)
    local_min = prices.rolling(window=window, center=True).min() == prices
    local_max = prices.rolling(window=window, center=True).max() == prices
    
    support_levels = prices[local_min].tolist()
    resistance_levels = prices[local_max].tolist()
    
    # Filter levels by threshold
    support_levels = [level for level in support_levels if level > 0]
    resistance_levels = [level for level in resistance_levels if level > 0]
    
    return support_levels, resistance_levels


def identify_candlestick_patterns(df: pd.DataFrame) -> pd.DataFrame:
    """
    Identify common candlestick patterns
    
    Args:
        df: DataFrame with columns: open, high, low, close
    
    Returns:
        DataFrame with pattern signals
    """
    patterns = pd.DataFrame(index=df.index)
    
    body = abs(df['close'] - df['open'])
    upper_shadow = df['high'] - df[['open', 'close']].max(axis=1)
    lower_shadow = df[['open', 'close']].min(axis=1) - df['low']
    
    # Bullish/Bearish
    patterns['bullish'] = df['close'] > df['open']
    patterns['bearish'] = df['close'] < df['open']
    
    # Doji (small body relative to range)
    patterns['doji'] = body < (df['high'] - df['low']) * 0.1
    
    # Hammer (small body, long lower shadow, short upper shadow)
    patterns['hammer'] = (body < (df['high'] - df['low']) * 0.3) & \
                         (lower_shadow > body * 2) & \
                         (upper_shadow < body)
    
    # Shooting Star (small body, long upper shadow, short lower shadow)
    patterns['shooting_star'] = (body < (df['high'] - df['low']) * 0.3) & \
                                (upper_shadow > body * 2) & \
                                (lower_shadow < body)
    
    # Engulfing patterns
    patterns['bullish_engulfing'] = (df['close'] > df['open'].shift(1)) & \
                                    (df['open'] < df['close'].shift(1)) & \
                                    (body > body.shift(1) * 1.1)
    
    patterns['bearish_engulfing'] = (df['close'] < df['open'].shift(1)) & \
                                    (df['open'] > df['close'].shift(1)) & \
                                    (body > body.shift(1) * 1.1)
    
    return patterns



