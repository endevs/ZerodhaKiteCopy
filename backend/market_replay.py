
import sqlite3
from datetime import datetime, timedelta
import time
from strategies.orb import ORB
from strategies.capture_mountain_signal import CaptureMountainSignal

def get_db_connection():
    conn = sqlite3.connect('database.db')
    conn.row_factory = sqlite3.Row
    return conn

def fetch_simulated_market_data(replay_date_str):
    conn = get_db_connection()
    cursor = conn.cursor()
    # Assuming replay_date_str is 'YYYY-MM-DD'
    start_datetime = f"{replay_date_str} 09:15:00"
    end_datetime = f"{replay_date_str} 15:30:00"

    cursor.execute(
        "SELECT * FROM simulated_market_data WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp ASC",
        (start_datetime, end_datetime)
    )
    data = cursor.fetchall()
    conn.close()
    return data

def fetch_five_minute_candles(replay_date_str):
    conn = get_db_connection()
    cursor = conn.cursor()
    start_datetime = f"{replay_date_str} 09:15:00"
    end_datetime = f"{replay_date_str} 15:30:00"

    cursor.execute(
        "SELECT * FROM five_minute_candles WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp ASC",
        (start_datetime, end_datetime)
    )
    data = cursor.fetchall()
    conn.close()
    return data

def run_market_replay(strategy_id, replay_date_str):
    trade_logs = []

    conn = get_db_connection()
    strategy_data = conn.execute('SELECT * FROM strategies WHERE id = ?', (strategy_id,)).fetchone()
    conn.close()

    if not strategy_data:
        raise ValueError(f"Strategy with ID {strategy_id} not found.")

    strategy_type = strategy_data['strategy_type']
    strategy_class = None
    if strategy_type == 'orb':
        strategy_class = ORB
    elif strategy_type == 'capture_mountain_signal':
        strategy_class = CaptureMountainSignal
    else:
        raise ValueError(f"Unknown strategy type: {strategy_type}")

    # Instantiate the strategy with saved parameters
    # Note: kite object is None for market replay
    strategy = strategy_class(
        None,
        strategy_data['instrument'],
        strategy_data['candle_time'],
        strategy_data['start_time'],
        strategy_data['end_time'],
        strategy_data['stop_loss'],
        strategy_data['target_profit'],
        strategy_data['total_lot'],
        strategy_data['trailing_stop_loss'],
        strategy_data['segment'],
        strategy_data['trade_type'],
        strategy_data['strike_price'],
        strategy_data['expiry_type'],
        strategy_data['strategy_name'],
        paper_trade=True # Always paper trade in replay mode
    )

    simulated_data = fetch_simulated_market_data(replay_date_str)
    five_min_candles = fetch_five_minute_candles(replay_date_str)

    # Combine and sort all data by timestamp
    combined_data = []
    for tick in simulated_data:
        combined_data.append({'type': 'tick', 'data': tick})
    for candle in five_min_candles:
        combined_data.append({'type': 'candle', 'data': candle})
    
    # Sort by timestamp. Ensure timestamp is a datetime object for proper sorting.
    for item in combined_data:
        if isinstance(item['data']['timestamp'], str):
            try:
                item['data']['timestamp'] = datetime.datetime.strptime(item['data']['timestamp'], '%Y-%m-%d %H:%M:%S')
            except ValueError:
                item['data']['timestamp'] = datetime.datetime.fromisoformat(item['data']['timestamp'])

    combined_data.sort(key=lambda x: x['data']['timestamp'])

    # Initialize variables for candle aggregation
    current_5min_candle = None
    last_processed_time = None

    for item in combined_data:
        current_time = item['data']['timestamp']

        # Simulate 20-second delay for every 5-minute interval
        if last_processed_time and (current_time - last_processed_time).total_seconds() >= 300: # 5 minutes
            # This is where the 20-second simulated delay would conceptually happen
            # For a non-blocking simulation, we just advance time.
            pass

        if item['type'] == 'tick':
            # Process tick data
            # For market replay, we directly feed ticks to the strategy's on_tick method
            # The strategy itself will handle candle formation if needed (e.g., CaptureMountainSignal)
            strategy.on_tick(item['data'])

        elif item['type'] == 'candle':
            # Process pre-formed 5-minute candles
            strategy.on_new_candle(item['data'])
        
        last_processed_time = current_time

    # Call the strategy's replay method
    trade_logs, final_pnl, total_trades = strategy.replay(simulated_data, five_min_candles)

    return trade_logs, final_pnl, total_trades

if __name__ == '__main__':
    # Example usage
    # Ensure you have data for '2025-10-31' in your database for testing
    replay_date = '2025-10-31'
    strategy_id_example = 1 # Assuming a strategy ID
    logs = run_market_replay(strategy_id_example, replay_date)
    for log in logs:
        print(log)
