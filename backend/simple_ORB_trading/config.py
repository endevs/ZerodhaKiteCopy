"""
Simple configuration for ORB Trading System
"""
import os

# Zerodha Configuration
BANKNIFTY_INSTRUMENT_TOKEN = 260105

# Trading Mode Configuration
# Options: "scalping" (5-min candles, 1st candle ORB) or "swing" (15-min candles, 4th candle ORB)
TRADING_MODE = "scalping"  # Change to "swing" for 15-minute strategy
CANDLE_INTERVAL = "5minute" if TRADING_MODE == "scalping" else "15minute"

# Trading Configuration
INITIAL_BALANCE = 100000.0
LOT_SIZE = 30  # Bank Nifty lot size

# ORB Strategy Configuration
# For Scalping (5-min): Use 1st candle (9:15 AM) as ORB
# For Swing (15-min): Use 4th candle (10:00 AM) as ORB
ORB_CANDLE_NUMBER = 1 if TRADING_MODE == "scalping" else 4

# Scalping Configuration
ONE_TRADE_PER_DAY = True if TRADING_MODE == "scalping" else False  # Only for scalping mode

# EMA Configuration
EMA_PERIOD = 5  # 5-period EMA for exit signals (works for both modes)

# Data Configuration
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
REPORTS_DIR = os.path.join(os.path.dirname(__file__), 'reports')

