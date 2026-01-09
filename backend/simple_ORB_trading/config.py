"""
Simple configuration for ORB Trading System
"""
import os

# Zerodha Configuration
BANKNIFTY_INSTRUMENT_TOKEN = 260105
CANDLE_INTERVAL = "15minute"  # 15-minute candles for ORB

# Trading Configuration
INITIAL_BALANCE = 100000.0
LOT_SIZE = 30  # Bank Nifty lot size

# ORB Strategy Configuration
ORB_START_TIME = "09:15"  # First candle time (9:15 AM IST)
ORB_DURATION_MINUTES = 15  # ORB candle duration

# EMA Configuration
EMA_PERIOD = 5  # 5-period EMA for exit signals

# Data Configuration
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
REPORTS_DIR = os.path.join(os.path.dirname(__file__), 'reports')

