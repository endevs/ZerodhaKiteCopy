"""
Strategy Configuration
"""
from datetime import time

# Instrument Configuration
INSTRUMENT_CONFIG = {
    'BANKNIFTY': {
        'lot_size': 30,  # Updated from 35
        'strike_step': 100,
        'expiry_policy': 'monthly'
    },
    'NIFTY': {
        'lot_size': 75,
        'strike_step': 50,
        'expiry_policy': 'weekly'
    }
}

# Strategy Parameters
EMA_PERIOD = 5
RSI_PERIOD = 14
RSI_OVERSOLD_THRESHOLD = 30
RSI_OVERBOUGHT_THRESHOLD = 70

# Option Parameters
OPTION_STOP_LOSS_PERCENT = -0.17  # -17%
OPTION_TARGET_PERCENT = 0.45      # +45%

# Market Close
MARKET_CLOSE_TIME = time(15, 15)  # 15:15 PM

# Evaluation
CANDLE_INTERVAL = "5minute"
EVALUATION_TIMING_SECONDS = 20  # 20 seconds before candle close

# Reports
REPORTS_DIR = "reports"
