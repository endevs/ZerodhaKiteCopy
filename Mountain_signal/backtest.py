"""
Backtesting Engine
Runs strategy on historical data and generates reports
"""
import pandas as pd
from typing import List, Dict, Any, Optional
from datetime import datetime
import logging

from .strategy_engine import MountainSignalStrategy
from .indicators import calculate_indicators
from .config import EMA_PERIOD, RSI_PERIOD
from .report_generator import ReportGenerator

logger = logging.getLogger(__name__)


class MountainSignalBacktester:
    """Backtesting engine for Mountain Signal Strategy"""
    
    def __init__(self, instrument_key: str = "BANKNIFTY"):
        self.instrument_key = instrument_key
        self.strategy = MountainSignalStrategy(instrument_key)
        self.report_generator = ReportGenerator()
    
    def run_backtest(self, df: pd.DataFrame, from_date: Optional[datetime] = None, 
                     to_date: Optional[datetime] = None) -> tuple:
        """
        Run backtest on historical data
        
        Args:
            df: DataFrame with OHLC data (must have columns: open, high, low, close, date/time)
            from_date: Start date (optional, for filtering)
            to_date: End date (optional, for filtering)
        
        Returns:
            Tuple of (trades_df, results_dict, report_path)
        """
        # Ensure required columns exist
        required_columns = ['open', 'high', 'low', 'close']
        for col in required_columns:
            if col not in df.columns:
                raise ValueError(f"DataFrame must have '{col}' column")
        
        # Ensure date column exists
        if 'date' not in df.columns:
            if 'time' in df.columns:
                df['date'] = pd.to_datetime(df['time'])
            elif 'timestamp' in df.columns:
                df['date'] = pd.to_datetime(df['timestamp'])
            else:
                # Create date column from index if possible
                if isinstance(df.index, pd.DatetimeIndex):
                    df['date'] = df.index
                else:
                    raise ValueError("DataFrame must have 'date', 'time', or 'timestamp' column, or datetime index")
        
        logger.info(f"Starting backtest for {self.instrument_key}")
        logger.info(f"Data range: {df.iloc[0]['date']} to {df.iloc[-1]['date']}")
        logger.info(f"Total candles: {len(df)}")
        
        # Calculate indicators
        df_with_indicators = calculate_indicators(df, EMA_PERIOD, RSI_PERIOD)
        
        # Process each candle
        all_events = []
        for idx, row in df_with_indicators.iterrows():
            # Get candle time
            candle_time = row.get('date')
            if candle_time is None:
                candle_time = row.get('time', datetime.now())
            if isinstance(candle_time, pd.Timestamp):
                candle_time = candle_time.to_pydatetime()
            
            candle_data = {
                'open': float(row['open']),
                'high': float(row['high']),
                'low': float(row['low']),
                'close': float(row['close']),
                'time': candle_time,
                'index': int(idx),
                'start_time': candle_time,
            }
            
            # Get indicators (handle NaN values)
            ema5 = row.get('ema', 0)
            rsi14 = row.get('rsi', 0)
            
            # Handle NaN/None values
            if pd.isna(ema5) or ema5 is None:
                ema5 = 0
            if pd.isna(rsi14) or rsi14 is None:
                rsi14 = 0
            
            indicators = {
                'ema5': float(ema5),
                'rsi14': float(rsi14),
            }
            
            # #region agent log - DISABLED for performance
            # DEBUG_LOGGING = False  # Set to True only when debugging
            # if DEBUG_LOGGING and (idx < 5 or idx % 100 == 0):
            #     import json
            #     import os
            #     from datetime import datetime
            #     try:
            #         log_file = os.path.join(r'd:\WorkSpace\ZerodhaKiteGit\.cursor', 'debug.log')
            #         with open(log_file, 'a', encoding='utf-8') as f:
            #             f.write(json.dumps({'location': 'backtest.py:process_candle', 'message': 'processing candle in backtest', 'data': {'idx': int(idx), 'candle_close': float(row['close']), 'candle_low': float(row['low']), 'ema5': indicators['ema5'], 'rsi14': indicators['rsi14'], 'ema5_valid': not pd.isna(ema5), 'rsi14_valid': not pd.isna(rsi14)}, 'timestamp': int(datetime.now().timestamp() * 1000), 'sessionId': 'debug-session', 'runId': 'run1', 'hypothesisId': 'H1'}) + '\n')
            #     except Exception as e:
            #         pass
            # #endregion
            
            events = self.strategy.process_candle(candle_data, indicators)
            all_events.extend(events)
        
        # Force close any open positions at end of backtest
        if self.strategy.active_trade:
            logger.info(f"Force closing open position at end of backtest")
            # Create a dummy candle for exit
            last_candle = df_with_indicators.iloc[-1]
            last_candle_time = last_candle.get('date')
            if last_candle_time is None:
                last_candle_time = last_candle.get('time', datetime.now())
            if isinstance(last_candle_time, pd.Timestamp):
                last_candle_time = last_candle_time.to_pydatetime()
            
            exit_candle = {
                'open': float(last_candle['open']),
                'high': float(last_candle['high']),
                'low': float(last_candle['low']),
                'close': float(last_candle['close']),
                'time': last_candle_time,
                'index': len(df_with_indicators) - 1,
                'start_time': last_candle_time,
            }
            
            exit_indicators = {
                'ema5': float(last_candle.get('ema', 0)) if not pd.isna(last_candle.get('ema', 0)) else 0,
                'rsi14': float(last_candle.get('rsi', 0)) if not pd.isna(last_candle.get('rsi', 0)) else 0,
            }
            
            self.strategy._handle_exit(exit_candle, exit_indicators, 'END_OF_BACKTEST')
            all_events.append({
                'type': 'trade_exited',
                'exit_reason': 'END_OF_BACKTEST',
                'time': last_candle_time,
                'exit_price': exit_candle['close'],
            })
        
        # Log signal and trade statistics
        logger.info(f"Signals identified: {len(self.strategy.signals)}")
        logger.info(f"Trades executed: {len(self.strategy.trades)}")
        
        # Generate summary statistics
        summary_stats = self._calculate_summary_stats(self.strategy.trades)
        
        # Generate report
        report_path = self.report_generator.generate_trade_report(
            trades=self.strategy.trades,
            signals=self.strategy.signals,
            summary_stats=summary_stats
        )
        
        # Convert trades to DataFrame
        trades_df = pd.DataFrame(self.strategy.trades)
        
        logger.info(f"Backtest complete: {len(self.strategy.trades)} trades")
        logger.info(f"Report saved: {report_path}")
        
        return trades_df, summary_stats, report_path
    
    def _calculate_summary_stats(self, trades: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Calculate summary statistics from trades using index P&L only"""
        if not trades:
            return {
                'total_trades': 0,
                'winning_trades': 0,
                'losing_trades': 0,
                'win_rate': 0.0,
                'total_index_pnl': 0.0,
            }
        
        # Use index_pnl for all calculations (fallback to pnl for backward compatibility)
        winning_trades = [t for t in trades if t.get('index_pnl', t.get('pnl', 0)) > 0]
        losing_trades = [t for t in trades if t.get('index_pnl', t.get('pnl', 0)) <= 0]
        
        total_index_pnl = sum(t.get('index_pnl', t.get('pnl', 0)) for t in trades)
        win_rate = (len(winning_trades) / len(trades)) * 100 if trades else 0.0
        
        # Calculate additional metrics using index_pnl
        avg_win = sum(t.get('index_pnl', t.get('pnl', 0)) for t in winning_trades) / len(winning_trades) if winning_trades else 0
        avg_loss = sum(t.get('index_pnl', t.get('pnl', 0)) for t in losing_trades) / len(losing_trades) if losing_trades else 0
        largest_win = max((t.get('index_pnl', t.get('pnl', 0)) for t in winning_trades), default=0)
        largest_loss = min((t.get('index_pnl', t.get('pnl', 0)) for t in losing_trades), default=0)
        
        # Profit factor
        total_wins = sum(t.get('index_pnl', t.get('pnl', 0)) for t in winning_trades)
        total_losses = abs(sum(t.get('index_pnl', t.get('pnl', 0)) for t in losing_trades))
        profit_factor = total_wins / total_losses if total_losses > 0 else 0
        
        # Average trade duration
        avg_duration = sum(t.get('trade_duration_minutes', 0) for t in trades) / len(trades) if trades else 0
        
        return {
            'total_trades': len(trades),
            'winning_trades': len(winning_trades),
            'losing_trades': len(losing_trades),
            'win_rate': win_rate,
            'total_index_pnl': total_index_pnl,
            'average_win': avg_win,
            'average_loss': avg_loss,
            'largest_win': largest_win,
            'largest_loss': largest_loss,
            'profit_factor': profit_factor,
            'average_trade_duration': avg_duration,
        }
