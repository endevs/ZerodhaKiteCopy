"""
Configuration constants for Bank Nifty RL Trading System
"""
import os

# Zerodha Configuration
BANKNIFTY_INSTRUMENT_TOKEN = 260105  # Bank Nifty Index (no volume) - fallback only
BANKNIFTY_USE_FUTURES = True  # Use futures for volume data (recommended)
CANDLE_INTERVAL = "5minute"

# Data Configuration
TRAIN_TEST_SPLIT = 0.7
INITIAL_DATA_YEARS = 1  # Default: 1 year for quick testing

# Trading Configuration
INITIAL_BALANCE = 100000.0
LOT_SIZE = 15  # Bank Nifty lot size is 15

# RL Training Configuration
MAX_EPISODES = 1000
EPSILON_START = 1.0
EPSILON_END = 0.01
EPSILON_DECAY = 0.995
LEARNING_RATE = 0.001
GAMMA = 0.99
BATCH_SIZE = 64
REPLAY_BUFFER_SIZE = 10000
TARGET_UPDATE_FREQ = 100

# Model Configuration
MODEL_DIR = os.path.join(os.path.dirname(__file__), 'models')
MODEL_PREFIX = "banknifty_dqn"
LATEST_MODEL_NAME = "banknifty_dqn_latest.pt"

# State Space Configuration (Intraday Focused + Mountain Signal)
# OHLC(4) + EMA5(1) + EMA12(1) + EMA_crossover(1) + 
# VWAP(1) + RSI(1) + ATR(1) + ADX(3) + 
# Portfolio%(1) + Position(1) + 
# Mountain Signal(3: active, age, price_vs_signal) = 18 features
STATE_DIM = 18
ACTION_DIM = 4  # HOLD, BUY, SELL, CLOSE (SELL supports short selling)

# Reward Configuration
DRAWDOWN_PENALTY_MULTIPLIER = 10.0
INTRADAY_PENALTY = -50.0  # Penalty if position not closed by end of day

# Mountain Signal Configuration
MOUNTAIN_SIGNAL_ENABLED = True
SIGNAL_ENTRY_BONUS = 5.0  # Reward for entering SHORT on signal trigger
SIGNAL_IGNORE_PENALTY = -2.0  # Penalty for ignoring valid signal entry
SIGNAL_EXIT_BONUS = 3.0  # Reward for correct exit (Index Stop)
SIGNAL_TARGET_BONUS = 4.0  # Reward for Index Target exit pattern

# Agno Configuration
AGNO_LLM_MODEL = "llama3.2"  # Ollama model name
AGNO_REASONING_ENABLED = True

