"""
Main entry point for Bank Nifty RL Trading System
Run this file in PyCharm to execute the complete workflow
"""
import os
import sys
import logging
import datetime
import argparse
import pandas as pd
from logging.handlers import RotatingFileHandler

# CRITICAL: Setup logging FIRST before importing any other modules
# This ensures all modules inherit the file logging configuration
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)

# Setup log directory
log_dir = os.path.join(current_dir, 'logs')
os.makedirs(log_dir, exist_ok=True)

# Configure logging with BOTH console and file handlers
log_file = os.path.join(log_dir, f'banknifty_rl_{datetime.datetime.now().strftime("%Y%m%d_%H%M%S")}.log')

# Get root logger and configure it
root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)

# Clear any existing handlers to avoid duplicates
if root_logger.handlers:
    root_logger.handlers.clear()

# Create formatters
console_formatter = logging.Formatter('[%(levelname)s] %(message)s')
file_formatter = logging.Formatter('[%(levelname)s] [%(asctime)s] [%(name)s] %(message)s', datefmt='%Y-%m-%d %H:%M:%S')

# Console handler (stdout) - KEEP THIS for console output
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(logging.INFO)
console_handler.setFormatter(console_formatter)
root_logger.addHandler(console_handler)

# File handler with rotation - ADD THIS for file logging
file_handler = RotatingFileHandler(
    log_file,
    maxBytes=10*1024*1024,  # 10MB
    backupCount=10,  # Keep 10 backup files
    encoding='utf-8'
)
file_handler.setLevel(logging.INFO)
file_handler.setFormatter(file_formatter)

# Add filter to exclude trade logs from file (but keep in console)
class TradeLogFilter(logging.Filter):
    """
    Filter to exclude trade execution logs from file handler.
    These logs should only appear in console for real-time monitoring.
    """
    TRADE_LOG_PATTERNS = [
        '[ENTRY]',
        '[EXIT]',
        '[FORCE CLOSE]',
        '[DECISION]',
        '[Q-VALUES]'
    ]
    
    def filter(self, record):
        """Return False to exclude log, True to include."""
        message = record.getMessage()
        # Exclude trade logs from file (but keep in console)
        for pattern in self.TRADE_LOG_PATTERNS:
            if pattern in message:
                return False  # Don't write to file
        return True  # Write to file

file_handler.addFilter(TradeLogFilter())
root_logger.addHandler(file_handler)

# Ensure all child loggers propagate to root
root_logger.propagate = True

# Get logger for this module
logger = logging.getLogger(__name__)
logger.info("=" * 60)
logger.info("Bank Nifty RL Trading System - Complete Workflow")
logger.info("=" * 60)
logger.info(f"Console logging: ENABLED (logs appear in console)")
logger.info(f"File logging: ENABLED (logs saved to: {log_file})")
logger.info("=" * 60)

# Add current directory and parent directory to path
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)
if parent_dir not in sys.path:
    sys.path.insert(1, parent_dir)  # Insert at index 1, not 0

# Import modules (direct imports since we added current dir to path)
from data_fetcher import get_kite_client_from_db, fetch_banknifty_data
from data_processor import process_and_split
from nifty_trading_env import NiftyTradingEnv
from dqn_agent import DQNAgent
from trainer import train_agent
from evaluator import evaluate_agent
from agno_agent import NiftyAgnoAgent, evaluate_with_agno
from pattern_analyzer import find_optimal_stop_loss_target, generate_pattern_summary
from model_manager import get_latest_model_path, save_model, load_model_metadata
from csv_exporter import export_trade_report
from pattern_knowledge import identify_patterns_in_data, get_pattern_count, generate_pattern_summary
# Import config from local nifty50_rl package
import importlib.util
_config_path = os.path.join(current_dir, 'config.py')
spec = importlib.util.spec_from_file_location("nifty50_rl_config", _config_path)
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)


def print_comprehensive_results(results: dict):
    """Print comprehensive evaluation results."""
    logger.info("\n" + "=" * 60)
    logger.info("EVALUATION RESULTS")
    logger.info("=" * 60)
    
    metrics = results.get('metrics', {})
    
    logger.info(f"\nPerformance Metrics:")
    logger.info(f"  Total Trades: {metrics.get('total_trades', 0)}")
    logger.info(f"  Win Rate: {metrics.get('win_rate', 0):.2f}%")
    logger.info(f"  Cumulative Return: {metrics.get('cumulative_return', 0):.2f}%")
    logger.info(f"  Sharpe Ratio: {metrics.get('sharpe_ratio', 0):.2f}")
    logger.info(f"  Max Drawdown: {metrics.get('max_drawdown', 0):.2f}%")
    logger.info(f"  Final Balance: ₹{metrics.get('final_balance', 0):,.0f}")
    
    # Optimal stop loss and target
    if results.get('trade_history'):
        optimal = find_optimal_stop_loss_target(results['trade_history'])
        logger.info(f"\nOptimal Parameters (based on results):")
        logger.info(f"  Stop Loss: {optimal['stop_loss']:.2f}%")
        logger.info(f"  Target: {optimal['target']:.2f}%")
    
    # Agno analysis
    if results.get('agno_analysis'):
        agno = results['agno_analysis']
        logger.info(f"\nAgno Agentic AI Analysis:")
        logger.info(agno.get('summary', 'No analysis available'))
    
    logger.info("\n" + "=" * 60)


def main():
    """Main execution function."""
    parser = argparse.ArgumentParser(description='Bank Nifty RL Trading System')
    parser.add_argument('--years', type=int, default=1, help='Years of data to fetch (default: 1)')
    parser.add_argument('--episodes', type=int, default=100, help='Training episodes (default: 100)')
    parser.add_argument('--retrain', action='store_true', help='Force retrain even if model exists')
    parser.add_argument('--user-id', type=int, default=None, help='User ID for Zerodha credentials')
    args = parser.parse_args()
    
    logger.info("=" * 60)
    logger.info("Bank Nifty RL Trading System - Complete Workflow")
    logger.info("=" * 60)
    
    try:
        # Step 1: Get Zerodha credentials from database
        logger.info("\n[1/7] Fetching Zerodha credentials from database...")
        # Default to raj.bapa@gmail.com if no user_id specified
        kite_client = get_kite_client_from_db(user_id=args.user_id, user_email='raj.bapa@gmail.com')
        logger.info("✓ KiteConnect client initialized")
        
        # Step 2: Check if trained model already exists
        logger.info("\n[2/7] Checking for existing trained model...")
        model_path = None
        agent = None
        skip_training = False
        
        if not args.retrain:
            model_path = get_latest_model_path()
            if model_path and os.path.exists(model_path):
                logger.info(f"✓ Found saved model: {model_path}")
                logger.info("Loading saved model (skipping training)...")
                agent = DQNAgent(state_dim=config.STATE_DIM, action_dim=config.ACTION_DIM)
                agent.load_model(model_path)
                metadata = load_model_metadata(model_path)
                logger.info(f"Model metadata:")
                logger.info(f"  Episodes: {metadata.get('episodes', 'Unknown')}")
                logger.info(f"  Win Rate: {metadata.get('win_rate', 'Unknown')}%")
                logger.info(f"  Sharpe Ratio: {metadata.get('sharpe_ratio', 'Unknown')}")
                skip_training = True
            else:
                logger.info("No saved model found. Will train new model.")
                skip_training = False
        else:
            logger.info("--retrain flag set. Will train new model.")
            skip_training = False
        
        # Step 3: Fetch Bank Nifty data (using futures for volume when available, index for historical)
        logger.info("\n[3/7] Fetching Bank Nifty data from Zerodha...")
        end_date = datetime.date.today()
        start_date = end_date - datetime.timedelta(days=365 * args.years)
        
        raw_data = fetch_banknifty_data(
            kite_client, 
            start_date, 
            end_date,
            use_futures=config.BANKNIFTY_USE_FUTURES
        )
        logger.info(f"✓ Fetched {len(raw_data)} candles")
        
        # Check volume availability
        if 'volume' in raw_data.columns:
            volume_available = (raw_data['volume'] > 0).sum() > 0
            if volume_available:
                avg_volume = raw_data['volume'].mean()
                logger.info(f"✓ Volume data available: Average volume = {avg_volume:,.0f}")
            else:
                logger.warning("⚠️ No volume data found - using index instead of futures")
        
        # Check volume availability
        if 'volume' in raw_data.columns:
            volume_available = (raw_data['volume'] > 0).sum() > 0
            if volume_available:
                logger.info(f"✓ Volume data available: {raw_data['volume'].sum():,.0f} total volume")
            else:
                logger.warning("⚠️ No volume data found - using index instead of futures")
        
        # Step 4: Process data (clean, normalize, split 70/30)
        logger.info("\n[4/7] Processing data (cleaning, indicators, 70/30 split)...")
        train_data, test_data = process_and_split(raw_data)
        logger.info("✓ Data processing complete")
        
        # Step 5: Train or Skip Training
        if not skip_training:
            logger.info("\n[5/7] Initializing RL environment and DQN agent...")
            env = NiftyTradingEnv(train_data)
            agent = DQNAgent(state_dim=config.STATE_DIM, action_dim=config.ACTION_DIM)
            
            logger.info("\n[5/7] Training DQN agent with Stochastic Policy (Epsilon-Greedy)...")
            training_metrics = train_agent(env, agent, episodes=args.episodes, policy='stochastic')
            
            # Save model after training
            model_path = save_model(agent, metadata={
                'episodes': args.episodes,
                'train_date_range': f"{start_date} to {end_date}",
                'win_rate': training_metrics.get('final_win_rate', 0),
                'sharpe_ratio': 0.0,  # Will be updated after evaluation
                'final_portfolio': training_metrics.get('final_portfolio', config.INITIAL_BALANCE)
            })
            logger.info(f"✓ Model saved to: {model_path}")
        else:
            logger.info("\n[5/7] Skipping training (using saved model)...")
            # Still need environment for reference
            env = NiftyTradingEnv(train_data)
        
        # Step 6: Evaluate with Agno Agentic AI (30% data, Deterministic Policy)
        logger.info("\n[6/7] Evaluating with Agno Agentic AI (Deterministic Policy)...")
        agno_agent = NiftyAgnoAgent()
        test_env = NiftyTradingEnv(test_data)
        results = evaluate_with_agno(test_env, agent, agno_agent, policy='deterministic')
        
        # Step 7: Display comprehensive results
        logger.info("\n[7/8] Generating results summary...")
        print_comprehensive_results(results)
        
        # Step 7b: Identify and display patterns
        logger.info("\n[7b/8] Identifying trading patterns...")
        try:
            pattern_counts = get_pattern_count()
            logger.info(f"Pattern Knowledge Bank: {pattern_counts['total']} total patterns")
            logger.info(f"  - Trend Patterns: {pattern_counts.get('trend_patterns', 0)}")
            logger.info(f"  - Reversal Patterns: {pattern_counts.get('reversal_patterns', 0)}")
            logger.info(f"  - Continuation Patterns: {pattern_counts.get('continuation_patterns', 0)}")
            logger.info(f"  - Candle Patterns: {pattern_counts.get('candle_patterns', 0)}")
            logger.info(f"  - Indicator Patterns: {pattern_counts.get('indicator_patterns', 0)}")
            logger.info(f"  - Volume Patterns: {pattern_counts.get('volume_patterns', 0)}")
            
            # Identify patterns in test data
            identified_patterns = identify_patterns_in_data(test_data)
            if identified_patterns:
                pattern_summary = generate_pattern_summary(identified_patterns)
                logger.info(f"\n{pattern_summary}")
            else:
                logger.info("No patterns identified in the test data.")
        except Exception as e:
            logger.warning(f"Pattern identification failed: {e}")
        
        # Step 8: Export detailed CSV report
        logger.info("\n[8/8] Exporting detailed trade report to CSV...")
        try:
            # Combine train and test data for full report
            full_processed_data = pd.concat([train_data, test_data], ignore_index=True)
            # Calculate test data start index (length of train data) for index adjustment
            test_data_start_idx = len(train_data)
            csv_path = export_trade_report(
                raw_data=raw_data,
                processed_data=full_processed_data,
                trade_history=results.get('trade_history', []),
                portfolio_history=results.get('portfolio_history', []),
                results=results,
                test_data_start_idx=test_data_start_idx
            )
            logger.info(f"✓ Detailed CSV report saved: {csv_path}")
        except Exception as e:
            logger.warning(f"Failed to export CSV report: {e}")
        
        logger.info("\n" + "=" * 60)
        logger.info("SUCCESS: Complete workflow finished!")
        logger.info("=" * 60)
        
    except Exception as e:
        logger.error(f"\nERROR: {e}", exc_info=True)
        sys.exit(1)


if __name__ == '__main__':
    main()

