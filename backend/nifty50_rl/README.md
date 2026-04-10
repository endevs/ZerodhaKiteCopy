# Nifty 50 Reinforcement Learning Trading System

Complete RL trading system for Nifty 50 using Deep Q-Network (DQN) with Agno Agentic AI integration.

## Overview

This system implements:
- **DQN Agent**: Deep Q-Network with dual policies (Stochastic for training, Deterministic for testing)
- **Gymnasium Environment**: Custom trading environment for Nifty 50
- **Agno Agentic AI**: Multimodal reasoning layer using Ollama LLM3.2
- **Pattern Analysis**: Automatic pattern identification and strategy extraction
- **Model Management**: Save/load trained models with metadata

## File Structure

```
backend/nifty50_rl/
├── main.py                 # Main entry point (run this in PyCharm)
├── config.py              # Configuration constants
├── data_fetcher.py        # Zerodha data fetching
├── data_processor.py      # Data cleaning, indicators, normalization
├── nifty_trading_env.py  # Gymnasium trading environment
├── dqn_agent.py          # DQN implementation
├── trainer.py            # Training orchestration
├── evaluator.py          # Evaluation module
├── agno_agent.py         # Agno AI integration
├── pattern_analyzer.py   # Pattern identification
├── model_manager.py      # Model save/load
├── models/               # Saved models directory
└── data/                 # Data cache directory
```

## Quick Start

### 1. Install Dependencies

```bash
pip install gymnasium>=0.29.0 ollama>=0.1.0
```

### 2. Configure Zerodha Credentials

Ensure you have Zerodha API credentials configured in the database (via the Welcome page or API).

### 3. Run the System

**In PyCharm:**
1. Open `backend/nifty50_rl/main.py`
2. Right-click → Run 'main'
3. Or use command line: `python backend/nifty50_rl/main.py`

**Command Line Options:**
```bash
python main.py --years 1 --episodes 100          # Default: 1 year, 100 episodes
python main.py --years 2 --episodes 200          # 2 years data, 200 episodes
python main.py --retrain                          # Force retrain even if model exists
python main.py --user-id 1                       # Use specific user's credentials
```

## Workflow

### First Run (Training)

1. **Fetch Credentials**: Gets Zerodha API credentials from database
2. **Check Model**: No saved model found → proceed to training
3. **Fetch Data**: Downloads Nifty 50 5-minute OHLC data (default: 1 year)
4. **Process Data**: Cleans, calculates indicators (RSI, EMA), normalizes, splits 70/30
5. **Train Agent**: DQN training with Stochastic Policy (Epsilon-Greedy)
6. **Save Model**: Saves trained model with metadata
7. **Evaluate**: Tests on 30% data with Deterministic Policy + Agno reasoning
8. **Display Results**: Shows metrics, patterns, optimal stop-loss/target

### Subsequent Runs (Using Saved Model)

1. **Fetch Credentials**: Gets Zerodha API credentials
2. **Check Model**: **Found saved model** → load it, **skip training**
3. **Fetch Data**: Downloads fresh data
4. **Process Data**: Same processing pipeline
5. **Skip Training**: Uses loaded model
6. **Evaluate**: Tests on 30% data with Deterministic Policy + Agno reasoning
7. **Display Results**: Shows evaluation metrics

## Key Features

### Dual Policies

- **Stochastic Policy (Training)**: Epsilon-Greedy exploration (70% learning phase)
- **Deterministic Policy (Testing)**: Argmax Q-values (30% testing phase)

### State Space (9 features)

1. Normalized OHLC (4)
2. RSI normalized (1)
3. EMA50, EMA200 normalized (2)
4. Portfolio value change % (1)
5. Current position (1)

### Action Space (4 actions)

- 0: HOLD
- 1: BUY (enter long)
- 2: SELL (exit position)
- 3: CLOSE (force close, intraday)

### Reward Function

- Portfolio value change percentage
- Drawdown penalty (if > 5%)
- Intraday penalty (if position not closed by end of day)

## Output Metrics

- Total Trades
- Win Rate (%)
- Cumulative Return (%)
- Sharpe Ratio
- Max Drawdown (%)
- Optimal Stop Loss & Target (based on results)
- Agno AI Pattern Analysis

## Model Management

Models are saved in `backend/nifty50_rl/models/`:
- Format: `nifty50_dqn_YYYYMMDD_HHMMSS.pt`
- Metadata: `nifty50_dqn_YYYYMMDD_HHMMSS_metadata.json`
- Latest: `nifty50_dqn_latest.pt` (symlink/copy)

## Configuration

Edit `config.py` to adjust:
- Training parameters (episodes, epsilon, learning rate)
- Data parameters (train/test split, initial balance)
- Model parameters (state/action dimensions)
- Agno settings (LLM model, reasoning enabled)

## Notes

- **Intraday Constraint**: Positions are force-closed at end of trading day (15:30)
- **Data Fetching**: Uses chunking to handle large date ranges (max 2000 candles per request)
- **Model Reuse**: If model exists, training is skipped automatically (use `--retrain` to force)
- **Agno Integration**: Requires Ollama with LLM3.2 model (falls back to mock analysis if unavailable)

