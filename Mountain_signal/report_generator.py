"""
CSV Report Generator
Generates comprehensive CSV reports with all trade details and analytics
"""
import os
import csv
from typing import List, Dict, Any
from datetime import datetime
import logging

from .config import REPORTS_DIR

logger = logging.getLogger(__name__)


class ReportGenerator:
    """Generates CSV reports with all trade details"""
    
    def __init__(self, output_dir: str = REPORTS_DIR):
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)
    
    def generate_trade_report(
        self, 
        trades: List[Dict[str, Any]], 
        signals: List[Dict[str, Any]],
        summary_stats: Dict[str, Any]
    ) -> str:
        """
        Generate comprehensive CSV report with all trade details
        
        Args:
            trades: List of trade records
            signals: List of signal records
            summary_stats: Summary statistics dictionary
        
        Returns:
            Path to generated CSV file
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"backtest_report_{timestamp}.csv"
        filepath = os.path.join(self.output_dir, filename)
        
        # Define all required columns for index trading only
        columns = [
            'trade_id', 'signal_time', 'signal_type', 'signal_high', 'signal_low', 'signal_candle_index',
            'entry_time', 'entry_price', 'entry_candle_index', 'entry_ema5', 'entry_rsi14',
            'exit_time', 'exit_price', 'exit_candle_index', 'exit_reason', 'exit_ema5', 'exit_rsi14',
            'index_pnl', 'index_pnl_percent',
            'trade_duration_minutes', 'trade_duration_candles',
            'lot_size', 'instrument'
        ]
        
        # Write CSV file
        with open(filepath, 'w', newline='', encoding='utf-8-sig') as f:
            writer = csv.DictWriter(f, fieldnames=columns)
            writer.writeheader()
            
            # Write trade rows
            for i, trade in enumerate(trades, 1):
                row = self._trade_to_row(trade, i)
                writer.writerow(row)
            
            # Write summary rows
            self._write_summary_rows(writer, trades, summary_stats)
        
        logger.info(f"Report generated: {filepath}")
        return filepath
    
    def _trade_to_row(self, trade: Dict[str, Any], trade_id: int) -> Dict[str, Any]:
        """Convert trade record to CSV row"""
        # Get signal data
        signal = trade.get('signal', {})
        if not isinstance(signal, dict):
            signal = {}
        
        # Format datetime values
        signal_time = self._format_datetime(signal.get('time'))
        entry_time = self._format_datetime(trade.get('entry_time'))
        exit_time = self._format_datetime(trade.get('exit_time'))
        trade_date = self._format_date(trade.get('trade_date'))
        
        # Build row with index trading columns only
        row = {
            'trade_id': trade_id,
            'signal_time': signal_time,
            'signal_type': signal.get('type', 'PE'),
            'signal_high': self._format_number(signal.get('high')),
            'signal_low': self._format_number(signal.get('low')),
            'signal_candle_index': signal.get('candle_index', ''),
            'entry_time': entry_time,
            'entry_price': self._format_number(trade.get('entry_price')),
            'entry_candle_index': trade.get('entry_candle_index', ''),
            'entry_ema5': self._format_number(trade.get('entry_ema5')),
            'entry_rsi14': self._format_number(trade.get('entry_rsi14')),
            'exit_time': exit_time,
            'exit_price': self._format_number(trade.get('exit_price')),
            'exit_candle_index': trade.get('exit_candle_index', ''),
            'exit_reason': trade.get('exit_reason', ''),
            'exit_ema5': self._format_number(trade.get('exit_ema5')),
            'exit_rsi14': self._format_number(trade.get('exit_rsi14')),
            'index_pnl': self._format_number(trade.get('index_pnl', trade.get('pnl', 0))),
            'index_pnl_percent': self._format_number(trade.get('index_pnl_percent', trade.get('pnl_percent', 0))),
            'trade_duration_minutes': self._format_number(trade.get('trade_duration_minutes')),
            'trade_duration_candles': trade.get('trade_duration_candles', ''),
            'lot_size': trade.get('lot_size', ''),
            'instrument': trade.get('instrument', '')
        }
        return row
    
    def _format_datetime(self, dt) -> str:
        """Format datetime to string"""
        if dt is None:
            return ''
        if isinstance(dt, str):
            return dt
        if isinstance(dt, datetime):
            return dt.strftime("%Y-%m-%d %H:%M:%S")
        try:
            import pandas as pd
            if isinstance(dt, pd.Timestamp):
                return dt.strftime("%Y-%m-%d %H:%M:%S")
        except:
            pass
        return str(dt)
    
    def _format_date(self, d) -> str:
        """Format date to string"""
        if d is None:
            return ''
        from datetime import date
        if isinstance(d, str):
            return d
        if isinstance(d, date):
            return d.strftime("%Y-%m-%d")
        if isinstance(d, datetime):
            return d.date().strftime("%Y-%m-%d")
        try:
            import pandas as pd
            if isinstance(d, pd.Timestamp):
                return d.strftime("%Y-%m-%d")
        except:
            pass
        return str(d)
    
    def _format_number(self, value) -> str:
        """Format number to string"""
        if value is None or value == '':
            return ''
        try:
            num = float(value)
            if num == int(num):
                return str(int(num))
            return f"{num:.2f}"
        except (ValueError, TypeError):
            return str(value) if value else ''
    
    def _write_summary_rows(self, writer, trades: List[Dict[str, Any]], summary_stats: Dict[str, Any]):
        """Write summary statistics rows to CSV"""
        # Get column names for empty cells
        columns = writer.fieldnames
        
        # Overall statistics
        writer.writerow({col: '' for col in columns})  # Empty row
        writer.writerow({col: ('=== SUMMARY ===' if col == 'trade_id' else '') for col in columns})
        writer.writerow({col: (f"Total Trades: {summary_stats.get('total_trades', len(trades))}" if col == 'trade_id' else '') for col in columns})
        writer.writerow({col: (f"Winning Trades: {summary_stats.get('winning_trades', 0)}" if col == 'trade_id' else '') for col in columns})
        writer.writerow({col: (f"Losing Trades: {summary_stats.get('losing_trades', 0)}" if col == 'trade_id' else '') for col in columns})
        writer.writerow({col: (f"Win Rate: {summary_stats.get('win_rate', 0):.2f}%" if col == 'trade_id' else '') for col in columns})
        writer.writerow({col: (f"Total Index P&L: {summary_stats.get('total_index_pnl', 0):.2f}" if col == 'trade_id' else '') for col in columns})
        writer.writerow({col: (f"Average Win: {summary_stats.get('average_win', 0):.2f}" if col == 'trade_id' else '') for col in columns})
        writer.writerow({col: (f"Average Loss: {summary_stats.get('average_loss', 0):.2f}" if col == 'trade_id' else '') for col in columns})
        writer.writerow({col: (f"Largest Win: {summary_stats.get('largest_win', 0):.2f}" if col == 'trade_id' else '') for col in columns})
        writer.writerow({col: (f"Largest Loss: {summary_stats.get('largest_loss', 0):.2f}" if col == 'trade_id' else '') for col in columns})
        writer.writerow({col: (f"Profit Factor: {summary_stats.get('profit_factor', 0):.2f}" if col == 'trade_id' else '') for col in columns})
        writer.writerow({col: (f"Average Trade Duration: {summary_stats.get('average_trade_duration', 0):.2f} minutes" if col == 'trade_id' else '') for col in columns})
        
        # Day-wise statistics
        writer.writerow({col: '' for col in columns})  # Empty row
        writer.writerow({col: ('=== DAY-WISE STATISTICS ===' if col == 'trade_id' else '') for col in columns})
        
        daywise_stats = self._calculate_daywise_stats(trades)
        writer.writerow({col: ('Date | Trades | Wins | Losses | Day P&L | Cumulative P&L' if col == 'trade_id' else '') for col in columns})
        cumulative_pnl = 0.0
        for day_stat in daywise_stats:
            cumulative_pnl += day_stat['day_pnl']
            writer.writerow({
                col: (
                    f"{day_stat['date']} | {day_stat['trades']} | {day_stat['wins']} | {day_stat['losses']} | {day_stat['day_pnl']:.2f} | {cumulative_pnl:.2f}"
                    if col == 'trade_id' else ''
                ) for col in columns
            })
        
        # Exit type breakdown
        writer.writerow({col: '' for col in columns})  # Empty row
        writer.writerow({col: ('=== EXIT TYPE BREAKDOWN ===' if col == 'trade_id' else '') for col in columns})
        
        exit_breakdown = self._calculate_exit_breakdown(trades)
        writer.writerow({col: ('Exit Type | Count | Total P&L' if col == 'trade_id' else '') for col in columns})
        for exit_type, stats in exit_breakdown.items():
            writer.writerow({
                col: (
                    f"{exit_type} | {stats['count']} | {stats['pnl']:.2f}"
                    if col == 'trade_id' else ''
                ) for col in columns
            })
    
    def _calculate_daywise_stats(self, trades: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Calculate day-wise statistics"""
        from collections import defaultdict
        from datetime import date, datetime
        
        day_stats = defaultdict(lambda: {'trades': 0, 'wins': 0, 'losses': 0, 'pnl': 0.0})
        
        for trade in trades:
            trade_date = trade.get('trade_date')
            if not trade_date:
                # Extract date from entry_time
                entry_time = trade.get('entry_time')
                if entry_time:
                    if isinstance(entry_time, str):
                        try:
                            trade_date = datetime.strptime(entry_time, "%Y-%m-%d %H:%M:%S").date()
                        except:
                            continue
                    elif isinstance(entry_time, datetime):
                        trade_date = entry_time.date()
                    else:
                        continue
                else:
                    continue
            
            if isinstance(trade_date, str):
                try:
                    trade_date = datetime.strptime(trade_date, "%Y-%m-%d").date()
                except:
                    continue
            
            day_key = trade_date.strftime("%Y-%m-%d") if isinstance(trade_date, date) else str(trade_date)
            
            day_stats[day_key]['trades'] += 1
            index_pnl = trade.get('index_pnl', trade.get('pnl', 0)) or 0
            if index_pnl > 0:
                day_stats[day_key]['wins'] += 1
            else:
                day_stats[day_key]['losses'] += 1
            day_stats[day_key]['pnl'] += index_pnl
        
        # Convert to list and sort by date
        result = []
        cumulative_pnl = 0.0
        for day_key in sorted(day_stats.keys()):
            stats = day_stats[day_key]
            cumulative_pnl += stats['pnl']
            result.append({
                'date': day_key,
                'trades': stats['trades'],
                'wins': stats['wins'],
                'losses': stats['losses'],
                'day_pnl': stats['pnl'],
                'cumulative_pnl': cumulative_pnl,
            })
        
        return result
    
    def _calculate_exit_breakdown(self, trades: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        """Calculate exit type breakdown"""
        from collections import defaultdict
        
        exit_breakdown = defaultdict(lambda: {'count': 0, 'pnl': 0.0})
        
        for trade in trades:
            exit_type = trade.get('exit_reason', 'UNKNOWN')
            index_pnl = trade.get('index_pnl', trade.get('pnl', 0)) or 0
            
            exit_breakdown[exit_type]['count'] += 1
            exit_breakdown[exit_type]['pnl'] += index_pnl
        
        return dict(exit_breakdown)
