"""
Pattern Knowledge Bank - Comprehensive trading pattern identification
"""
import logging
import pandas as pd
import numpy as np
from typing import Dict, Any, List, Tuple, Optional

logger = logging.getLogger(__name__)


# Pattern Knowledge Bank - All known trading patterns
PATTERN_KNOWLEDGE_BANK = {
    'trend_patterns': {
        'uptrend': {
            'description': 'Price consistently making higher highs and higher lows',
            'indicators': ['price > EMA50', 'EMA50 > EMA200', 'RSI 40-60'],
            'signal': 'bullish',
            'confidence': 'high'
        },
        'downtrend': {
            'description': 'Price consistently making lower highs and lower lows',
            'indicators': ['price < EMA50', 'EMA50 < EMA200', 'RSI 40-60'],
            'signal': 'bearish',
            'confidence': 'high'
        },
        'sideways': {
            'description': 'Price moving in a range without clear direction',
            'indicators': ['price oscillating around EMA50', 'RSI 40-60'],
            'signal': 'neutral',
            'confidence': 'medium'
        }
    },
    'reversal_patterns': {
        'double_top': {
            'description': 'Two peaks at similar price level, bearish reversal',
            'indicators': ['RSI > 70 at peaks', 'Volume decreasing'],
            'signal': 'bearish',
            'confidence': 'high'
        },
        'double_bottom': {
            'description': 'Two troughs at similar price level, bullish reversal',
            'indicators': ['RSI < 30 at bottoms', 'Volume increasing'],
            'signal': 'bullish',
            'confidence': 'high'
        },
        'head_and_shoulders': {
            'description': 'Three peaks with middle peak highest, bearish reversal',
            'indicators': ['RSI divergence', 'Volume pattern'],
            'signal': 'bearish',
            'confidence': 'very_high'
        },
        'inverse_head_shoulders': {
            'description': 'Three troughs with middle lowest, bullish reversal',
            'indicators': ['RSI divergence', 'Volume pattern'],
            'signal': 'bullish',
            'confidence': 'very_high'
        }
    },
    'continuation_patterns': {
        'flag': {
            'description': 'Brief consolidation after strong move, continuation expected',
            'indicators': ['Volume decreasing in flag', 'Price breakout'],
            'signal': 'continuation',
            'confidence': 'medium'
        },
        'triangle': {
            'description': 'Converging price action, breakout direction indicates trend',
            'indicators': ['Volume decreasing', 'Price consolidation'],
            'signal': 'breakout',
            'confidence': 'medium'
        },
        'pennant': {
            'description': 'Small symmetrical triangle, continuation pattern',
            'indicators': ['Volume decreasing', 'Brief consolidation'],
            'signal': 'continuation',
            'confidence': 'medium'
        }
    },
    'candle_patterns': {
        'hammer': {
            'description': 'Long lower wick, small body, bullish reversal',
            'indicators': ['Lower wick > 2x body', 'At support level'],
            'signal': 'bullish',
            'confidence': 'medium'
        },
        'shooting_star': {
            'description': 'Long upper wick, small body, bearish reversal',
            'indicators': ['Upper wick > 2x body', 'At resistance level'],
            'signal': 'bearish',
            'confidence': 'medium'
        },
        'engulfing_bullish': {
            'description': 'Large bullish candle engulfs previous bearish candle',
            'indicators': ['Body completely engulfs previous', 'Volume increase'],
            'signal': 'bullish',
            'confidence': 'high'
        },
        'engulfing_bearish': {
            'description': 'Large bearish candle engulfs previous bullish candle',
            'indicators': ['Body completely engulfs previous', 'Volume increase'],
            'signal': 'bearish',
            'confidence': 'high'
        },
        'doji': {
            'description': 'Open and close nearly equal, indecision',
            'indicators': ['Small body', 'Long wicks'],
            'signal': 'neutral',
            'confidence': 'low'
        }
    },
    'indicator_patterns': {
        'rsi_oversold': {
            'description': 'RSI below 30, potential bullish reversal',
            'indicators': ['RSI < 30', 'Price at support'],
            'signal': 'bullish',
            'confidence': 'medium'
        },
        'rsi_overbought': {
            'description': 'RSI above 70, potential bearish reversal',
            'indicators': ['RSI > 70', 'Price at resistance'],
            'signal': 'bearish',
            'confidence': 'medium'
        },
        'golden_cross': {
            'description': 'EMA50 crosses above EMA200, bullish signal',
            'indicators': ['EMA50 > EMA200', 'Price above both EMAs'],
            'signal': 'bullish',
            'confidence': 'high'
        },
        'death_cross': {
            'description': 'EMA50 crosses below EMA200, bearish signal',
            'indicators': ['EMA50 < EMA200', 'Price below both EMAs'],
            'signal': 'bearish',
            'confidence': 'high'
        },
        'rsi_divergence_bullish': {
            'description': 'Price makes lower low but RSI makes higher low',
            'indicators': ['Price trend down', 'RSI trend up'],
            'signal': 'bullish',
            'confidence': 'high'
        },
        'rsi_divergence_bearish': {
            'description': 'Price makes higher high but RSI makes lower high',
            'indicators': ['Price trend up', 'RSI trend down'],
            'signal': 'bearish',
            'confidence': 'high'
        }
    },
    'volume_patterns': {
        'volume_breakout': {
            'description': 'Price breaks resistance with high volume',
            'indicators': ['Volume > 1.5x average', 'Price breakout'],
            'signal': 'bullish',
            'confidence': 'high'
        },
        'volume_exhaustion': {
            'description': 'High volume but price not moving, potential reversal',
            'indicators': ['Volume spike', 'Price consolidation'],
            'signal': 'reversal',
            'confidence': 'medium'
        }
    }
}


def get_pattern_count() -> Dict[str, int]:
    """Get count of patterns in knowledge bank."""
    counts = {}
    for category, patterns in PATTERN_KNOWLEDGE_BANK.items():
        counts[category] = len(patterns)
    counts['total'] = sum(counts.values())
    return counts


def identify_patterns_in_data(
    data: pd.DataFrame,
    lookback_window: int = 20
) -> List[Dict[str, Any]]:
    """
    Identify trading patterns in the data.
    
    Args:
        data: DataFrame with OHLC, indicators
        lookback_window: Number of candles to look back for pattern detection
    
    Returns:
        List of identified patterns with details
    """
    identified_patterns = []
    
    if len(data) < lookback_window:
        return identified_patterns
    
    # Get required columns
    required_cols = ['close', 'open', 'high', 'low', 'rsi', 'ema50', 'ema200']
    if not all(col in data.columns for col in required_cols):
        logger.warning("Missing required columns for pattern identification")
        return identified_patterns
    
    for i in range(lookback_window, len(data)):
        window_data = data.iloc[i-lookback_window:i+1]
        current = data.iloc[i]
        
        patterns = []
        
        # RSI Patterns
        rsi = current.get('rsi', 50)
        if rsi < 30:
            patterns.append({
                'pattern': 'rsi_oversold',
                'category': 'indicator_patterns',
                'timestamp': current.get('timestamp', i),
                'index': i,
                'confidence': 'medium',
                'signal': 'bullish'
            })
        elif rsi > 70:
            patterns.append({
                'pattern': 'rsi_overbought',
                'category': 'indicator_patterns',
                'timestamp': current.get('timestamp', i),
                'index': i,
                'confidence': 'medium',
                'signal': 'bearish'
            })
        
        # EMA Patterns
        ema50 = current.get('ema50', current['close'])
        ema200 = current.get('ema200', current['close'])
        close = current['close']
        
        if ema50 > ema200 and close > ema50:
            patterns.append({
                'pattern': 'golden_cross',
                'category': 'indicator_patterns',
                'timestamp': current.get('timestamp', i),
                'index': i,
                'confidence': 'high',
                'signal': 'bullish'
            })
        elif ema50 < ema200 and close < ema50:
            patterns.append({
                'pattern': 'death_cross',
                'category': 'indicator_patterns',
                'timestamp': current.get('timestamp', i),
                'index': i,
                'confidence': 'high',
                'signal': 'bearish'
            })
        
        # Trend Patterns
        if close > ema50 and ema50 > ema200:
            patterns.append({
                'pattern': 'uptrend',
                'category': 'trend_patterns',
                'timestamp': current.get('timestamp', i),
                'index': i,
                'confidence': 'high',
                'signal': 'bullish'
            })
        elif close < ema50 and ema50 < ema200:
            patterns.append({
                'pattern': 'downtrend',
                'category': 'trend_patterns',
                'timestamp': current.get('timestamp', i),
                'index': i,
                'confidence': 'high',
                'signal': 'bearish'
            })
        
        # Candle Patterns
        if i > 0:
            prev = data.iloc[i-1]
            body_current = abs(current['close'] - current['open'])
            body_prev = abs(prev['close'] - prev['open'])
            
            # Engulfing patterns
            if (current['close'] > current['open'] and prev['close'] < prev['open'] and
                body_current > body_prev * 1.2):
                patterns.append({
                    'pattern': 'engulfing_bullish',
                    'category': 'candle_patterns',
                    'timestamp': current.get('timestamp', i),
                    'index': i,
                    'confidence': 'high',
                    'signal': 'bullish'
                })
            elif (current['close'] < current['open'] and prev['close'] > prev['open'] and
                  body_current > body_prev * 1.2):
                patterns.append({
                    'pattern': 'engulfing_bearish',
                    'category': 'candle_patterns',
                    'timestamp': current.get('timestamp', i),
                    'index': i,
                    'confidence': 'high',
                    'signal': 'bearish'
                })
        
        identified_patterns.extend(patterns)
    
    return identified_patterns


def get_pattern_description(pattern_name: str, category: str) -> Dict[str, Any]:
    """Get detailed description of a pattern from knowledge bank."""
    if category in PATTERN_KNOWLEDGE_BANK:
        if pattern_name in PATTERN_KNOWLEDGE_BANK[category]:
            return PATTERN_KNOWLEDGE_BANK[category][pattern_name]
    return {}


def generate_pattern_summary(identified_patterns: List[Dict[str, Any]]) -> str:
    """Generate human-readable summary of identified patterns."""
    if not identified_patterns:
        return "No patterns identified in the data."
    
    # Count patterns by type
    pattern_counts = {}
    for pattern in identified_patterns:
        pattern_name = pattern.get('pattern', 'unknown')
        pattern_counts[pattern_name] = pattern_counts.get(pattern_name, 0) + 1
    
    summary = f"Identified {len(identified_patterns)} pattern occurrences:\n\n"
    
    for pattern_name, count in sorted(pattern_counts.items(), key=lambda x: x[1], reverse=True):
        pattern_info = identified_patterns[0]  # Get first occurrence for details
        category = pattern_info.get('category', 'unknown')
        pattern_desc = get_pattern_description(pattern_name, category)
        
        description = pattern_desc.get('description', pattern_name)
        signal = pattern_desc.get('signal', 'unknown')
        confidence = pattern_desc.get('confidence', 'unknown')
        
        summary += f"- {pattern_name.replace('_', ' ').title()}: {count} occurrences\n"
        summary += f"  Description: {description}\n"
        summary += f"  Signal: {signal.upper()}, Confidence: {confidence}\n\n"
    
    return summary

