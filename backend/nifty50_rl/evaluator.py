"""
Evaluation module for trained DQN agent
"""
import logging
import numpy as np
from typing import Dict, Any, List
from nifty_trading_env import NiftyTradingEnv
from dqn_agent import DQNAgent
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


def calculate_metrics(trade_history: List[Dict[str, Any]], initial_balance: float, final_balance: float) -> Dict[str, Any]:
    """
    Calculate trading performance metrics.
    
    Args:
        trade_history: List of trade dictionaries
        initial_balance: Starting balance
        final_balance: Ending balance
    
    Returns:
        Dictionary with calculated metrics
    """
    if not trade_history:
        return {
            'total_trades': 0,
            'win_rate': 0.0,
            'cumulative_return': 0.0,
            'sharpe_ratio': 0.0,
            'avg_win': 0.0,
            'avg_loss': 0.0,
            'max_drawdown': 0.0
        }
    
    # Basic stats
    total_trades = len(trade_history)
    winning_trades = [t for t in trade_history if t.get('pnl', 0) > 0]
    losing_trades = [t for t in trade_history if t.get('pnl', 0) <= 0]
    
    win_rate = (len(winning_trades) / total_trades * 100) if total_trades > 0 else 0.0
    
    # PnL stats
    total_pnl = sum(t.get('pnl', 0) for t in trade_history)
    cumulative_return = ((final_balance - initial_balance) / initial_balance) * 100
    
    avg_win = np.mean([t['pnl'] for t in winning_trades]) if winning_trades else 0.0
    avg_loss = np.mean([t['pnl'] for t in losing_trades]) if losing_trades else 0.0
    
    # Sharpe Ratio (simplified)
    if total_trades > 1:
        returns = [t.get('pnl_pct', 0) for t in trade_history]
        mean_return = np.mean(returns)
        std_return = np.std(returns)
        sharpe_ratio = (mean_return / std_return) if std_return > 0 else 0.0
    else:
        sharpe_ratio = 0.0
    
    # Max Drawdown
    cumulative_pnl = 0
    equity_curve = [initial_balance]
    for trade in trade_history:
        cumulative_pnl += trade.get('pnl', 0)
        equity_curve.append(initial_balance + cumulative_pnl)
    
    if len(equity_curve) > 1:
        running_max = np.maximum.accumulate(equity_curve)
        drawdowns = (equity_curve - running_max) / running_max * 100
        max_drawdown = abs(np.min(drawdowns))
    else:
        max_drawdown = 0.0
    
    return {
        'total_trades': total_trades,
        'winning_trades': len(winning_trades),
        'losing_trades': len(losing_trades),
        'win_rate': win_rate,
        'cumulative_return': cumulative_return,
        'total_pnl': total_pnl,
        'sharpe_ratio': sharpe_ratio,
        'avg_win': avg_win,
        'avg_loss': avg_loss,
        'max_drawdown': max_drawdown,
        'final_balance': final_balance
    }


def evaluate_agent(
    env: NiftyTradingEnv,
    agent: DQNAgent,
    policy: str = 'deterministic'
) -> Dict[str, Any]:
    """
    Evaluate trained agent on environment.
    
    Args:
        env: Trading environment with test data
        agent: Trained DQN agent
        policy: Policy to use ('deterministic' for evaluation)
    
    Returns:
        Dictionary with evaluation results
    """
    logger.info(f"Starting evaluation with {policy} policy...")
    
    state, info = env.reset()
    done = False
    truncated = False
    step_count = 0
    total_steps = len(env.data)
    
    while not done and not truncated:
        # Select action with Q-values
        action, q_values = agent.select_action(state, policy=policy, return_q_values=True)
        
        # Log Q-values for trade decisions (console only, filtered from file)
        if action in [1, 2]:  # BUY or SELL
            logger.info(f"[Q-VALUES] HOLD={q_values['HOLD']:.3f} | "
                       f"BUY={q_values['BUY']:.3f} | "
                       f"SELL={q_values['SELL']:.3f} | "
                       f"CLOSE={q_values['CLOSE']:.3f}")
        
        # Execute action with Q-values for reasoning
        next_state, reward, done, truncated, step_info = env.step(action, q_values=q_values)
        
        state = next_state
        step_count += 1
        
        # Show progress every 5000 steps
        if step_count % 5000 == 0:
            progress_pct = (step_count / total_steps) * 100
            print(f"\r[EVALUATION] Progress: {progress_pct:.1f}% ({step_count}/{total_steps})", 
                  end='', flush=True)
    
    print()  # New line after progress
    
    # Calculate metrics
    initial_balance = env.initial_balance
    final_balance = env.portfolio_value_history[-1] if env.portfolio_value_history else initial_balance
    
    metrics = calculate_metrics(env.trade_history, initial_balance, final_balance)
    
    logger.info(f"✓ Evaluation complete")
    logger.info(f"  Total Trades: {metrics['total_trades']}")
    logger.info(f"  Win Rate: {metrics['win_rate']:.1f}%")
    logger.info(f"  Cumulative Return: {metrics['cumulative_return']:.2f}%")
    logger.info(f"  Sharpe Ratio: {metrics['sharpe_ratio']:.2f}")
    logger.info(f"  Max Drawdown: {metrics['max_drawdown']:.2f}%")
    
    return {
        'metrics': metrics,
        'trade_history': env.trade_history,
        'portfolio_history': env.portfolio_value_history,
        'initial_balance': initial_balance,
        'final_balance': final_balance,
        'data': env.data  # Include processed data for CSV export
    }

