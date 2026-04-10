# Mountain Signal Strategy - Complete Documentation

## Version Information

- **Strategy Name**: Mountain Signal
- **Version**: 1.0
- **Last Updated**: 2026-01-10
- **Lot Size**: BANKNIFTY=30, NIFTY=75

## Strategy Overview

The Mountain Signal Strategy is a rule-engine based trading strategy that uses PE (Put Option) signals to enter trades when market conditions indicate potential downward movement. The strategy is designed to be highly maintainable with rules defined in human-readable `.rules` files.

### Key Features

- **Rule Engine Architecture**: Business rules separated from execution logic
- **Human-Readable Rules**: Rules defined in `.rules` DSL files for easy modification
- **Modular Design**: Each rule type (signal, entry, exit) can be enhanced independently
- **Comprehensive Reporting**: CSV reports with all trade details and analytics

## Evaluation Schedule

- **Frequency**: Every 5-minute candle
- **Timing**: Evaluate 20 seconds before candle close

## Rules

### RULE 1: "Identify PE Signal"

**WHEN:**
- `candle.low > ema(5)`
- AND `rsi(14) > 70`
- AND `no_active_trade exists`
- AND `candle.start_time is after last_exit_time`

**THEN:**
- Set `signal.type = PE`
- Set `signal.low = candle.low`
- Set `signal.high = candle.high`
- Set `signal.time = candle.start_time`
- Set `signal.candle_index = candle.index`
- Log: "PE signal candle identified at {signal.time} (H:{signal.high} L:{signal.low})"

### RULE 2: "Reset PE Signal" (ENHANCED)

**WHEN:**
- Existing `signal.type == PE`
- AND `no_active_trade exists`
- AND `candle.start_time > signal.time`
- AND `candle.low > ema(5)`
- AND `rsi(14) > 70`
- **AND `candle.close > signal.high`** ← ENHANCED CONDITION

**THEN:**
- Replace `signal.low` with `candle.low`
- Replace `signal.high` with `candle.high`
- Replace `signal.time` with `candle.start_time`
- Replace `signal.candle_index` with `candle.index`
- Set `pe_signal_price_above_low = false`
- Log: "PE signal reset to newer candle {signal.time}"

**ELSE:** Keep existing signal unchanged

**Note:** This enhanced rule only resets the signal when price moves higher (close > signal.high), creating a trailing effect.

### RULE 3: "Clear PE Signal" (ENHANCED)

**WHEN:**
- `signal.type == PE`
- AND `no_active_trade exists` ← ENHANCED: Only clear if no active trade
- AND `candle.low < ema(5)`
- AND `rsi(14) <= 70`

**THEN:**
- Clear signal
- Log: "PE signal cleared because criteria no longer met"

**Note:** This enhanced rule ensures the signal is NOT cleared until the trade exits. The signal remains active even if conditions are no longer met while a trade is active.

## Entry Logic

### ENTRY: "PE Breakout Entry"

**FOR:** `signal.type == PE`

**TRIGGER:** `candle.close < signal.low`

**REQUIREMENTS:**

- **First Entry:** No requirements (always allowed)
- **Re-entry:**
  - Highest `candle.high` since last exit is above `signal.low`
  - Permitted while the current signal remains active
  - Permitted again if a new signal candle replaces the prior one

**ACTIONS:**

1. **Select Option Contract:**
   - Instrument: Index
   - Strike rounding: BANKNIFTY → 100, NIFTY → 50
   - Expiry policy: BANKNIFTY → monthly, NIFTY → weekly

2. **Trade Execution:**
   - Stop loss: -17% of option premium
   - Target: +45% of option premium
   - Lot size: BANKNIFTY → 30, NIFTY → 75

3. Log: "PE option trade opened @ {entry_price} (symbol {option_symbol})"

## Exit Priority Order

1. **Option Stop Loss** (Highest Priority)
2. **Option Target**
3. **Index Stop**
4. **Index Target**
5. **Market Close** (Lowest Priority)

## Exit Rules

### EXIT 1: "PE Option Stop Loss"

**WHEN:** `option_premium < entry_premium * 0.83`

**THEN:**
- Exit reason: `OPTION_STOP_LOSS`
- Log: "PE option stop loss hit @ {option_exit_price}"

### EXIT 2: "PE Option Target"

**WHEN:** `option_premium > entry_premium * 1.45`

**THEN:**
- Exit reason: `OPTION_TARGET`
- Log: "PE option target hit @ {option_exit_price}"

### EXIT 3: "PE Index Stop"

**WHEN:** `candle.close > signal.high`

**THEN:**
- Exit reason: `INDEX_STOP`
- Log: "PE index stop triggered @ {exit_price}"

### EXIT 4: "PE Index Target"

**WHEN:**
- First `candle.high < ema(5)`
- AND next 2 `candle.close > ema(5)`

**THEN:**
- Exit reason: `INDEX_TARGET`
- Log: "PE index target achieved @ {exit_price}"

### EXIT 5: "Market Close"

**WHEN:** `clock.time >= 15:15`

**THEN:**
- Exit reason: `MARKET_CLOSE`
- Log: "PE position auto-closed at market close"

## Implementation Details

### File Structure

```
Mountain_signal/
├── __init__.py
├── config.py                    # Strategy configuration
├── indicators.py                # EMA5, RSI14 calculations
├── strategy_engine.py          # Main orchestrator
├── utils.py                     # Helper functions
├── main.py                      # Entry point
│
├── rules/                       # Rule definitions
│   ├── __init__.py
│   ├── signal_rules.rules      # Signal rules (identify, reset, clear)
│   ├── entry_rules.rules       # Entry rules
│   ├── exit_rules.rules        # Exit rules
│   └── rules_parser.py         # Parser for .rules files
│
├── rule_engine/                 # Rule engine components
│   ├── __init__.py
│   ├── rule_context.py         # Context data structure
│   ├── rule_evaluator.py       # Condition evaluation
│   ├── rule_executor.py        # Action execution
│   └── rule_handler.py         # Rule orchestration
│
├── reports/                     # Generated reports
└── STRATEGY_DOCUMENTATION.md   # This file
```

### Key Classes

#### RuleHandler

**Purpose:** Orchestrates rule evaluation and execution

**Methods:**
- `evaluate_and_execute_signal_rules(context)`: Evaluate and execute signal rules
- `evaluate_entry_trigger(context)`: Check if entry trigger is met
- `evaluate_entry_requirements(context, is_first_entry)`: Validate entry requirements
- `evaluate_and_execute_exit_rules(context)`: Evaluate exit rules in priority order

#### RuleEvaluator

**Purpose:** Evaluates rule conditions against context

**Methods:**
- `evaluate_rule(rule, context)`: Evaluate all WHEN conditions
- `_evaluate_condition(condition, context)`: Evaluate a single condition
- `_resolve_value(operand, context)`: Resolve operand to actual value

#### RuleExecutor

**Purpose:** Executes rule actions

**Methods:**
- `execute_rule(rule, context)`: Execute all THEN actions
- `_execute_action(action, context)`: Execute a single action
- `_resolve_template(template, context)`: Resolve template strings

#### MountainSignalStrategy

**Purpose:** Main strategy orchestrator

**Methods:**
- `process_candle(candle_data, indicators)`: Process a single candle through strategy
- `_handle_entry(candle_data, is_first_entry)`: Handle trade entry
- `_handle_exit(candle_data, exit_reason)`: Handle trade exit

### Data Structures

#### RuleContext

```python
@dataclass
class RuleContext:
    candle: Dict[str, Any]          # Candle data (open, high, low, close, time, index)
    ema5: float                      # EMA5 value
    rsi14: float                     # RSI14 value
    signal: Optional[Dict[str, Any]] # Signal state (type, low, high, time, candle_index)
    active_trade: Optional[Dict]     # Active trade state
    state: Dict[str, Any]            # Strategy state
    last_exit_time: Optional[datetime] # Last trade exit time
    candles_since_exit: List[Dict]   # Candles since last exit (for re-entry validation)
    config: Dict[str, Any]           # Configuration
```

## Edge Cases and Handling

### Signal Management

1. **Multiple PE candles below signal high:**
   - Signal remains unchanged (only resets if close > signal.high)

2. **PE signal followed by non-PE candle:**
   - Signal remains active (not cleared until conditions are met AND no active trade)

3. **Signal cleared during active trade:**
   - Signal is NOT cleared until trade exits (enhanced rule)

### Entry Logic

1. **First entry:**
   - No requirements, always allowed when trigger condition is met

2. **Re-entry:**
   - Highest high since last exit must be above signal.low
   - Signal must remain active
   - Re-entry allowed if signal candle is replaced

### Exit Logic

1. **Multiple exit conditions met:**
   - Highest priority exit wins (option_stop_loss > option_target > index_stop > index_target > market_close)

2. **Market close:**
   - Always exits if position is still open at 15:15

### Post-Exit Behavior

1. **Skip candles before exit time:**
   - All candles before `last_exit_time` are skipped when searching for new signals
   - This ensures signals are only searched from exit candle onwards

2. **State reset after exit:**
   - `pe_signal_price_above_low` reset to False
   - `consecutive_candles_for_target` reset to 0
   - `last_candle_high_less_than_ema` reset to False
   - `candles_since_exit` cleared

## Testing Scenarios

1. **Signal Identification:**
   - Candle with `low > EMA5` and `RSI > 70` → Signal created
   - Candle before last exit time → Skipped

2. **Signal Reset:**
   - PE signal exists, new candle with `close > signal.high` → Signal reset
   - PE signal exists, new candle with `close <= signal.high` → Signal kept

3. **Signal Clear (Enhanced):**
   - Active trade exists, conditions not met → Signal NOT cleared
   - No active trade, conditions not met → Signal cleared (after exit)
   - Trade exits → Signal cleared, skip candles before exit time

4. **Entry Logic:**
   - First entry: `close < signal.low` → Entry allowed
   - Re-entry: `close < signal.low` AND `highest high since exit > signal.low` → Entry allowed

5. **Exit Priority:**
   - Multiple exit conditions met → Highest priority wins
   - Market close → Always exits if still open

## Performance Metrics

The strategy tracks the following metrics:

- Total trades
- Winning trades (option_pnl > 0)
- Losing trades (option_pnl <= 0)
- Win rate (%)
- Total Index P&L
- Total Option P&L
- Average Win (option)
- Average Loss (option)
- Largest Win (option)
- Largest Loss (option)
- Profit Factor (total wins / abs(total losses))
- Average Trade Duration (minutes)
- Day-wise statistics
- Exit type breakdown

## CSV Report Structure

### Required Columns

1. **Trade Information:**
   - trade_id, signal_time, signal_type, signal_high, signal_low, signal_candle_index

2. **Entry Information:**
   - entry_time, entry_price, entry_candle_index, entry_ema5, entry_rsi14

3. **Option Trade Information:**
   - option_symbol, atm_strike, option_entry_price, stop_loss_price, target_price, lot_size

4. **Exit Information:**
   - exit_time, exit_price, exit_candle_index, exit_type, exit_ema5, exit_rsi14, option_exit_price

5. **Performance Metrics:**
   - index_pnl, index_pnl_percent, option_pnl, option_pnl_percent, trade_duration_minutes, trade_duration_candles

6. **Signal Reset Information:**
   - signal_reset_count, signal_reset_times, final_signal_high, final_signal_low

### Summary Section

- Overall statistics (total trades, wins, losses, win rate, P&L)
- Day-wise statistics
- Exit type breakdown

## Configuration Parameters

### Instrument Configuration

- **BANKNIFTY:**
  - Lot size: 30 (updated from 35)
  - Strike step: 100
  - Expiry policy: monthly

- **NIFTY:**
  - Lot size: 75
  - Strike step: 50
  - Expiry policy: weekly

### Strategy Parameters

- EMA Period: 5
- RSI Period: 14
- RSI Overbought Threshold: 70
- RSI Oversold Threshold: 30

### Option Parameters

- Stop Loss: -17% of option premium
- Target: +45% of option premium

### Market Close

- Time: 15:15 PM

### Evaluation

- Candle Interval: 5-minute
- Evaluation Timing: 20 seconds before candle close

## Future Enhancement Guidelines

### For Developers/AI

1. **Modifying Rules:**
   - Edit `.rules` files directly (signal_rules.rules, entry_rules.rules, exit_rules.rules)
   - Rules are automatically parsed and loaded
   - No code changes needed for rule modifications

2. **Adding New Rules:**
   - Add new RULE/ENTRY/EXIT sections in appropriate `.rules` file
   - Follow the existing DSL format
   - Test with `test_parser.py` to verify parsing

3. **Enhancing Conditions:**
   - Modify `_parse_condition()` in `rules_parser.py` for new condition types
   - Modify `_evaluate_condition()` in `rule_evaluator.py` for evaluation logic
   - Modify `_resolve_value()` for new operand types

4. **Adding New Actions:**
   - Modify `_parse_action()` in `rules_parser.py` for new action types
   - Add action handler in `rule_executor.py` (e.g., `_execute_new_action()`)
   - Register handler in `action_handlers` dictionary

5. **Testing:**
   - Use `test_parser.py` to verify rule parsing
   - Create unit tests for rule evaluation
   - Test with sample candle data

6. **CSV Report Columns:**
   - When adding new data, update `report_generator.py` to include new columns
   - Update summary section calculations if needed
   - Test CSV generation with sample trades

## Code Examples

### Loading and Using Rules

```python
from Mountain_signal.rule_engine.rule_handler import RuleHandler
from Mountain_signal.rule_engine.rule_context import RuleContext

# Load rules
handler = RuleHandler()

# Create context
context = RuleContext(
    candle={'open': 100, 'high': 105, 'low': 99, 'close': 103, 'time': datetime.now()},
    ema5=100.5,
    rsi14=75.0,
    signal=None,
    active_trade=None,
    state={},
    last_exit_time=None,
    candles_since_exit=[],
    config={}
)

# Evaluate and execute signal rules
results = handler.evaluate_and_execute_signal_rules(context)
```

### Processing Candles

```python
from Mountain_signal.strategy_engine import MountainSignalStrategy

# Initialize strategy
strategy = MountainSignalStrategy(instrument_key="BANKNIFTY")

# Process candle
candle_data = {
    'open': 100,
    'high': 105,
    'low': 99,
    'close': 103,
    'time': datetime.now(),
    'index': 0
}

indicators = {
    'ema5': 100.5,
    'rsi14': 75.0
}

events = strategy.process_candle(candle_data, indicators)
```

## Change History

- **2026-01-10**: Initial implementation with rule engine architecture
- **2026-01-10**: Enhanced Reset PE Signal rule (close > signal.high condition)
- **2026-01-10**: Enhanced Clear PE Signal rule (no clear until trade exits)
- **2026-01-10**: Updated BANKNIFTY lot size from 35 to 30
- **2026-01-10**: Added skip candles before exit time logic

## Quick Reference

### Signal Identification
- Condition: `low > EMA5 AND RSI > 70 AND no_active_trade AND candle.time > last_exit_time`
- Skip candles before last exit time

### Signal Reset
- Condition: `existing signal.type == PE AND no_active_trade AND candle.time > signal.time AND low > EMA5 AND RSI > 70 AND close > signal.high`
- Only resets if close exceeds signal high (trailing effect)

### Signal Clear
- Condition: `signal.type == PE AND no_active_trade AND low < EMA5 AND RSI <= 70`
- DO NOT clear until trade exits

### Entry
- Trigger: `close < signal.low`
- First entry: no requirements
- Re-entry: `highest high since exit > signal.low`

### Exit Priority
1. Option Stop Loss (-17%)
2. Option Target (+45%)
3. Index Stop (close > signal.high)
4. Index Target (high < EMA5 AND next 2 close > EMA5)
5. Market Close (15:15)
