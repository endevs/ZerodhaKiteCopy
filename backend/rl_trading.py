"""
Reinforcement Learning Trading Environment
Based on Mountain Signal Strategy Rules
"""
import os
import pickle
import logging
import datetime
import random
import math
from collections import deque
from typing import Dict, List, Tuple, Any, Optional

import numpy as np
import pandas as pd
import torch
from torch import nn

from utils.indicators import calculate_rsi
from ai_ml import candles_to_dataframe
from rules import load_mountain_signal_pe_rules


RL_DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
if torch.cuda.is_available():
    torch.backends.cuda.matmul.allow_tf32 = True  # type: ignore[attr-defined]
    torch.backends.cudnn.allow_tf32 = True  # type: ignore[attr-defined]
logging.info(f"[RL] Torch device: {RL_DEVICE}")


def _compute_max_drawdown(trades: List[Dict[str, Any]]) -> float:
    equity = 0.0
    peak = 0.0
    max_drawdown = 0.0
    for trade in trades:
        pnl = float(trade.get('pnl', 0.0))
        equity += pnl
        if equity > peak:
            peak = equity
        drawdown = peak - equity
        if drawdown > max_drawdown:
            max_drawdown = drawdown
    return max_drawdown


class DQNNetwork(nn.Module):
    def __init__(self, state_dim: int, action_dim: int = 4):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(state_dim, 128),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(128, 128),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, action_dim),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class MountainSignalRLEnv:
    """RL Environment based on Mountain Signal PE Strategy"""
    
    def __init__(
        self,
        candles: List[Dict],
        symbol: str = "BANKNIFTY",
        initial_balance: float = 100000.0,
        lot_size: Optional[int] = None,
        rules: Optional[Dict[str, Any]] = None,
    ):
        self.symbol = symbol.upper()
        self.rules = rules or load_mountain_signal_pe_rules()
        self.option_trade_rules = self.rules.get("option_trade", {})
        self.strike_rounding = self.rules.get("strike_rounding", {})
        self.expiry_policy = self.rules.get("expiry_policy", {})
        lot_sizes = self.rules.get("lot_sizes", {})
        inferred_lot_size = int(lot_sizes.get(self.symbol, lot_size or 50))
        
        self.candles = candles
        self.df = candles_to_dataframe(candles)
        if len(self.df) < 20:
            raise ValueError("Need at least 20 candles for RL environment")
        
        # Calculate indicators
        self.df['ema5'] = self.df['close'].ewm(span=5, adjust=False).mean()
        if len(self.df) >= 15:
            self.df['rsi14'] = calculate_rsi(self.df['close'], period=14)
        else:
            self.df['rsi14'] = 50.0  # Default neutral
        
        self.initial_balance = initial_balance
        self.lot_size = inferred_lot_size
        self.stop_loss_pct = abs(self.option_trade_rules.get("stop_loss_percent", -0.17))
        self.target_pct = self.option_trade_rules.get("target_percent", 0.45)
        self.reset()
    
    def reset(self) -> np.ndarray:
        """Reset environment to initial state"""
        self.current_step = 20  # Start after enough candles for indicators
        self.balance = self.initial_balance
        self.position = 0  # 0: flat, -1: short (PE)
        self.entry_price = 0.0
        self.entry_step = -1
        self.pe_signal_candle_idx = None
        self.pe_signal_price_above_low = False
        self.total_trades = 0
        self.winning_trades = 0
        self.losing_trades = 0
        self.total_pnl = 0.0
        self.trade_history = []
        
        return self._get_state()
    
    def _get_state(self) -> np.ndarray:
        """Get current state vector for RL agent"""
        if self.current_step >= len(self.df):
            return np.zeros(15)  # Return zero state if out of bounds
        
        row = self.df.iloc[self.current_step]
        prev_row = self.df.iloc[self.current_step - 1] if self.current_step > 0 else row
        
        # State features:
        # 0-3: OHLC normalized
        # 4: EMA5 normalized
        # 5: RSI14 normalized (0-100 -> 0-1)
        # 6: Volume normalized
        # 7: Position flag (0 flat, 1 in PE trade)
        # 8: Entry price normalized
        # 9: PnL normalized
        # 10: PE signal active flag
        # 11: Signal validation flag (price > signal low)
        # 12: Steps since entry normalized
        
        price_mean = self.df['close'].mean()
        price_std = self.df['close'].std() + 1e-6
        
        position_flag = 1.0 if self.position == -1 else 0.0

        state = np.array([
            (row['open'] - price_mean) / price_std,
            (row['high'] - price_mean) / price_std,
            (row['low'] - price_mean) / price_std,
            (row['close'] - price_mean) / price_std,
            (row['ema5'] - price_mean) / price_std if not pd.isna(row['ema5']) else 0.0,
            row['rsi14'] / 100.0 if not pd.isna(row['rsi14']) else 0.5,
            min(row.get('volume', 0) / (self.df['volume'].max() + 1e-6), 1.0) if 'volume' in self.df.columns else 0.0,
            position_flag,
            (self.entry_price - price_mean) / price_std if self.entry_price > 0 else 0.0,
            np.tanh(self.total_pnl / 10000.0),  # Normalize PnL
            1.0 if self.pe_signal_candle_idx is not None else 0.0,
            1.0 if self.pe_signal_price_above_low else 0.0,
            min((self.current_step - self.entry_step) / 100.0, 1.0) if self.entry_step >= 0 else 0.0,
        ], dtype=np.float32)
        
        return state
    
    def _check_mountain_signals(self):
        """Check for Mountain Signal conditions (PE signal only)"""
        if self.current_step < 2:
            return
        
        prev_row = self.df.iloc[self.current_step - 1]
        prev_ema = prev_row['ema5']
        prev_rsi = prev_row['rsi14'] if not pd.isna(prev_row['rsi14']) else None
        
        # PE Signal: LOW > 5 EMA AND RSI > 70
        if not pd.isna(prev_ema) and prev_row['low'] > prev_ema:
            if prev_rsi is not None and prev_rsi > 70:
                self.pe_signal_candle_idx = self.current_step - 1
                self.pe_signal_price_above_low = False
    
    def step(self, action: int) -> Tuple[np.ndarray, float, bool, Dict]:
        """
        Execute action and return (next_state, reward, done, info)
        
        Actions:
        0: Hold/No action
        1: Enter Short (PE) if signal available
        2: Exit current position
        """
        if self.current_step >= len(self.df) - 1:
            return self._get_state(), 0.0, True, {'done': True}
        
        self._check_mountain_signals()
        
        current_row = self.df.iloc[self.current_step]
        current_price = current_row['close']
        reward = 0.0
        info = {}
        
        # Update price action validation
        if self.pe_signal_candle_idx is not None and self.position == 0:
            pe_signal_row = self.df.iloc[self.pe_signal_candle_idx]
            if current_row['high'] > pe_signal_row['low']:
                self.pe_signal_price_above_low = True
        
        # Execute action
        if action == 1 and self.position == 0:  # Enter Short (PE)
            if self.pe_signal_candle_idx is not None:
                pe_signal_row = self.df.iloc[self.pe_signal_candle_idx]
                # Check entry condition: CLOSE < signal LOW
                if current_price < pe_signal_row['low']:
                    is_first = (self.pe_signal_candle_idx not in [t.get('signal_idx') for t in self.trade_history])
                    if is_first or self.pe_signal_price_above_low:
                        self.position = -1
                        self.entry_price = current_price
                        self.entry_step = self.current_step
                        info['action'] = 'PE_ENTRY'
        
        elif action == 2 and self.position != 0:  # Exit
            pnl = (current_price - self.entry_price) * self.position * self.lot_size
            self.total_pnl += pnl
            self.balance += pnl
            
            self.total_trades += 1
            if pnl > 0:
                self.winning_trades += 1
            else:
                self.losing_trades += 1
            
            self.trade_history.append({
                'entry_step': self.entry_step,
                'exit_step': self.current_step,
                'entry_price': self.entry_price,
                'exit_price': current_price,
                'pnl': pnl,
                'position': 'PE',
                'signal_idx': self.pe_signal_candle_idx
            })
            
            reward = pnl / 100.0  # Scale reward
            self.position = 0
            self.entry_price = 0.0
            self.entry_step = -1
            info['action'] = 'EXIT'
            info['pnl'] = pnl
        
        # Check stop loss / target (Mountain Signal rules)
        if self.position != 0:
            if self.position == -1:  # Short (PE)
                pe_signal_row = self.df.iloc[self.pe_signal_candle_idx] if self.pe_signal_candle_idx is not None else None
                handled_exit = False
                if pe_signal_row is not None:
                    if self.entry_price > 0:
                        price_change_ratio = (self.entry_price - current_price) / max(self.entry_price, 1e-6)
                        if price_change_ratio <= -self.stop_loss_pct:
                            pnl = (current_price - self.entry_price) * (-1) * self.lot_size
                            self.total_pnl += pnl
                            self.balance += pnl
                            self.total_trades += 1
                            self.losing_trades += 1
                            reward = pnl / 100.0
                            self.trade_history.append({
                                'entry_step': self.entry_step,
                                'exit_step': self.current_step,
                                'entry_price': self.entry_price,
                                'exit_price': current_price,
                                'pnl': pnl,
                                'position': 'PE',
                                'exit_reason': 'OPTION_STOP_LOSS',
                                'signal_idx': self.pe_signal_candle_idx
                            })
                            self.position = 0
                            self.entry_price = 0.0
                            self.entry_step = -1
                            info['action'] = 'SL_HIT_OPTION'
                            handled_exit = True
                        elif price_change_ratio >= self.target_pct:
                            pnl = (current_price - self.entry_price) * (-1) * self.lot_size
                            self.total_pnl += pnl
                            self.balance += pnl
                            self.total_trades += 1
                            if pnl > 0:
                                self.winning_trades += 1
                            else:
                                self.losing_trades += 1
                            reward = pnl / 100.0
                            self.trade_history.append({
                                'entry_step': self.entry_step,
                                'exit_step': self.current_step,
                                'entry_price': self.entry_price,
                                'exit_price': current_price,
                                'pnl': pnl,
                                'position': 'PE',
                                'exit_reason': 'OPTION_TARGET',
                                'signal_idx': self.pe_signal_candle_idx
                            })
                            self.position = 0
                            self.entry_price = 0.0
                            self.entry_step = -1
                            info['action'] = 'TP_HIT_OPTION'
                            handled_exit = True
                    
                    if not handled_exit and current_price >= pe_signal_row['high']:
                        pnl = (current_price - self.entry_price) * (-1) * self.lot_size
                        self.total_pnl += pnl
                        self.balance += pnl
                        self.total_trades += 1
                        self.losing_trades += 1
                        reward = pnl / 100.0
                        self.trade_history.append({
                            'entry_step': self.entry_step,
                            'exit_step': self.current_step,
                            'entry_price': self.entry_price,
                            'exit_price': current_price,
                            'pnl': pnl,
                            'position': 'PE',
                            'exit_reason': 'SL',
                            'signal_idx': self.pe_signal_candle_idx
                        })
                        self.position = 0
                        self.entry_price = 0.0
                        self.entry_step = -1
                        info['action'] = 'SL_HIT'
                        handled_exit = True
                    
                    if not handled_exit and self.current_step >= self.entry_step + 1:
                        if current_row['high'] < current_row['ema5']:
                            if self.current_step >= 2:
                                prev_close = self.df.iloc[self.current_step - 1]['close']
                                prev_ema = self.df.iloc[self.current_step - 1]['ema5']
                                if prev_close > prev_ema and current_price > current_row['ema5']:
                                    pnl = (current_price - self.entry_price) * (-1) * self.lot_size
                                    self.total_pnl += pnl
                                    self.balance += pnl
                                    self.total_trades += 1
                                    if pnl > 0:
                                        self.winning_trades += 1
                                    else:
                                        self.losing_trades += 1
                                    reward = pnl / 100.0
                                    self.trade_history.append({
                                        'entry_step': self.entry_step,
                                        'exit_step': self.current_step,
                                        'entry_price': self.entry_price,
                                        'exit_price': current_price,
                                        'pnl': pnl,
                                        'position': 'PE',
                                        'exit_reason': 'TP',
                                        'signal_idx': self.pe_signal_candle_idx
                                    })
                                    self.position = 0
                                    self.entry_price = 0.0
                                    self.entry_step = -1
                                    info['action'] = 'TP_HIT'
                                    handled_exit = True
        
        # Small negative reward for holding (encourage action)
        if action == 0 and self.position == 0:
            reward = -0.01
        
        # Update step
        self.current_step += 1
        done = self.current_step >= len(self.df) - 1
        
        # Final reward based on total PnL if episode ends
        if done:
            reward += self.total_pnl / 1000.0
        
        next_state = self._get_state()
        return next_state, reward, done, info


def build_dqn_model(state_dim: int, action_dim: int = 3) -> DQNNetwork:
    return DQNNetwork(state_dim, action_dim)


def train_rl_agent(
    candles: List[Dict],
    symbol: str,
    model_dir: str,
    episodes: int = 100,
    epsilon: float = 1.0,
    epsilon_decay: float = 0.995,
    epsilon_min: float = 0.01,
    batch_size: int = 32,
    memory_size: int = 10000,
    gamma: float = 0.95
) -> Dict[str, Any]:
    """
    Train RL agent using DQN algorithm
    """
    os.makedirs(model_dir, exist_ok=True)
    
    rules = load_mountain_signal_pe_rules()
    env = MountainSignalRLEnv(candles, symbol=symbol, rules=rules)
    state_dim = len(env._get_state())
    action_dim = 3
    logging.info(f"[RL][{symbol}] Environment ready: state_dim={state_dim}, action_dim={action_dim}, candles={len(env.df)}")
    print(f"[RL][{symbol}] Environment ready: candles={len(env.df)}, state_dim={state_dim}, action_dim={action_dim}, lot_size={env.lot_size}", flush=True)
    logging.info(
        "[RL][%s] Starting DQN training | episodes=%d | epsilon=%.3f | epsilon_min=%.3f | epsilon_decay=%.3f | batch_size=%d | device=%s",
        symbol,
        episodes,
        epsilon,
        epsilon_min,
        epsilon_decay,
        batch_size,
        RL_DEVICE,
    )
    print(
        f"[RL][{symbol}] Starting DQN training | episodes={episodes} | epsilon={epsilon:.3f} | epsilon_decay={epsilon_decay:.3f} | device={RL_DEVICE}",
        flush=True,
    )
    
    policy_net = build_dqn_model(state_dim, action_dim).to(RL_DEVICE)
    target_net = build_dqn_model(state_dim, action_dim).to(RL_DEVICE)
    target_net.load_state_dict(policy_net.state_dict())
    target_net.eval()

    optimizer = torch.optim.Adam(policy_net.parameters(), lr=1e-3)
    criterion = nn.MSELoss()

    memory: deque = deque(maxlen=memory_size)
    target_update_steps = 100
    global_step = 0

    # Training metrics
    episode_rewards = []
    episode_pnls = []
    episode_trades = []
    episode_losses: List[float] = []
    
    for episode in range(episodes):
        state = env.reset()
        total_reward = 0.0
        done = False
        step_count = 0
        batch_loss_sum = 0.0
        batch_loss_count = 0
        logging.info(f"[RL][{symbol}] Episode {episode+1}/{episodes} started | epsilon={epsilon:.4f}")
        if episode == 0 or (episode + 1) % max(1, episodes // 10) == 0:
            print(f"[RL][{symbol}] Episode {episode+1}/{episodes} started | epsilon={epsilon:.4f}", flush=True)
        
        while not done and step_count < len(env.df) - 21:
            # Epsilon-greedy action selection
            if random.random() < epsilon:
                action = random.randrange(action_dim)
            else:
                with torch.no_grad():
                    state_tensor = torch.from_numpy(state).float().unsqueeze(0).to(RL_DEVICE)
                    q_values = policy_net(state_tensor)
                    action = int(torch.argmax(q_values, dim=1).item())
            
            # Execute action
            next_state, reward, done, info = env.step(action)
            total_reward += reward
            
            # Store experience
            memory.append((state, action, reward, next_state, done))
            
            # Train on batch
            if len(memory) >= batch_size:
                batch = random.sample(memory, batch_size)
                states = torch.from_numpy(np.stack([b[0] for b in batch])).float().to(RL_DEVICE)
                actions_tensor = torch.tensor([b[1] for b in batch], dtype=torch.long, device=RL_DEVICE)
                rewards_tensor = torch.tensor([b[2] for b in batch], dtype=torch.float32, device=RL_DEVICE)
                next_states = torch.from_numpy(np.stack([b[3] for b in batch])).float().to(RL_DEVICE)
                dones_tensor = torch.tensor([b[4] for b in batch], dtype=torch.float32, device=RL_DEVICE)

                policy_net.train()
                q_values = policy_net(states).gather(1, actions_tensor.unsqueeze(1)).squeeze(1)

                with torch.no_grad():
                    next_q_values = target_net(next_states).max(1)[0]
                    target_values = rewards_tensor + gamma * next_q_values * (1.0 - dones_tensor)

                loss = criterion(q_values, target_values)
                optimizer.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(policy_net.parameters(), max_norm=5.0)
                optimizer.step()
                batch_loss_sum += float(loss.item())
                batch_loss_count += 1
                global_step += 1
            
            state = next_state
            step_count += 1
            
            # Update target network periodically
            if global_step > 0 and global_step % target_update_steps == 0:
                target_net.load_state_dict(policy_net.state_dict())
        
        # Decay epsilon
        epsilon = max(epsilon_min, epsilon * epsilon_decay)
        
        # Record metrics
        episode_rewards.append(total_reward)
        episode_pnls.append(env.total_pnl)
        episode_trades.append(env.total_trades)
        avg_loss = batch_loss_sum / batch_loss_count if batch_loss_count > 0 else float("nan")
        episode_losses.append(avg_loss)
        logging.info(
            "[RL][%s] Episode %d finished | reward=%.3f | pnl=%.2f | trades=%d | avg_loss=%s",
            symbol,
            episode + 1,
            total_reward,
            env.total_pnl,
            env.total_trades,
            f"{avg_loss:.6f}" if batch_loss_count > 0 else "N/A",
        )
        if episode == 0 or (episode + 1) % max(1, episodes // 10) == 0 or (episode + 1) == episodes:
            print(
                f"[RL][{symbol}] Episode {episode+1}/{episodes} finished | reward={total_reward:.2f} | pnl={env.total_pnl:.2f} | trades={env.total_trades} | avg_loss={(avg_loss if batch_loss_count > 0 else float('nan')):.6f}",
                flush=True,
            )
        
        if (episode + 1) % 10 == 0 or episode == 0 or (episode + 1) == episodes:
            logging.info(
                f"[RL][{symbol}] Episode {episode+1}/{episodes} | Reward={total_reward:.2f} | "
                f"PnL={env.total_pnl:.2f} | Trades={env.total_trades} | Epsilon={epsilon:.4f}"
            )
    
    model_path = os.path.join(model_dir, f"{symbol}_rl_dqn.pt")
    torch.save(
        {
            "state_dict": policy_net.state_dict(),
            "state_dim": state_dim,
            "action_dim": action_dim,
        },
        model_path,
    )
    logging.info(f"[RL][{symbol}] Training complete. Model saved to {model_path}")
    print(f"[RL][{symbol}] Training complete. Model saved to {model_path}", flush=True)
    
    history_path = os.path.join(model_dir, f"{symbol}_rl_history.pkl")
    with open(history_path, 'wb') as f:
        pickle.dump({
            'episode_rewards': episode_rewards,
            'episode_pnls': episode_pnls,
            'episode_trades': episode_trades,
            'episode_losses': episode_losses,
            'final_epsilon': epsilon
        }, f)
    logging.info(f"[RL][{symbol}] Training history saved to {history_path}")
    print(f"[RL][{symbol}] Training history saved to {history_path}", flush=True)
    
    recent_losses = [loss for loss in episode_losses[-10:] if not math.isnan(loss)]
    avg_loss_recent = float(np.mean(recent_losses)) if recent_losses else float("nan")
    trade_count = env.total_trades
    win_ratio = (env.winning_trades / trade_count) if trade_count > 0 else 0.0
    max_drawdown = _compute_max_drawdown(env.trade_history)

    return {
        'model_path': model_path,
        'history_path': history_path,
        'episodes': episodes,
        'final_reward': episode_rewards[-1] if episode_rewards else 0.0,
        'final_pnl': episode_pnls[-1] if episode_pnls else 0.0,
        'total_trades': episode_trades[-1] if episode_trades else 0,
        'avg_reward': np.mean(episode_rewards[-10:]) if len(episode_rewards) >= 10 else 0.0,
        'avg_pnl': np.mean(episode_pnls[-10:]) if len(episode_pnls) >= 10 else 0.0,
        'avg_loss': avg_loss_recent,
        'trade_count': trade_count,
        'win_ratio': win_ratio,
        'winning_trades': env.winning_trades,
        'losing_trades': env.losing_trades,
        'max_drawdown': max_drawdown,
    }


def evaluate_rl_agent(
    candles: List[Dict],
    symbol: str,
    model_dir: str
) -> Dict[str, Any]:
    """Evaluate trained RL agent on test data"""
    model_path = os.path.join(model_dir, f"{symbol}_rl_dqn.pt")
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"RL model not found: {model_path}")
    
    checkpoint = torch.load(model_path, map_location=RL_DEVICE)
    state_dim = checkpoint.get("state_dim")
    action_dim = checkpoint.get("action_dim", 3)
    model = build_dqn_model(state_dim, action_dim).to(RL_DEVICE)
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    
    rules = load_mountain_signal_pe_rules()
    env = MountainSignalRLEnv(candles, symbol=symbol, rules=rules)
    logging.info(f"[RL][{symbol}] Evaluation started on {len(env.df)} candles using model {model_path}")
    
    state = env.reset()
    done = False
    actions_taken = []
    equity_series: List[Dict[str, Any]] = []
    initial_balance = env.initial_balance
    
    while not done:
        with torch.no_grad():
            state_tensor = torch.from_numpy(state).float().unsqueeze(0).to(RL_DEVICE)
            q_values = model(state_tensor)
            action = int(torch.argmax(q_values, dim=1).item())
        actions_taken.append(action)
        
        next_state, reward, done, info = env.step(action)
        state = next_state
        
        idx = max(0, min(env.current_step - 1, len(env.df) - 1))
        timestamp = env.df.index[idx]
        equity_series.append({
            'time': timestamp.isoformat() if hasattr(timestamp, 'isoformat') else str(timestamp),
            'date': timestamp.date().isoformat() if hasattr(timestamp, 'date') else str(timestamp),
            'equity': float(env.balance),
            'pnl': float(env.total_pnl),
            'action': int(action),
            'position': int(env.position),
        })
    
    # Calculate metrics
    win_rate = (env.winning_trades / env.total_trades * 100) if env.total_trades > 0 else 0.0
    avg_win = np.mean([t['pnl'] for t in env.trade_history if t['pnl'] > 0]) if env.winning_trades > 0 else 0.0
    avg_loss = np.mean([t['pnl'] for t in env.trade_history if t['pnl'] < 0]) if env.losing_trades > 0 else 0.0
    logging.info(
        "[RL][%s] Evaluation complete | PnL=%.2f | trades=%d | win_rate=%.2f%%",
        symbol,
        env.total_pnl,
        env.total_trades,
        win_rate,
    )
    split_index = int(0.7 * len(equity_series)) if equity_series else 0
    for i, entry in enumerate(equity_series):
        entry['subset'] = 'train' if i < split_index else 'test'
    
    drawdown_series: List[Dict[str, Any]] = []
    peak_equity = initial_balance
    max_drawdown_abs = 0.0
    for entry in equity_series:
        equity = entry['equity']
        if equity > peak_equity:
            peak_equity = equity
        drawdown_value = equity - peak_equity
        if abs(drawdown_value) > max_drawdown_abs:
            max_drawdown_abs = abs(drawdown_value)
        drawdown_series.append({
            'time': entry['time'],
            'date': entry['date'],
            'drawdown': float(drawdown_value),
            'drawdown_pct': float(drawdown_value / peak_equity * 100) if peak_equity != 0 else 0.0,
            'subset': entry['subset'],
        })
    
    # Trade scatter points
    trade_points: List[Dict[str, Any]] = []
    test_cutoff_time = equity_series[split_index]['time'] if equity_series and split_index < len(equity_series) else None
    for trade in env.trade_history:
        entry_step = trade.get('entry_step', 0)
        exit_step = trade.get('exit_step', entry_step)
        entry_idx = max(0, min(entry_step, len(env.df) - 1))
        exit_idx = max(0, min(exit_step, len(env.df) - 1))
        entry_time = env.df.index[entry_idx]
        exit_time = env.df.index[exit_idx]
        subset = 'train'
        if test_cutoff_time is not None and exit_time.isoformat() >= test_cutoff_time:
            subset = 'test'
        trade_points.append({
            'entry_time': entry_time.isoformat() if hasattr(entry_time, 'isoformat') else str(entry_time),
            'exit_time': exit_time.isoformat() if hasattr(exit_time, 'isoformat') else str(exit_time),
            'pnl': float(trade.get('pnl', 0.0)),
            'position': trade.get('position', 'PE'),
            'duration_steps': int(exit_step - entry_step),
            'subset': subset,
        })
    
    return {
        'total_pnl': env.total_pnl,
        'total_trades': env.total_trades,
        'winning_trades': env.winning_trades,
        'losing_trades': env.losing_trades,
        'win_rate': win_rate,
        'avg_win': avg_win,
        'avg_loss': avg_loss,
        'final_balance': env.balance,
        'trade_history': env.trade_history[-50:],  # Last 50 trades
        'actions_taken': len(actions_taken),
        'series': equity_series,
        'split_index': split_index,
        'initial_balance': initial_balance,
        'drawdown_series': drawdown_series,
        'trade_points': trade_points,
        'max_drawdown_abs': max_drawdown_abs,
    }

