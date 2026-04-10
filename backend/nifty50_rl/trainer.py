"""
Training orchestration for DQN agent
"""
import logging
import numpy as np
from typing import Dict, Any
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


def train_agent(
    env: NiftyTradingEnv,
    agent: DQNAgent,
    episodes: int = 100,
    policy: str = 'stochastic'
) -> Dict[str, Any]:
    """
    Train DQN agent on environment.
    
    Args:
        env: Trading environment
        agent: DQN agent
        episodes: Number of training episodes
        policy: Policy to use ('stochastic' for training)
    
    Returns:
        Dictionary with training metrics
    """
    logger.info(f"Starting training: {episodes} episodes, policy={policy}")
    
    episode_rewards = []
    episode_portfolio_values = []
    episode_win_rates = []
    
    for episode in range(episodes):
        state, info = env.reset()
        episode_reward = 0.0
        episode_trades = []
        done = False
        truncated = False
        
        step_count = 0
        while not done and not truncated:
            # Select action
            action = agent.select_action(state, policy=policy)
            
            # Execute action
            next_state, reward, done, truncated, step_info = env.step(action)
            
            # Store transition
            agent.store_transition(state, action, reward, next_state, done)
            
            # Train agent
            loss = agent.train_step()
            
            # Update state
            state = next_state
            episode_reward += reward
            step_count += 1
        
        # Decay epsilon
        agent.decay_epsilon()
        
        # Collect metrics
        final_portfolio = env.portfolio_value_history[-1] if env.portfolio_value_history else env.initial_balance
        episode_portfolio_values.append(final_portfolio)
        episode_rewards.append(episode_reward)
        
        # Calculate win rate
        if env.trade_history:
            winning_trades = sum(1 for t in env.trade_history if t.get('pnl', 0) > 0)
            win_rate = (winning_trades / len(env.trade_history)) * 100
        else:
            win_rate = 0.0
        episode_win_rates.append(win_rate)
        
        # Show progress with percentage
        progress_pct = ((episode + 1) / episodes) * 100
        
        # Log progress every episode or every 10 episodes
        if (episode + 1) % 10 == 0 or episode == 0 or (episode + 1) == episodes:
            logger.info(
                f"[TRAINING] Progress: {progress_pct:.1f}% ({episode + 1}/{episodes}) | "
                f"Portfolio: ₹{final_portfolio:,.0f} | "
                f"Epsilon: {agent.epsilon:.3f} | "
                f"Reward: {episode_reward:.2f} | "
                f"Win Rate: {win_rate:.1f}% | "
                f"Trades: {len(env.trade_history)}"
            )
        else:
            # Show minimal progress for other episodes (console only, not file)
            print(f"\r[TRAINING] Progress: {progress_pct:.1f}% ({episode + 1}/{episodes}) | "
                  f"Epsilon: {agent.epsilon:.3f} | "
                  f"Win Rate: {win_rate:.1f}%", end='', flush=True)
    
    # Final summary
    print()  # New line after progress
    
    # Calculate final metrics
    final_metrics = {
        'episodes': episodes,
        'final_portfolio': episode_portfolio_values[-1],
        'avg_reward': np.mean(episode_rewards),
        'final_win_rate': episode_win_rates[-1] if episode_win_rates else 0.0,
        'total_trades': len(env.trade_history),
        'final_epsilon': agent.epsilon
    }
    
    logger.info(f"✓ Training complete")
    logger.info(f"  Final Portfolio: ₹{final_metrics['final_portfolio']:,.0f}")
    logger.info(f"  Final Win Rate: {final_metrics['final_win_rate']:.1f}%")
    logger.info(f"  Total Trades: {final_metrics['total_trades']}")
    
    return final_metrics

