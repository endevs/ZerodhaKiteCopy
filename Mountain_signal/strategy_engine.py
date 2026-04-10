"""
Strategy Engine - Main orchestrator for Mountain Signal Strategy
"""
from typing import List, Dict, Any, Optional
from datetime import datetime, time, date
import logging
try:
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False
    pd = None

from .rule_engine.rule_handler import RuleHandler
from .rule_engine.rule_context import RuleContext
from .indicators import calculate_indicators
from .config import (
    EMA_PERIOD, RSI_PERIOD, RSI_OVERBOUGHT_THRESHOLD,
    MARKET_CLOSE_TIME, INSTRUMENT_CONFIG
)

logger = logging.getLogger(__name__)


class MountainSignalStrategy:
    """Main strategy orchestrator"""
    
    def __init__(self, instrument_key: str = "BANKNIFTY"):
        self.instrument_key = instrument_key
        self.rule_handler = RuleHandler()
        
        # Strategy state
        self.pe_signal = None
        self.active_trade = None
        self.last_exit_time = None
        self.entry_history = set()  # Track signal indices with entries
        self.pe_signal_price_above_low = False
        self.consecutive_candles_for_target = 0
        self.last_candle_high_less_than_ema = False
        self.candles_since_exit = []  # For highest high check
        
        # Trade tracking
        self.trades = []
        self.signals = []  # Track all signals identified
    
    def process_candle(self, candle_data: Dict[str, Any], indicators: Dict[str, float]) -> List[Dict[str, Any]]:
        """
        Process a single candle through the strategy workflow
        
        Args:
            candle_data: Dictionary with candle data (open, high, low, close, time, index)
            indicators: Dictionary with indicator values (ema5, rsi14)
        
        Returns:
            List of events (signal_identified, trade_entered, trade_exited, etc.)
        """
        # #region agent log - DISABLED for performance
        # DEBUG_LOGGING = False  # Set to True only when debugging
        # if DEBUG_LOGGING:
        #     import json
        #     import os
        #     try:
        #         log_dir = r'd:\WorkSpace\ZerodhaKiteGit\.cursor'
        #         os.makedirs(log_dir, exist_ok=True)
        #         log_file = os.path.join(log_dir, 'debug.log')
        #         with open(log_file, 'a', encoding='utf-8') as f:
        #             f.write(json.dumps({'location': 'strategy_engine.py:57', 'message': 'process_candle entry', 'data': {'candle_index': candle_data.get('index'), 'time': str(candle_data.get('time')), 'close': candle_data.get('close'), 'low': candle_data.get('low'), 'ema5': indicators.get('ema5'), 'rsi14': indicators.get('rsi14'), 'has_active_trade': self.active_trade is not None, 'has_signal': self.pe_signal is not None}, 'timestamp': int(datetime.now().timestamp() * 1000), 'sessionId': 'debug-session', 'runId': 'run1', 'hypothesisId': 'H1'}) + '\n')
        #     except Exception as e:
        #         logger.debug(f"Debug log write failed: {e}")
        # #endregion
        
        events = []
        
        # Store current indicators for later use
        current_ema5 = indicators.get('ema5', 0)
        current_rsi14 = indicators.get('rsi14', 0)
        
        # Check if candle should be skipped (before last exit time)
        if self.last_exit_time and candle_data.get('time'):
            candle_time = candle_data['time']
            if isinstance(candle_time, str):
                try:
                    candle_time = datetime.strptime(candle_time, "%Y-%m-%d %H:%M:%S")
                except:
                    try:
                        if HAS_PANDAS:
                            candle_time = pd.to_datetime(candle_time)
                            if hasattr(candle_time, 'to_pydatetime'):
                                candle_time = candle_time.to_pydatetime()
                    except:
                        pass
            
            if isinstance(candle_time, datetime) and isinstance(self.last_exit_time, datetime):
                if candle_time < self.last_exit_time:
                    logger.debug(f"Skipping candle before last exit time: {candle_time}")
                    return events
        
        # Clear signal at market close (15:15) or when a new trading day starts
        # This prevents signals from carrying forward to the next day (intraday-only trading)
        candle_time_obj = candle_data.get('time')
        if candle_time_obj and self.pe_signal and not self.active_trade:
            # Parse candle time if needed
            if isinstance(candle_time_obj, str):
                try:
                    candle_time_obj = datetime.strptime(candle_time_obj, "%Y-%m-%d %H:%M:%S")
                except:
                    try:
                        if HAS_PANDAS:
                            candle_time_obj = pd.to_datetime(candle_time_obj)
                            if hasattr(candle_time_obj, 'to_pydatetime'):
                                candle_time_obj = candle_time_obj.to_pydatetime()
                    except:
                        pass
            
            if isinstance(candle_time_obj, datetime):
                candle_date = candle_time_obj.date()
                candle_time_only = candle_time_obj.time()
                should_clear_signal = False
                clear_reason = ""
                
                # Check if new trading day - clear signal from previous day (priority check)
                if self.pe_signal and self.pe_signal.get('time'):
                    signal_time = self.pe_signal.get('time')
                    if isinstance(signal_time, str):
                        try:
                            signal_time = datetime.strptime(signal_time, "%Y-%m-%d %H:%M:%S")
                        except:
                            try:
                                if HAS_PANDAS:
                                    signal_time = pd.to_datetime(signal_time)
                                    if hasattr(signal_time, 'to_pydatetime'):
                                        signal_time = signal_time.to_pydatetime()
                            except:
                                signal_time = None
                    
                    if isinstance(signal_time, datetime):
                        signal_date = signal_time.date()
                        # If signal is from a different day, clear it (start fresh each day)
                        if signal_date != candle_date:
                            should_clear_signal = True
                            clear_reason = f"New trading day detected (signal date: {signal_date}, candle date: {candle_date}) - clearing previous day's signal"
                
                # Check if market close (15:15) - clear signal to prevent carry-forward
                if not should_clear_signal and candle_time_only >= MARKET_CLOSE_TIME:
                    should_clear_signal = True
                    clear_reason = f"Market close detected at {candle_time_obj} - clearing signal to prevent carry-forward to next day"
                
                # Clear signal if either condition is met
                if should_clear_signal:
                    logger.info(clear_reason)
                    self.pe_signal = None
                    self.pe_signal_price_above_low = False
                    self.entry_history.clear()
                    self.consecutive_candles_for_target = 0
                    self.last_candle_high_less_than_ema = False
        
        # Create rule context
        context = RuleContext(
            candle=candle_data,
            ema5=current_ema5,
            rsi14=current_rsi14,
            signal=self.pe_signal,
            active_trade=self.active_trade,
            state={
                'pe_signal_price_above_low': self.pe_signal_price_above_low,
                'entry_history': self.entry_history,
                'consecutive_candles_for_target': self.consecutive_candles_for_target,
                'last_candle_high_less_than_ema': self.last_candle_high_less_than_ema,
            },
            last_exit_time=self.last_exit_time,
            candles_since_exit=self.candles_since_exit,
            config={'instrument_key': self.instrument_key}
        )
        
        # If there's an active trade, check exit conditions first (priority)
        if self.active_trade:
            # Update context with active_trade for exit evaluation
            context.active_trade = self.active_trade
            
            # Also update signal in context for exit evaluation (needed for "candle.close rises above signal.high")
            if self.pe_signal:
                context.signal = self.pe_signal
            
            exit_result = self.rule_handler.evaluate_and_execute_exit_rules(context)
            if exit_result:
                logger.info(f"Exit condition triggered: {exit_result['exit_reason']} at candle {candle_data.get('index')}")
                # Execute exit
                events.append({
                    'type': 'trade_exited',
                    'exit_reason': exit_result['exit_reason'],
                    'time': candle_data.get('time'),
                    'exit_price': candle_data.get('close'),
                })
                self._handle_exit(candle_data, indicators, exit_result['exit_reason'])
                # After exit, update context and continue with signal management
                context.active_trade = None
        
        # Manage PE signal (identify, reset, clear) - only if no active trade
        if not self.active_trade:
            # #region agent log - DISABLED for performance
            # DEBUG_LOGGING = False  # Set to True only when debugging
            # if DEBUG_LOGGING:
            #     try:
            #         log_file = os.path.join(r'd:\WorkSpace\ZerodhaKiteGit\.cursor', 'debug.log')
            #         with open(log_file, 'a', encoding='utf-8') as f:
            #             f.write(json.dumps({'location': 'strategy_engine.py:117', 'message': 'evaluating signal rules', 'data': {'candle_index': candle_data.get('index'), 'candle_low': candle_data.get('low'), 'ema5': current_ema5, 'rsi14': current_rsi14, 'low_above_ema5': candle_data.get('low', 0) > current_ema5, 'rsi_above_70': current_rsi14 > 70}, 'timestamp': int(datetime.now().timestamp() * 1000), 'sessionId': 'debug-session', 'runId': 'run1', 'hypothesisId': 'H2'}) + '\n')
            #     except Exception as e:
            #         logger.debug(f"Debug log write failed: {e}")
            # #endregion
            
            signal_results = self.rule_handler.evaluate_and_execute_signal_rules(context)
            
            # #region agent log - DISABLED for performance
            # if DEBUG_LOGGING:
            #     try:
            #         log_file = os.path.join(r'd:\WorkSpace\ZerodhaKiteGit\.cursor', 'debug.log')
            #         with open(log_file, 'a', encoding='utf-8') as f:
            #             f.write(json.dumps({'location': 'strategy_engine.py:120', 'message': 'signal rules result', 'data': {'has_signal_in_result': 'signal' in signal_results, 'signal_result': signal_results.get('signal') is not None, 'signal_type': signal_results.get('signal', {}).get('type') if signal_results.get('signal') else None}, 'timestamp': int(datetime.now().timestamp() * 1000), 'sessionId': 'debug-session', 'runId': 'run1', 'hypothesisId': 'H3'}) + '\n')
            #     except Exception as e:
            #         logger.debug(f"Debug log write failed: {e}")
            # #endregion
            
            # Update signal state from results
            if 'signal' in signal_results:
                if signal_results['signal'] is None:
                    # Signal cleared
                    self.pe_signal = None
                    events.append({
                        'type': 'signal_cleared',
                        'time': candle_data.get('time'),
                    })
                else:
                    # Signal created or reset
                    if self.pe_signal is None:
                        # First time signal identified
                        events.append({
                            'type': 'signal_identified',
                            'signal': signal_results['signal'].copy(),
                            'time': candle_data.get('time'),
                        })
                        # CRITICAL FIX: Set self.pe_signal so entry conditions can check it
                        self.pe_signal = signal_results['signal'].copy()
                        self.signals.append(self.pe_signal.copy())
                    else:
                        # Signal reset happened - track it
                        reset_time = candle_data.get('time')
                        events.append({
                            'type': 'signal_reset',
                            'signal': signal_results['signal'].copy(),
                            'time': reset_time,
                        })
                        # Signal reset can only happen when no active trade (per rules)
                        # Apply the reset
                        old_signal_high = self.pe_signal.get('high') if self.pe_signal else None
                        new_signal_high = signal_results['signal'].get('high')
                        
                        self.pe_signal = signal_results['signal'].copy()
                        self.signals.append(self.pe_signal.copy())
            
            # Update state from results
            if 'state' in signal_results:
                state_updates = signal_results['state']
                if 'pe_signal_price_above_low' in state_updates:
                    self.pe_signal_price_above_low = state_updates['pe_signal_price_above_low']
        
        # Check entry conditions (only if no active trade and signal exists)
        if not self.active_trade and self.pe_signal:
            # #region agent log - DISABLED for performance
            # DEBUG_LOGGING = False  # Set to True only when debugging
            # if DEBUG_LOGGING:
            #     try:
            #         log_file = os.path.join(r'd:\WorkSpace\ZerodhaKiteGit\.cursor', 'debug.log')
            #         with open(log_file, 'a', encoding='utf-8') as f:
            #             f.write(json.dumps({'location': 'strategy_engine.py:145', 'message': 'checking entry conditions', 'data': {'candle_index': candle_data.get('index'), 'candle_close': candle_data.get('close'), 'signal_low': self.pe_signal.get('low'), 'close_below_signal_low': candle_data.get('close', 0) < self.pe_signal.get('low', float('inf'))}, 'timestamp': int(datetime.now().timestamp() * 1000), 'sessionId': 'debug-session', 'runId': 'run1', 'hypothesisId': 'H5'}) + '\n')
            #     except Exception as e:
            #         logger.debug(f"Debug log write failed: {e}")
            # #endregion
            
            # Update context with latest signal state
            context.signal = self.pe_signal
            context.state['pe_signal_price_above_low'] = self.pe_signal_price_above_low
            
            # Check if entry trigger is met
            entry_trigger_result = self.rule_handler.evaluate_entry_trigger(context)
            
            # #region agent log - DISABLED for performance
            # if DEBUG_LOGGING:
            #     try:
            #         log_file = os.path.join(r'd:\WorkSpace\ZerodhaKiteGit\.cursor', 'debug.log')
            #         with open(log_file, 'a', encoding='utf-8') as f:
            #             f.write(json.dumps({'location': 'strategy_engine.py:152', 'message': 'entry trigger evaluation', 'data': {'entry_trigger_met': entry_trigger_result}, 'timestamp': int(datetime.now().timestamp() * 1000), 'sessionId': 'debug-session', 'runId': 'run1', 'hypothesisId': 'H5'}) + '\n')
            #     except Exception as e:
            #         logger.debug(f"Debug log write failed: {e}")
            # #endregion
            
            if entry_trigger_result:
                # Check if entry is allowed (first entry or re-entry)
                signal_index = self.pe_signal.get('candle_index')
                is_first_entry = signal_index not in self.entry_history
                
                if self.rule_handler.evaluate_entry_requirements(context, is_first_entry):
                    # Execute entry
                    events.append({
                        'type': 'trade_entered',
                        'entry_price': candle_data.get('close'),
                        'signal': self.pe_signal.copy(),
                        'time': candle_data.get('time'),
                        'is_first_entry': is_first_entry,
                    })
                    self._handle_entry(candle_data, indicators, is_first_entry)
        
        # Update candles_since_exit for re-entry validation
        if self.last_exit_time:
            candle_time = candle_data.get('time')
            if isinstance(candle_time, str):
                candle_time = datetime.strptime(candle_time, "%Y-%m-%d %H:%M:%S")
            
            if not self.last_exit_time or candle_time >= self.last_exit_time:
                self.candles_since_exit.append(candle_data.copy())
        
        # Update state for index target tracking
        if self.active_trade:
            candle_high = candle_data.get('high', 0)
            ema5 = indicators.get('ema5', 0)
            
            if candle_high < ema5:
                self.last_candle_high_less_than_ema = True
                self.consecutive_candles_for_target = 0
            elif self.last_candle_high_less_than_ema and candle_data.get('close', 0) > ema5:
                self.consecutive_candles_for_target += 1
        
        return events
    
    def _handle_entry(self, candle_data: Dict[str, Any], indicators: Dict[str, float], is_first_entry: bool):
        """Handle trade entry - SELL SHORT on index"""
        entry_price = candle_data.get('close', 0)
        signal_index = self.pe_signal.get('candle_index')
        entry_time = candle_data.get('time')
        
        # Add to entry history
        self.entry_history.add(signal_index)
        
        # Get lot size from config
        from .config import INSTRUMENT_CONFIG
        lot_size = INSTRUMENT_CONFIG.get(self.instrument_key, {}).get('lot_size', 30)
        
        # Get entry date
        entry_date = entry_time if isinstance(entry_time, date) else (entry_time.date() if isinstance(entry_time, datetime) else date.today())
        
        # Determine entry reason
        entry_reason = "first_entry" if is_first_entry else "re_entry"
        
        # Create active trade with index trading details only
        self.active_trade = {
            'signal': self.pe_signal.copy(),
            'signal_reset_count': 0,  # Track signal resets during trade
            'signal_reset_times': [],  # Track when signal was reset
            'entry_time': entry_time,
            'entry_price': entry_price,
            'entry_candle_index': candle_data.get('index'),
            'entry_ema5': indicators.get('ema5', 0),
            'entry_rsi14': indicators.get('rsi14', 0),
            'position_type': -1,  # SHORT position (SELL SHORT on entry)
            'is_first_entry': is_first_entry,
            'entry_reason': entry_reason,
            'instrument': self.instrument_key,
            'trade_date': entry_date,
            'lot_size': lot_size,
            # Track entry signal state
            'entry_signal_high': self.pe_signal.get('high'),
            'entry_signal_low': self.pe_signal.get('low'),
        }
        
        # Reset price action flag
        self.pe_signal_price_above_low = False
        
        logger.info(f"Trade entered (SELL SHORT): Entry price {entry_price}, Signal index {signal_index}, Lot size: {lot_size}")
    
    def _handle_exit(self, candle_data: Dict[str, Any], indicators: Dict[str, float], exit_reason: str):
        """Handle trade exit - BUY to cover SHORT position"""
        exit_price = candle_data.get('close', 0)
        exit_time = candle_data.get('time')
        
        # Calculate P&L
        if not self.active_trade:
            logger.warning("_handle_exit called but no active trade exists")
            return
        
        entry_price = self.active_trade.get('entry_price', 0)
        lot_size = self.active_trade.get('lot_size', 30)
        position_type = self.active_trade.get('position_type', -1)  # -1 for SHORT
        
        from .utils import calculate_pnl
        
        # Calculate index P&L for SHORT position
        # For SHORT: P&L = (entry_price - exit_price) * lot_size
        # Profit when exit_price < entry_price (price goes down)
        index_pnl, index_pnl_percent = calculate_pnl(entry_price, exit_price, lot_size, position_type)
            
        # Calculate trade duration
        entry_time = self.active_trade.get('entry_time')
        if entry_time and exit_time:
            if isinstance(entry_time, str):
                entry_time = datetime.strptime(entry_time, "%Y-%m-%d %H:%M:%S")
            if isinstance(exit_time, str):
                exit_time = datetime.strptime(exit_time, "%Y-%m-%d %H:%M:%S")
            
            if isinstance(entry_time, datetime) and isinstance(exit_time, datetime):
                duration = exit_time - entry_time
                trade_duration_minutes = duration.total_seconds() / 60
                trade_duration_candles = int(trade_duration_minutes / 5)  # Assuming 5-minute candles
            else:
                trade_duration_minutes = 0
                trade_duration_candles = 0
        else:
            trade_duration_minutes = 0
            trade_duration_candles = 0
        
        # Get final signal state (after any resets)
        final_signal_high = self.pe_signal.get('high') if self.pe_signal else self.active_trade.get('entry_signal_high')
        final_signal_low = self.pe_signal.get('low') if self.pe_signal else self.active_trade.get('entry_signal_low')
        
        # Create trade record with index trading details only
        trade_record = {
            **self.active_trade,
            'exit_time': exit_time,
            'exit_price': exit_price,
            'exit_candle_index': candle_data.get('index'),
            'exit_reason': exit_reason,
            'exit_ema5': indicators.get('ema5', 0),
            'exit_rsi14': indicators.get('rsi14', 0),
            # Index P&L calculations (for SHORT position)
            'index_pnl': index_pnl,
            'index_pnl_percent': index_pnl_percent,
            # Trade duration
            'trade_duration_minutes': round(trade_duration_minutes, 2),
            'trade_duration_candles': trade_duration_candles,
            # Final signal state
            'final_signal_high': final_signal_high,
            'final_signal_low': final_signal_low,
            # Signal reset information
            'signal_reset_count': self.active_trade.get('signal_reset_count', 0),
            'signal_reset_times': ','.join(str(t) for t in self.active_trade.get('signal_reset_times', [])),
        }
        
        # For backward compatibility, also include 'pnl' and 'pnl_percent' (use index P&L)
        trade_record['pnl'] = index_pnl
        trade_record['pnl_percent'] = index_pnl_percent
        
        self.trades.append(trade_record)
        
        # Update last exit time
        if exit_time:
            if isinstance(exit_time, str):
                try:
                    self.last_exit_time = datetime.strptime(exit_time, "%Y-%m-%d %H:%M:%S")
                except:
                    self.last_exit_time = pd.to_datetime(exit_time)
            elif isinstance(exit_time, datetime):
                self.last_exit_time = exit_time
            else:
                if HAS_PANDAS:
                    try:
                        self.last_exit_time = pd.to_datetime(exit_time)
                        if hasattr(self.last_exit_time, 'to_pydatetime'):
                            self.last_exit_time = self.last_exit_time.to_pydatetime()
                    except:
                        self.last_exit_time = None
                else:
                    self.last_exit_time = None
        
        # Clear active trade
        self.active_trade = None
        
        # CRITICAL FIX: Clear signal after trade exit so new signals can be identified
        # Per documentation: "Trade exits → Signal cleared, skip candles before exit time"
        # This ensures new signals can be identified from exit candle onwards
        self.pe_signal = None
        
        # Clear entry history after trade exit to allow fresh entries from new signals
        # Entry history tracks which signal indices have entries, but after exit,
        # new signals should be allowed to enter regardless of previous history
        self.entry_history.clear()
        
        # Reset state
        self.pe_signal_price_above_low = False
        self.consecutive_candles_for_target = 0
        self.last_candle_high_less_than_ema = False
        self.candles_since_exit = []  # Reset for next trade
        
        logger.info(f"Trade exited (BUY to cover): Exit price {exit_price}, Reason: {exit_reason}, Index P&L: {index_pnl:.2f} ({index_pnl_percent:.2f}%)")
