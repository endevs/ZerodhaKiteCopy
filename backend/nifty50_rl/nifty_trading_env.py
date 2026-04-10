"""
Gymnasium-compatible trading environment for Bank Nifty RL
"""
import logging
import numpy as np
import pandas as pd
from typing import Dict, Any, Optional, Tuple
import gymnasium as gym
from gymnasium import spaces
# Import config from local nifty50_rl package
import sys
import os
import importlib.util
_current_dir = os.path.dirname(os.path.abspath(__file__))
_config_path = os.path.join(_current_dir, 'config.py')
spec = importlib.util.spec_from_file_location("nifty50_rl_config", _config_path)
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)

logger = logging.getLogger(__name__)


class NiftyTradingEnv(gym.Env):
    """
    Gymnasium environment for Bank Nifty intraday trading with RL.
    
    Observation Space: 14 features
    - Normalized OHLC (4)
    - EMA5, EMA12 normalized (2)
    - EMA crossover signal normalized (1)
    - VWAP normalized (1)
    - RSI normalized (1)
    - ATR normalized (1)
    - ADX, +DI, -DI normalized (3)
    - Portfolio value change % (1)
    - Current position (1: -1=short, 0=none, 1=long)
    
    Action Space: 4 discrete actions
    - 0: HOLD
    - 1: BUY (if flat → enter long, if short → close short and enter long)
    - 2: SELL (if flat → enter short, if long → close long and enter short)
    - 3: CLOSE (force close any position, intraday)
    """
    
    metadata = {'render_modes': ['human']}
    
    def __init__(self, data: pd.DataFrame, initial_balance: float = None):
        """
        Initialize environment.
        
        Args:
            data: Processed DataFrame with normalized features
            initial_balance: Starting portfolio balance
        """
        super().__init__()
        
        self.data = data.reset_index(drop=True)
        self.initial_balance = initial_balance or config.INITIAL_BALANCE
        self.current_balance = self.initial_balance
        self.lot_size = config.LOT_SIZE
        
        # Trading state
        self.current_position = 0  # -1 (short), 0 (none), 1 (long)
        self.entry_price = 0.0
        self.entry_index = 0
        self.current_index = 0
        self.portfolio_value_history = [self.initial_balance]
        self.trade_history = []
        
        # Mountain Signal state tracking
        self.mountain_signal = {
            'type': None,  # 'PE' or None
            'low': None,
            'high': None,
            'time': None,
            'index': None
        }
        self.signal_entry_allowed = True  # Track if entry is allowed
        
        # Observation and action spaces
        self.observation_space = spaces.Box(
            low=0.0, high=1.0, shape=(config.STATE_DIM,), dtype=np.float32
        )
        self.action_space = spaces.Discrete(config.ACTION_DIM)
        
        # Get price normalization info for denormalization
        if '_orig_close' in self.data.columns:
            self.price_min = self.data['_orig_close'].min()
            self.price_max = self.data['_orig_close'].max()
        else:
            # Fallback: use close_norm to estimate
            self.price_min = self.data['close'].min() if 'close' in self.data.columns else 0
            self.price_max = self.data['close'].max() if 'close' in self.data.columns else 1
    
    def reset(self, seed: Optional[int] = None, options: Optional[dict] = None) -> Tuple[np.ndarray, Dict]:
        """Reset environment to initial state."""
        super().reset(seed=seed)
        
        self.current_index = 0
        self.current_balance = self.initial_balance
        self.current_position = 0
        self.entry_price = 0.0
        self.entry_index = 0
        self.portfolio_value_history = [self.initial_balance]
        self.trade_history = []
        
        # Reset Mountain Signal state
        self.mountain_signal = {
            'type': None,
            'low': None,
            'high': None,
            'time': None,
            'index': None
        }
        self.signal_entry_allowed = True
        
        observation = self._get_observation()
        info = self._get_info()
        
        return observation, info
    
    def step(self, action: int, q_values: Optional[Dict[str, float]] = None) -> Tuple[np.ndarray, float, bool, bool, Dict]:
        """
        Execute one step in the environment.
        
        Args:
            action: Action to take (0=HOLD, 1=BUY, 2=SELL, 3=CLOSE)
            q_values: Optional Q-values for logging
        
        Returns:
            observation, reward, terminated, truncated, info
        """
        if self.current_index >= len(self.data) - 1:
            # End of data
            terminated = True
            truncated = False
            reward = 0.0
        else:
            # Execute action
            reward = self._execute_action(action, q_values)
            
            # Move to next candle
            self.current_index += 1
            
            # Check if end of day (intraday constraint)
            if self._is_end_of_day():
                if self.current_position != 0:
                    # Force close position
                    reward += self._force_close_position()
            
            terminated = self.current_index >= len(self.data) - 1
            truncated = False
        
        observation = self._get_observation()
        info = self._get_info()
        
        return observation, reward, terminated, truncated, info
    
    def _execute_action(self, action: int, q_values: Optional[Dict[str, float]] = None) -> float:
        """Execute trading action and return reward."""
        # Update Mountain Signal before action
        self._update_mountain_signal()
        
        current_price = self._get_current_price()
        prev_balance = self.current_balance
        
        # Check if signal entry should trigger
        signal_entry_triggered = False
        if self.mountain_signal['type'] == 'PE' and self.mountain_signal['low'] is not None:
            if current_price < self.mountain_signal['low']:
                signal_entry_triggered = True
        
        # Generate reasoning if Q-values provided
        if q_values:
            reasoning = self.generate_decision_reasoning(action, q_values)
            logger.info(f"[DECISION] {reasoning}")
        
        if action == 0:  # HOLD
            pass
        
        elif action == 1:  # BUY
            if self.current_position == 0:
                # Enter long position
                self.current_position = 1
                self.entry_price = current_price
                self.entry_index = self.current_index
                analysis = self.get_technical_analysis()
                logger.info(f"[ENTRY] BUY LONG at ₹{current_price:.2f} | "
                           f"RSI={analysis.get('rsi', 0):.1f} | "
                           f"Price vs VWAP: {analysis.get('price_vs_vwap', 'N/A')} | "
                           f"ADX={analysis.get('adx', 0):.1f}")
            elif self.current_position == -1:
                # Close short and enter long (reversal)
                pnl = (self.entry_price - current_price) * self.lot_size  # Profit if price fell
                pnl_pct = (pnl / (self.entry_price * self.lot_size)) * 100 if self.entry_price > 0 else 0
                self.current_balance += pnl
                self.trade_history.append({
                    'entry_index': self.entry_index,
                    'exit_index': self.current_index,
                    'entry_price': self.entry_price,
                    'exit_price': current_price,
                    'pnl': pnl,
                    'pnl_pct': pnl_pct,
                    'position_type': 'short'
                })
                analysis = self.get_technical_analysis()
                logger.info(f"[EXIT] CLOSE SHORT at ₹{current_price:.2f} | "
                           f"Entry: ₹{self.entry_price:.2f} | "
                           f"PnL: ₹{pnl:.2f} ({pnl_pct:+.2f}%)")
                # Enter long
                self.current_position = 1
                self.entry_price = current_price
                self.entry_index = self.current_index
                logger.info(f"[ENTRY] BUY LONG at ₹{current_price:.2f} | "
                           f"RSI={analysis.get('rsi', 0):.1f}")
        
        elif action == 2:  # SELL
            if self.current_position == 0:
                # Enter short position
                self.current_position = -1
                self.entry_price = current_price
                self.entry_index = self.current_index
                analysis = self.get_technical_analysis()
                logger.info(f"[ENTRY] SELL SHORT at ₹{current_price:.2f} | "
                           f"RSI={analysis.get('rsi', 0):.1f} | "
                           f"Price vs VWAP: {analysis.get('price_vs_vwap', 'N/A')} | "
                           f"ADX={analysis.get('adx', 0):.1f}")
            elif self.current_position == 1:
                # Close long and enter short (reversal)
                pnl = (current_price - self.entry_price) * self.lot_size
                pnl_pct = (pnl / (self.entry_price * self.lot_size)) * 100
                self.current_balance += pnl
                self.trade_history.append({
                    'entry_index': self.entry_index,
                    'exit_index': self.current_index,
                    'entry_price': self.entry_price,
                    'exit_price': current_price,
                    'pnl': pnl,
                    'pnl_pct': pnl_pct,
                    'position_type': 'long'
                })
                analysis = self.get_technical_analysis()
                logger.info(f"[EXIT] CLOSE LONG at ₹{current_price:.2f} | "
                           f"Entry: ₹{self.entry_price:.2f} | "
                           f"PnL: ₹{pnl:.2f} ({pnl_pct:+.2f}%)")
                # Enter short
                self.current_position = -1
                self.entry_price = current_price
                self.entry_index = self.current_index
                logger.info(f"[ENTRY] SELL SHORT at ₹{current_price:.2f} | "
                           f"RSI={analysis.get('rsi', 0):.1f}")
        
        elif action == 3:  # CLOSE
            if self.current_position != 0:
                # Force close any position
                if self.current_position == 1:
                    pnl = (current_price - self.entry_price) * self.lot_size
                    position_type = 'long'
                else:  # short
                    pnl = (self.entry_price - current_price) * self.lot_size
                    position_type = 'short'
                pnl_pct = (pnl / (self.entry_price * self.lot_size)) * 100 if self.entry_price > 0 else 0
                self.current_balance += pnl
                self.trade_history.append({
                    'entry_index': self.entry_index,
                    'exit_index': self.current_index,
                    'entry_price': self.entry_price,
                    'exit_price': current_price,
                    'pnl': pnl,
                    'pnl_pct': pnl_pct,
                    'position_type': position_type
                })
                logger.info(f"[FORCE CLOSE] {position_type.upper()} at ₹{current_price:.2f} | PnL: ₹{pnl:.2f}")
                self.current_position = 0
                self.entry_price = 0.0
        
        # Update portfolio value history
        current_portfolio_value = self._calculate_portfolio_value(current_price)
        self.portfolio_value_history.append(current_portfolio_value)
        
        # Calculate base reward
        reward = self._calculate_reward(prev_balance, current_portfolio_value)
        
        # Add Mountain Signal reward bonus/penalty
        if config.MOUNTAIN_SIGNAL_ENABLED:
            signal_reward = self._calculate_signal_reward(action, signal_entry_triggered)
            reward += signal_reward
        
        return reward
    
    def _calculate_portfolio_value(self, current_price: float) -> float:
        """Calculate current portfolio value including open position."""
        if self.current_position == 0:
            return self.current_balance
        
        # Include unrealized PnL
        if self.current_position == 1:  # Long position
            unrealized_pnl = (current_price - self.entry_price) * self.lot_size
        else:  # Short position (current_position == -1)
            unrealized_pnl = (self.entry_price - current_price) * self.lot_size
        return self.current_balance + unrealized_pnl
    
    def _calculate_reward(self, prev_balance: float, current_portfolio_value: float) -> float:
        """Calculate reward based on portfolio performance."""
        # Portfolio value change percentage
        portfolio_change_pct = ((current_portfolio_value - prev_balance) / prev_balance) * 100
        
        # Drawdown penalty
        max_portfolio = max(self.portfolio_value_history) if self.portfolio_value_history else self.initial_balance
        drawdown = (max_portfolio - current_portfolio_value) / max_portfolio if max_portfolio > 0 else 0
        drawdown_penalty = drawdown * config.DRAWDOWN_PENALTY_MULTIPLIER if drawdown > 0.05 else 0  # Penalty if drawdown > 5%
        
        reward = portfolio_change_pct - drawdown_penalty
        
        return reward
    
    def _force_close_position(self) -> float:
        """Force close position at end of day (intraday constraint)."""
        if self.current_position == 0:
            return 0.0
        
        current_price = self._get_current_price()
        if self.current_position == 1:  # Long position
            pnl = (current_price - self.entry_price) * self.lot_size
            position_type = 'long'
        else:  # Short position (current_position == -1)
            pnl = (self.entry_price - current_price) * self.lot_size
            position_type = 'short'
        
        self.current_balance += pnl
        self.trade_history.append({
            'entry_index': self.entry_index,
            'exit_index': self.current_index,
            'entry_price': self.entry_price,
            'exit_price': current_price,
            'pnl': pnl,
            'pnl_pct': (pnl / (self.entry_price * self.lot_size)) * 100 if self.entry_price > 0 else 0,
            'position_type': position_type
        })
        logger.info(f"[FORCE CLOSE] {position_type.upper()} at ₹{current_price:.2f} | PnL: ₹{pnl:.2f}")
        self.current_position = 0
        self.entry_price = 0.0
        
        # Return penalty for not closing before end of day
        return config.INTRADAY_PENALTY
    
    def _update_mountain_signal(self):
        """Update Mountain Signal state based on current candle (Mountain Signal Strategy)."""
        if self.current_index >= len(self.data):
            return
        
        row = self.data.iloc[self.current_index]
        candle_low = float(row.get('low', 0))
        candle_high = float(row.get('high', 0))
        candle_close = float(row.get('close', 0))
        ema5 = row.get('ema5', candle_close)
        rsi = row.get('rsi', 50)
        timestamp = row.get('timestamp', None)
        
        # Rule 1: Identify PE Signal (candle.low > EMA5 AND RSI > 70)
        if candle_low > ema5 and rsi > 70:
            # New signal or reset existing
            if self.mountain_signal['type'] is None:
                # New signal
                self.mountain_signal = {
                    'type': 'PE',
                    'low': candle_low,
                    'high': candle_high,
                    'time': timestamp,
                    'index': self.current_index
                }
                logger.debug(f"[SIGNAL] PE signal identified at {timestamp} (H:{candle_high:.2f} L:{candle_low:.2f})")
            elif timestamp and self.mountain_signal['time'] and timestamp > self.mountain_signal['time']:
                # Reset to newer candle (Rule 2: Reset PE Signal)
                self.mountain_signal['low'] = candle_low
                self.mountain_signal['high'] = candle_high
                self.mountain_signal['time'] = timestamp
                self.mountain_signal['index'] = self.current_index
                logger.debug(f"[SIGNAL] PE signal reset to newer candle {timestamp}")
        
        # Rule 3: Clear PE Signal (candle.low < EMA5 OR RSI <= 70)
        elif self.mountain_signal['type'] == 'PE':
            if candle_low < ema5 or rsi <= 70:
                logger.debug(f"[SIGNAL] PE signal cleared (low < EMA5 or RSI <= 70)")
                self.mountain_signal = {'type': None, 'low': None, 'high': None, 'time': None, 'index': None}
                self.signal_entry_allowed = True  # Reset entry flag
    
    def _check_index_target_pattern(self) -> bool:
        """Check if Index Target pattern is met (first candle.high < EMA5, next 2 closes > EMA5)."""
        if self.current_index < 1 or self.current_index >= len(self.data) - 1:
            return False
        
        # Check previous candle (first in pattern: candle.high < EMA5)
        prev_row = self.data.iloc[self.current_index - 1]
        prev_high = float(prev_row.get('high', 0))
        prev_ema5 = prev_row.get('ema5', prev_high)
        
        # Check current candle (next 1: candle.close > EMA5)
        current_row = self.data.iloc[self.current_index]
        current_close = float(current_row.get('close', 0))
        current_ema5 = current_row.get('ema5', current_close)
        
        # Check next candle (next 2: candle.close > EMA5)
        if self.current_index + 1 < len(self.data):
            next_row = self.data.iloc[self.current_index + 1]
            next_close = float(next_row.get('close', 0))
            next_ema5 = next_row.get('ema5', next_close)
        else:
            return False
        
        # Pattern: prev_high < EMA5 AND current_close > EMA5 AND next_close > EMA5
        if prev_high < prev_ema5 and current_close > current_ema5 and next_close > next_ema5:
            return True
        
        return False
    
    def _calculate_signal_reward(self, action: int, signal_entry_triggered: bool) -> float:
        """Calculate reward bonus/penalty for following Mountain Signal rules."""
        signal_reward = 0.0
        
        # If PE signal is active
        if self.mountain_signal['type'] == 'PE':
            # Bonus for entering SHORT when signal triggers (candle.close < signal.low)
            if signal_entry_triggered and action == 2 and self.current_position == 0:
                signal_reward += config.SIGNAL_ENTRY_BONUS
                logger.debug(f"[SIGNAL REWARD] +{config.SIGNAL_ENTRY_BONUS} for entering SHORT on signal trigger")
            
            # Penalty for ignoring signal entry
            elif signal_entry_triggered and action != 2 and self.current_position == 0:
                signal_reward += config.SIGNAL_IGNORE_PENALTY
                logger.debug(f"[SIGNAL REWARD] {config.SIGNAL_IGNORE_PENALTY} for ignoring signal entry")
            
            # Bonus for exiting at correct conditions (if in short position)
            if self.current_position == -1:  # Short position
                current_price = self._get_current_price()
                signal_high = self.mountain_signal['high']
                
                # Exit bonus: Index Stop (close > signal.high)
                if action in [1, 3] and signal_high is not None and current_price > signal_high:
                    signal_reward += config.SIGNAL_EXIT_BONUS
                    logger.debug(f"[SIGNAL REWARD] +{config.SIGNAL_EXIT_BONUS} for Index Stop exit")
                
                # Exit bonus: Index Target pattern
                if action in [1, 3] and self._check_index_target_pattern():
                    signal_reward += config.SIGNAL_TARGET_BONUS
                    logger.debug(f"[SIGNAL REWARD] +{config.SIGNAL_TARGET_BONUS} for Index Target exit")
        
        return signal_reward
    
    def _is_end_of_day(self) -> bool:
        """Check if current candle is end of trading day (15:30)."""
        if self.current_index >= len(self.data):
            return False
        
        timestamp = self.data.iloc[self.current_index]['timestamp']
        if isinstance(timestamp, pd.Timestamp):
            return timestamp.hour == 15 and timestamp.minute >= 30
        return False
    
    def _get_current_price(self) -> float:
        """Get current close price (denormalized)."""
        if self.current_index >= len(self.data):
            return 0.0
        
        row = self.data.iloc[self.current_index]
        
        # Try to get original close price
        if '_orig_close' in row:
            return float(row['_orig_close'])
        
        # Otherwise denormalize from normalized value
        if 'close_norm' in row:
            close_norm = float(row['close_norm'])
            return self.price_min + close_norm * (self.price_max - self.price_min)
        
        # Fallback
        return float(row.get('close', 0))
    
    def _get_observation(self) -> np.ndarray:
        """Get current observation vector with all normalized features."""
        if self.current_index >= len(self.data):
            # Return last observation
            self.current_index = len(self.data) - 1
        
        row = self.data.iloc[self.current_index]
        
        # Extract normalized features in order matching STATE_DIM (15 features)
        obs = np.array([
            # OHLC (4)
            float(row.get('open_norm', 0.5)),
            float(row.get('high_norm', 0.5)),
            float(row.get('low_norm', 0.5)),
            float(row.get('close_norm', 0.5)),
            # EMA 5, 12 (2)
            float(row.get('ema5_norm', 0.5)),
            float(row.get('ema12_norm', 0.5)),
            # EMA crossover signal (1)
            float(row.get('ema_crossover_norm', 0.5)),
            # VWAP (1)
            float(row.get('vwap_norm', 0.5)),
            # RSI (1)
            float(row.get('rsi_norm', 0.5)),
            # ATR (1)
            float(row.get('atr_norm', 0.5)),
            # ADX (3)
            float(row.get('adx_norm', 0.0)),
            float(row.get('plus_di_norm', 0.0)),
            float(row.get('minus_di_norm', 0.0)),
        ], dtype=np.float32)
        
        # Add portfolio value change %
        if len(self.portfolio_value_history) > 1:
            prev_value = self.portfolio_value_history[-2]
            curr_value = self.portfolio_value_history[-1]
            portfolio_change_pct = ((curr_value - prev_value) / prev_value) if prev_value > 0 else 0.0
            # Normalize to [0, 1] (assuming max change is ±10%)
            portfolio_change_norm = np.clip((portfolio_change_pct + 0.1) / 0.2, 0, 1)
        else:
            portfolio_change_norm = 0.5
        
        # Add current position (-1, 0, 1) normalized to [0, 1]
        position_norm = (self.current_position + 1) / 2.0
        
        obs = np.append(obs, [portfolio_change_norm, position_norm])
        
        # Add Mountain Signal features (3 features)
        if config.MOUNTAIN_SIGNAL_ENABLED:
            if self.mountain_signal['type'] == 'PE':
                signal_active = 1.0
                # Normalize signal age (0-1, where 1 = very old signal)
                if self.mountain_signal['index'] is not None:
                    signal_age = min((self.current_index - self.mountain_signal['index']) / 100.0, 1.0)
                else:
                    signal_age = 0.0
                # Price vs signal low (normalized)
                current_price = self._get_current_price()
                if self.mountain_signal['low'] is not None and self.mountain_signal['low'] > 0:
                    price_vs_signal = (current_price - self.mountain_signal['low']) / self.mountain_signal['low']
                    price_vs_signal_norm = np.clip((price_vs_signal + 0.05) / 0.1, 0, 1)  # Normalize around signal low
                else:
                    price_vs_signal_norm = 0.5
            else:
                signal_active = 0.0
                signal_age = 0.0
                price_vs_signal_norm = 0.5
            
            obs = np.append(obs, [signal_active, signal_age, price_vs_signal_norm])
        
        return obs.astype(np.float32)
    
    def get_technical_analysis(self) -> Dict[str, Any]:
        """Get comprehensive technical analysis for decision reasoning."""
        if self.current_index >= len(self.data):
            return {}
        
        row = self.data.iloc[self.current_index]
        
        # Get denormalized values
        close = self._get_current_price()
        rsi = row.get('rsi', 50)
        ema5 = row.get('ema5', close)
        ema12 = row.get('ema12', close)
        vwap = row.get('vwap', close)
        atr = row.get('atr', 0)
        adx = row.get('adx', 0)
        plus_di = row.get('plus_di', 0)
        minus_di = row.get('minus_di', 0)
        
        # Calculate portfolio change
        if len(self.portfolio_value_history) > 1:
            portfolio_change = ((self.portfolio_value_history[-1] - self.portfolio_value_history[-2]) / 
                              self.portfolio_value_history[-2]) * 100
        else:
            portfolio_change = 0.0
        
        # EMA crossover analysis
        ema_crossover_signal = 'bullish' if ema5 > ema12 else ('bearish' if ema5 < ema12 else 'neutral')
        
        # ADX trend strength
        trend_strength = 'strong' if adx > 25 else ('moderate' if adx > 20 else 'weak')
        di_signal = 'bullish' if plus_di > minus_di else ('bearish' if plus_di < minus_di else 'neutral')
        
        # Top/Bottom identification signals
        # Top signal: RSI > 70, Price > VWAP + (ATR * 1.5), Strong uptrend
        price_vs_vwap_pct = ((close - vwap) / vwap * 100) if vwap > 0 else 0
        atr_pct = (atr / close * 100) if close > 0 else 0
        is_top_signal = (rsi > 70) and (price_vs_vwap_pct > atr_pct * 1.5) and (adx > 25) and (plus_di > minus_di)
        
        # Bottom signal: RSI < 30, Price < VWAP - (ATR * 1.5), Strong downtrend
        is_bottom_signal = (rsi < 30) and (price_vs_vwap_pct < -atr_pct * 1.5) and (adx > 25) and (minus_di > plus_di)
        
        analysis = {
            'price': close,
            'rsi': rsi,
            'ema5': ema5,
            'ema12': ema12,
            'vwap': vwap,
            'atr': atr,
            'adx': adx,
            'plus_di': plus_di,
            'minus_di': minus_di,
            # Derived signals
            'ema_crossover': ema_crossover_signal,
            'price_vs_vwap': 'above' if close > vwap else 'below',
            'price_vs_vwap_pct': price_vs_vwap_pct,
            'rsi_signal': 'oversold' if rsi < 30 else ('overbought' if rsi > 70 else 'neutral'),
            'trend_strength': trend_strength,
            'di_signal': di_signal,
            'trend': 'uptrend' if (plus_di > minus_di and adx > 25) else ('downtrend' if (minus_di > plus_di and adx > 25) else 'sideways'),
            'volatility': 'high' if atr > close * 0.02 else ('low' if atr < close * 0.01 else 'moderate'),
            'portfolio_change': portfolio_change,
            'position': 'long' if self.current_position == 1 else ('short' if self.current_position == -1 else 'none'),
            # Top/Bottom signals
            'is_top_signal': is_top_signal,
            'is_bottom_signal': is_bottom_signal
        }
        
        return analysis
    
    def generate_decision_reasoning(self, action: int, q_values: Dict[str, float]) -> str:
        """Generate human-readable reasoning for the decision."""
        analysis = self.get_technical_analysis()
        action_names = {0: 'HOLD', 1: 'BUY', 2: 'SELL', 3: 'CLOSE'}
        action_name = action_names.get(action, 'UNKNOWN')
        
        reasons = []
        
        # Q-value reasoning
        if not q_values.get('exploration', False):
            best_action = max([(k, v) for k, v in q_values.items() if k != 'exploration'], key=lambda x: x[1])
            reasons.append(f"Q-value: {best_action[0]}={best_action[1]:.3f} (highest)")
        else:
            reasons.append("Exploration: Random action selected")
        
        # Technical indicator reasoning (intraday focused)
        if analysis:
            # EMA crossover
            if analysis.get('ema_crossover') == 'bullish':
                reasons.append("EMA5 > EMA12 - bullish crossover")
            elif analysis.get('ema_crossover') == 'bearish':
                reasons.append("EMA5 < EMA12 - bearish crossover")
            
            # RSI signal (top/bottom identification)
            if analysis.get('rsi_signal') == 'oversold':
                reasons.append("RSI oversold (<30) - potential bottom")
            elif analysis.get('rsi_signal') == 'overbought':
                reasons.append("RSI overbought (>70) - potential top")
            
            # Top/Bottom signals
            if analysis.get('is_top_signal'):
                reasons.append("TOP SIGNAL: RSI>70 + Price>VWAP+ATR + Strong uptrend")
            elif analysis.get('is_bottom_signal'):
                reasons.append("BOTTOM SIGNAL: RSI<30 + Price<VWAP-ATR + Strong downtrend")
            
            # Trend analysis (using ADX)
            if analysis.get('trend') == 'uptrend':
                reasons.append(f"Uptrend: ADX={analysis.get('adx', 0):.1f}, +DI > -DI")
            elif analysis.get('trend') == 'downtrend':
                reasons.append(f"Downtrend: ADX={analysis.get('adx', 0):.1f}, -DI > +DI")
            
            # ADX trend strength
            if analysis.get('trend_strength') == 'strong':
                reasons.append(f"Strong trend (ADX={analysis.get('adx', 0):.1f})")
            
            # VWAP analysis (intraday reference)
            price_vs_vwap_pct = analysis.get('price_vs_vwap_pct', 0)
            if price_vs_vwap_pct > 0.5:  # Price significantly above VWAP
                reasons.append(f"Price {price_vs_vwap_pct:.2f}% above VWAP - potential top")
            elif price_vs_vwap_pct < -0.5:  # Price significantly below VWAP
                reasons.append(f"Price {abs(price_vs_vwap_pct):.2f}% below VWAP - potential bottom")
            
            # Volatility (ATR)
            volatility = analysis.get('volatility', 'moderate')
            if volatility == 'high':
                reasons.append("High volatility - wider stop-loss needed")
            
            if action == 1:  # BUY
                if analysis.get('is_bottom_signal'):
                    reasons.append("Buying at identified bottom")
                elif analysis.get('price_vs_vwap') == 'below':
                    reasons.append("Price below VWAP - buying dip")
            elif action == 2:  # SELL
                if analysis.get('is_top_signal'):
                    reasons.append("Selling at identified top")
                elif analysis.get('position') == 'long':
                    reasons.append("Exiting long position")
                elif analysis.get('position') == 'none':
                    reasons.append("Entering short position")
        
        # Portfolio reasoning
        if analysis.get('portfolio_change', 0) < -2:
            reasons.append(f"Portfolio down {analysis['portfolio_change']:.2f}% - risk management")
        
        if not reasons:
            reasons.append("RL agent decision based on learned patterns")
        
        return f"{action_name}: " + " | ".join(reasons)
    
    def _get_info(self) -> Dict[str, Any]:
        """Get additional info about current state."""
        return {
            'current_index': self.current_index,
            'portfolio_value': self.portfolio_value_history[-1] if self.portfolio_value_history else self.initial_balance,
            'position': self.current_position,
            'total_trades': len(self.trade_history),
            'current_price': self._get_current_price()
        }

