"""
Backtesting Performance Metrics
Calculates comprehensive performance metrics for strategy evaluation
"""
import pandas as pd
import numpy as np
from typing import Dict, List, Tuple


def calculate_sharpe_ratio(returns: pd.Series, risk_free_rate: float = 0.0) -> float:
    """
    Calculate Sharpe Ratio
    
    Args:
        returns: Series of returns
        risk_free_rate: Risk-free rate (default: 0.0)
    
    Returns:
        Sharpe ratio
    """
    if len(returns) == 0 or returns.std() == 0:
        return 0.0
    
    excess_returns = returns - risk_free_rate
    if excess_returns.std() == 0:
        return 0.0
    
    return (excess_returns.mean() / excess_returns.std()) * np.sqrt(252)  # Annualized


def calculate_max_drawdown(equity_curve: pd.Series) -> Tuple[float, float, float]:
    """
    Calculate Maximum Drawdown
    
    Args:
        equity_curve: Series of cumulative equity values
    
    Returns:
        Tuple of (max_drawdown_percent, max_drawdown_value, drawdown_duration)
    """
    if len(equity_curve) == 0:
        return 0.0, 0.0, 0.0
    
    # Calculate running maximum
    running_max = equity_curve.expanding().max()
    
    # Calculate drawdown
    drawdown = equity_curve - running_max
    drawdown_pct = (drawdown / running_max) * 100
    
    max_dd_pct = abs(drawdown_pct.min())
    max_dd_value = abs(drawdown.min())
    
    # Calculate drawdown duration
    is_drawdown = drawdown < 0
    drawdown_duration = is_drawdown.sum()
    
    return max_dd_pct, max_dd_value, drawdown_duration


def calculate_win_rate(trades: List[Dict]) -> Tuple[float, int, int]:
    """
    Calculate Win Rate
    
    Args:
        trades: List of trade dictionaries with 'pnl' key
    
    Returns:
        Tuple of (win_rate_percent, winning_trades, losing_trades)
    """
    if not trades:
        return 0.0, 0, 0
    
    winning = sum(1 for t in trades if t.get('pnl', 0) > 0)
    losing = sum(1 for t in trades if t.get('pnl', 0) < 0)
    total = len(trades)
    
    win_rate = (winning / total * 100) if total > 0 else 0.0
    
    return win_rate, winning, losing


def calculate_profit_factor(trades: List[Dict]) -> float:
    """
    Calculate Profit Factor (Gross Profit / Gross Loss)
    
    Args:
        trades: List of trade dictionaries with 'pnl' key
    
    Returns:
        Profit factor
    """
    gross_profit = sum(t.get('pnl', 0) for t in trades if t.get('pnl', 0) > 0)
    gross_loss = abs(sum(t.get('pnl', 0) for t in trades if t.get('pnl', 0) < 0))
    
    if gross_loss == 0:
        return float('inf') if gross_profit > 0 else 0.0
    
    return gross_profit / gross_loss


def calculate_average_trade(trades: List[Dict]) -> Tuple[float, float, float]:
    """
    Calculate Average Trade Statistics
    
    Args:
        trades: List of trade dictionaries with 'pnl' key
    
    Returns:
        Tuple of (average_pnl, average_win, average_loss)
    """
    if not trades:
        return 0.0, 0.0, 0.0
    
    pnls = [t.get('pnl', 0) for t in trades]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    
    avg_pnl = np.mean(pnls) if pnls else 0.0
    avg_win = np.mean(wins) if wins else 0.0
    avg_loss = np.mean(losses) if losses else 0.0
    
    return avg_pnl, avg_win, avg_loss


def generate_equity_curve(trades: List[Dict], initial_capital: float = 100000) -> pd.Series:
    """
    Generate Equity Curve from trades
    
    Args:
        trades: List of trade dictionaries with 'pnl' and 'date' keys
        initial_capital: Starting capital
    
    Returns:
        Series of cumulative equity values
    """
    if not trades:
        return pd.Series([initial_capital])
    
    # Sort trades by date
    sorted_trades = sorted(trades, key=lambda x: x.get('date', ''))
    
    # Calculate cumulative PnL
    cumulative_pnl = [sum(t.get('pnl', 0) for t in sorted_trades[:i+1]) 
                      for i in range(len(sorted_trades))]
    
    equity = [initial_capital + pnl for pnl in cumulative_pnl]
    
    dates = [t.get('date', '') for t in sorted_trades]
    
    return pd.Series(equity, index=dates)


def calculate_all_metrics(trades: List[Dict], initial_capital: float = 100000, 
                          risk_free_rate: float = 0.0) -> Dict:
    """
    Calculate all performance metrics
    
    Args:
        trades: List of trade dictionaries
        initial_capital: Starting capital
        risk_free_rate: Risk-free rate
    
    Returns:
        Dictionary with all metrics
    """
    if not trades:
        return {
            'total_trades': 0,
            'win_rate': 0.0,
            'total_pnl': 0.0,
            'sharpe_ratio': 0.0,
            'max_drawdown_pct': 0.0,
            'profit_factor': 0.0,
            'average_trade': 0.0
        }
    
    # Basic metrics
    total_trades = len(trades)
    total_pnl = sum(t.get('pnl', 0) for t in trades)
    win_rate, winning, losing = calculate_win_rate(trades)
    
    # Generate equity curve
    equity_curve = generate_equity_curve(trades, initial_capital)
    
    # Calculate returns
    returns = equity_curve.pct_change().dropna()
    
    # Advanced metrics
    sharpe = calculate_sharpe_ratio(returns, risk_free_rate)
    max_dd_pct, max_dd_value, dd_duration = calculate_max_drawdown(equity_curve)
    profit_factor = calculate_profit_factor(trades)
    avg_pnl, avg_win, avg_loss = calculate_average_trade(trades)
    
    # Return on Investment
    roi = (total_pnl / initial_capital) * 100 if initial_capital > 0 else 0.0
    
    return {
        'total_trades': total_trades,
        'winning_trades': winning,
        'losing_trades': losing,
        'win_rate': round(win_rate, 2),
        'total_pnl': round(total_pnl, 2),
        'roi_percent': round(roi, 2),
        'sharpe_ratio': round(sharpe, 2),
        'max_drawdown_pct': round(max_dd_pct, 2),
        'max_drawdown_value': round(max_dd_value, 2),
        'drawdown_duration': int(dd_duration),
        'profit_factor': round(profit_factor, 2),
        'average_trade': round(avg_pnl, 2),
        'average_win': round(avg_win, 2),
        'average_loss': round(avg_loss, 2),
        'best_trade': round(max((t.get('pnl', 0) for t in trades), default=0), 2),
        'worst_trade': round(min((t.get('pnl', 0) for t in trades), default=0), 2),
        'equity_curve': equity_curve.to_dict()
    }



