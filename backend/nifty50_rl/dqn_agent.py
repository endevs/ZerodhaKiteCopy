"""
Deep Q-Network (DQN) Agent with Dual Policies
- Stochastic Policy (Epsilon-Greedy) for training
- Deterministic Policy (Argmax) for testing
"""
import sys
import os
import importlib.util
# CRITICAL: Import config from the same directory as this file
_current_dir = os.path.dirname(os.path.abspath(__file__))
_config_path = os.path.join(_current_dir, 'config.py')
spec = importlib.util.spec_from_file_location("nifty50_rl_config", _config_path)
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)

import logging
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from collections import deque
import random
from typing import Tuple, List, Optional

logger = logging.getLogger(__name__)

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
if torch.cuda.is_available():
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True

logger.info(f"[DQN] Using device: {DEVICE}")


class DQNNetwork(nn.Module):
    """Deep Q-Network architecture."""
    
    def __init__(self, state_dim: int, action_dim: int):
        super(DQNNetwork, self).__init__()
        
        self.net = nn.Sequential(
            nn.Linear(state_dim, 128),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(128, 128),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, action_dim)
        )
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class DQNAgent:
    """
    DQN Agent with experience replay and dual policies.
    """
    
    def __init__(
        self,
        state_dim: int = config.STATE_DIM,
        action_dim: int = config.ACTION_DIM,
        learning_rate: float = config.LEARNING_RATE,
        gamma: float = config.GAMMA,
        epsilon: float = config.EPSILON_START,
        epsilon_decay: float = config.EPSILON_DECAY,
        epsilon_min: float = config.EPSILON_END,
        batch_size: int = config.BATCH_SIZE,
        replay_buffer_size: int = config.REPLAY_BUFFER_SIZE
    ):
        self.state_dim = state_dim
        self.action_dim = action_dim
        self.learning_rate = learning_rate
        self.gamma = gamma
        self.epsilon = epsilon
        self.epsilon_decay = epsilon_decay
        self.epsilon_min = epsilon_min
        self.batch_size = batch_size
        
        # Neural networks
        self.q_network = DQNNetwork(state_dim, action_dim).to(DEVICE)
        self.target_network = DQNNetwork(state_dim, action_dim).to(DEVICE)
        self.target_network.load_state_dict(self.q_network.state_dict())
        self.target_network.eval()
        
        # Optimizer
        self.optimizer = optim.Adam(self.q_network.parameters(), lr=learning_rate)
        
        # Experience replay buffer
        self.replay_buffer = deque(maxlen=replay_buffer_size)
        
        # Training stats
        self.training_step = 0
        
        logger.info(f"[DQN] Agent initialized: state_dim={state_dim}, action_dim={action_dim}")
    
    def select_action(self, state: np.ndarray, policy: str = 'stochastic', return_q_values: bool = False):
        """
        Select action based on policy.
        
        Args:
            state: Current state vector
            policy: 'stochastic' (epsilon-greedy) or 'deterministic' (argmax)
            return_q_values: If True, return Q-values along with action
        
        Returns:
            Selected action (0-3) or tuple (action, q_values_dict) if return_q_values=True
        """
        if policy == 'stochastic':
            # Epsilon-greedy exploration
            if random.random() < self.epsilon:
                action = random.randint(0, self.action_dim - 1)
                if return_q_values:
                    return action, {'HOLD': 0.0, 'BUY': 0.0, 'SELL': 0.0, 'CLOSE': 0.0, 'exploration': True}
                return action
        
        # Greedy action (argmax Q-values)
        with torch.no_grad():
            state_tensor = torch.FloatTensor(state).unsqueeze(0).to(DEVICE)
            q_values = self.q_network(state_tensor)
            action = q_values.argmax().item()
            
            if return_q_values:
                q_values_dict = {
                    'HOLD': float(q_values[0][0].item()),
                    'BUY': float(q_values[0][1].item()),
                    'SELL': float(q_values[0][2].item()),
                    'CLOSE': float(q_values[0][3].item()),
                    'exploration': False
                }
                return action, q_values_dict
        
        return action
    
    def store_transition(self, state: np.ndarray, action: int, reward: float, 
                        next_state: np.ndarray, done: bool):
        """Store transition in replay buffer."""
        self.replay_buffer.append((state, action, reward, next_state, done))
    
    def train_step(self) -> Optional[float]:
        """
        Train Q-network on a batch from replay buffer.
        
        Returns:
            Loss value if training occurred, None otherwise
        """
        if len(self.replay_buffer) < self.batch_size:
            return None
        
        # Sample batch
        batch = random.sample(self.replay_buffer, self.batch_size)
        states, actions, rewards, next_states, dones = zip(*batch)
        
        # Convert to tensors
        states = torch.FloatTensor(np.array(states)).to(DEVICE)
        actions = torch.LongTensor(actions).to(DEVICE)
        rewards = torch.FloatTensor(rewards).to(DEVICE)
        next_states = torch.FloatTensor(np.array(next_states)).to(DEVICE)
        dones = torch.BoolTensor(dones).to(DEVICE)
        
        # Current Q-values
        current_q_values = self.q_network(states).gather(1, actions.unsqueeze(1))
        
        # Next Q-values from target network
        with torch.no_grad():
            next_q_values = self.target_network(next_states).max(1)[0]
            target_q_values = rewards + (self.gamma * next_q_values * ~dones)
        
        # Compute loss
        loss = nn.MSELoss()(current_q_values.squeeze(), target_q_values)
        
        # Optimize
        self.optimizer.zero_grad()
        loss.backward()
        # Gradient clipping
        torch.nn.utils.clip_grad_norm_(self.q_network.parameters(), 1.0)
        self.optimizer.step()
        
        self.training_step += 1
        
        # Update target network periodically
        if self.training_step % config.TARGET_UPDATE_FREQ == 0:
            self.update_target_network()
        
        return loss.item()
    
    def update_target_network(self):
        """Copy weights from Q-network to target network."""
        self.target_network.load_state_dict(self.q_network.state_dict())
        logger.debug(f"Target network updated at step {self.training_step}")
    
    def decay_epsilon(self):
        """Decay epsilon for exploration."""
        if self.epsilon > self.epsilon_min:
            self.epsilon = max(self.epsilon_min, self.epsilon * self.epsilon_decay)
    
    def save_model(self, path: str):
        """Save model to file."""
        torch.save({
            'q_network_state_dict': self.q_network.state_dict(),
            'target_network_state_dict': self.target_network.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict(),
            'epsilon': self.epsilon,
            'training_step': self.training_step,
            'state_dim': self.state_dim,
            'action_dim': self.action_dim
        }, path)
        logger.info(f"Model saved to {path}")
    
    def load_model(self, path: str):
        """Load model from file."""
        checkpoint = torch.load(path, map_location=DEVICE)
        
        self.q_network.load_state_dict(checkpoint['q_network_state_dict'])
        self.target_network.load_state_dict(checkpoint['target_network_state_dict'])
        self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
        self.epsilon = checkpoint.get('epsilon', self.epsilon_min)
        self.training_step = checkpoint.get('training_step', 0)
        
        # Set target network to eval mode
        self.target_network.eval()
        
        logger.info(f"Model loaded from {path}")
        logger.info(f"  Epsilon: {self.epsilon:.4f}, Training steps: {self.training_step}")

