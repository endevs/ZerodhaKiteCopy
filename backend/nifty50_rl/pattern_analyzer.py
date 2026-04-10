"""
Pattern identification and strategy extraction from RL results
"""
import logging
import numpy as np
from typing import Dict, Any, List
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


def identify_winning_patterns(trades: List[Dict[str, Any]], price_data: Any) -> List[Dict[str, Any]]:
    """
    Identify patterns in winning trades.
    
    Args:
        trades: List of trade dictionaries
        price_data: Price history DataFrame
    
    Returns:
        List of identified patterns
    """
    if not trades:
        return []
    
    winning_trades = [t for t in trades if t.get('pnl', 0) > 0]
    if not winning_trades:
        return []
    
    patterns = []
    
    # Analyze entry conditions for winning trades
    entry_prices = [t.get('entry_price', 0) for t in winning_trades]
    exit_prices = [t.get('exit_price', 0) for t in winning_trades]
    
    avg_entry = np.mean(entry_prices)
    avg_exit = np.mean(exit_prices)
    avg_profit_pct = np.mean([t.get('pnl_pct', 0) for t in winning_trades])
    
    patterns.append({
        'type': 'winning_entry',
        'description': f'Winning trades average entry: ₹{avg_entry:.2f}',
        'avg_profit_pct': avg_profit_pct
    })
    
    return patterns


def extract_strategy_rules(agent: Any, trades: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Extract learned strategy rules from agent and trades.
    
    Args:
        agent: Trained DQN agent
        trades: Trade history
    
    Returns:
        Dictionary with extracted rules
    """
    rules = {
        'entry_conditions': [],
        'exit_conditions': [],
        'risk_management': {}
    }
    
    if trades:
        # Analyze winning trades for entry patterns
        winning_trades = [t for t in trades if t.get('pnl', 0) > 0]
        if winning_trades:
            avg_hold_time = np.mean([
                t.get('exit_index', 0) - t.get('entry_index', 0) 
                for t in winning_trades
            ])
            rules['entry_conditions'].append(f'Average hold time: {avg_hold_time:.0f} candles')
    
    return rules


def find_optimal_stop_loss_target(trades: List[Dict[str, Any]]) -> Dict[str, float]:
    """
    Determine optimal stop-loss and target based on trade results.
    
    Args:
        trades: Trade history
    
    Returns:
        Dictionary with optimal stop_loss and target percentages
    """
    if not trades:
        return {'stop_loss': -2.0, 'target': 2.0}
    
    # Analyze losing trades for stop loss
    losing_trades = [t for t in trades if t.get('pnl', 0) < 0]
    if losing_trades:
        avg_loss_pct = np.mean([abs(t.get('pnl_pct', 0)) for t in losing_trades])
        optimal_stop_loss = -min(avg_loss_pct * 0.8, 3.0)  # 80% of avg loss, max 3%
    else:
        optimal_stop_loss = -2.0
    
    # Analyze winning trades for target
    winning_trades = [t for t in trades if t.get('pnl', 0) > 0]
    if winning_trades:
        avg_win_pct = np.mean([t.get('pnl_pct', 0) for t in winning_trades])
        optimal_target = max(avg_win_pct * 0.7, 1.5)  # 70% of avg win, min 1.5%
    else:
        optimal_target = 2.0
    
    return {
        'stop_loss': optimal_stop_loss,
        'target': optimal_target
    }


def generate_pattern_summary(patterns: List[Dict[str, Any]]) -> str:
    """
    Create human-readable summary of identified patterns.
    
    Args:
        patterns: List of pattern dictionaries
    
    Returns:
        Natural language summary
    """
    if not patterns:
        return "No significant patterns identified."
    
    summary = "Identified Patterns:\n"
    for i, pattern in enumerate(patterns[:5], 1):
        desc = pattern.get('description', 'Pattern')
        summary += f"{i}. {desc}\n"
    
    return summary

