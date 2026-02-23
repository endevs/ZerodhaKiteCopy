# Simple ORB (Opening Range Breakout) Trading System

A clear, understandable trading strategy focused on profitability.

## Strategy Rules

### 1. ORB Candle Definition
- **First 15-minute candle** of the trading session (9:15 AM for Indian markets)

### 2. Entry Conditions
- **SELL ENTRY**: When any subsequent 15-minute candle closes **BELOW** the low of the ORB candle
- **BUY ENTRY**: When any subsequent 15-minute candle closes **ABOVE** the high of the ORB candle

### 3. Exit Conditions
- **For SELL positions**: Exit when **ANY TWO CONSECUTIVE** 15-minute candles close **ABOVE** the 5-period EMA
- **For BUY positions**: Exit when **ANY TWO CONSECUTIVE** 15-minute candles close **BELOW** the 5-period EMA

### 4. Additional Rules
- Only one position (long or short) can be active at a time
- Trades are taken only during the trading session after the ORB candle
- No trades taken during the ORB candle formation period
- All positions are force-closed at end of day (3:30 PM)

## How to Run

### Step 1: Run the Backtest
```bash
cd backend/simple_ORB_trading
python main.py
```

### Step 2: Review Results
The system will:
1. Connect to Zerodha and fetch 15-minute Bank Nifty data (last 3 months)
2. Run the ORB strategy backtest
3. Display results (win rate, P&L, profit factor, etc.)
4. Generate a detailed CSV report with all trades

### Step 3: Analyze the CSV Report
Check the `reports/` folder for a CSV file with:
- **Entry date/time**: Exact timestamp when trade was entered
- **Exit date/time**: Exact timestamp when trade was exited
- **Entry/Exit prices**: Actual prices
- **P&L**: Profit/Loss for each trade
- **Exit reason**: Why the trade was closed

## Configuration

Edit `config.py` to adjust:
- `INITIAL_BALANCE`: Starting capital (default: ₹100,000)
- `LOT_SIZE`: Bank Nifty lot size (default: 15)
- `EMA_PERIOD`: EMA period for exit signals (default: 5)
- `ORB_START_TIME`: ORB candle time (default: "09:15")

## Understanding the Code

### File Structure
- **`config.py`**: Simple configuration settings
- **`data_fetcher.py`**: Fetches 15-minute Bank Nifty data from Zerodha
- **`orb_strategy.py`**: Core strategy logic (THIS IS THE MAIN LOGIC)
- **`backtester.py`**: Runs the backtest and displays results
- **`csv_report.py`**: Generates detailed trade reports
- **`main.py`**: Entry point - runs everything

### Key Functions

#### `identify_orb_candle()`
- Identifies the first 15-minute candle (9:15 AM) for each trading day
- Marks it as the ORB candle

#### `backtest_orb_strategy()`
- Main backtesting function
- Processes each candle and applies entry/exit rules
- Tracks positions and calculates P&L
- Returns trades DataFrame and results dictionary

## Example Output

```
============================================================
BACKTEST RESULTS
============================================================
Total Trades: 45
Winning Trades: 28
Losing Trades: 17
Win Rate: 62.22%
Total P&L: ₹45,250.00
Final Balance: ₹145,250.00
Cumulative Return: 45.25%
Average Win: ₹3,500.00
Average Loss: ₹-1,800.00
Profit Factor: 1.94
============================================================
```

## Tips for Improvement

1. **Test Different Time Periods**: Try different date ranges to see how the strategy performs
2. **Adjust EMA Period**: Test with EMA 3, 7, or 10 instead of 5
3. **Add Stop Loss**: Consider adding a hard stop-loss (e.g., -1%) to limit losses
4. **Add Target**: Consider adding a profit target (e.g., +2%) to lock in gains
5. **Filter Days**: Skip trading on low volatility days or specific market conditions

## Next Steps

Once you understand this simple system and it's profitable:
1. Add stop-loss and target mechanisms
2. Add filters (e.g., only trade if ORB range is > X points)
3. Optimize parameters (EMA period, ORB time, etc.)
4. Add simple ML to predict better entry/exit timing

## Why This is Better Than Complex RL

1. **Understandable**: You can read the code and know exactly what it does
2. **Testable**: Backtest before risking real money
3. **Modifiable**: Easy to adjust rules and see the impact
4. **Focused**: Clear entry/exit rules, no black box
5. **Profitable**: Simple strategies often outperform complex ones

