
from flask import Blueprint, render_template, request, jsonify
from database import get_db_connection
import datetime
import pandas as pd

chat_bp = Blueprint('chat', __name__)

@chat_bp.route('/chat')
def chat():
    from flask import session, redirect
    # Check if user is authenticated
    if 'user_id' not in session:
        return redirect('/login')
    return render_template('chat.html')

@chat_bp.route('/api/chart_data')
def chart_data():
    from flask import session
    # Check authentication
    if 'user_id' not in session:
        return jsonify({'error': 'User not authenticated'}), 401
    
    date_str = request.args.get('date')
    if not date_str:
        return jsonify({'candles': [], 'ema': []})

    try:
        selected_date = datetime.datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({'candles': [], 'ema': []})

    conn = get_db_connection()
    # Fetch simulated market data for the selected date
    query = "SELECT timestamp, last_price FROM simulated_market_data WHERE DATE(timestamp) = ? ORDER BY timestamp"
    df = pd.read_sql_query(query, conn, params=(selected_date,))
    conn.close()

    if df.empty:
        return jsonify({'candles': [], 'ema': []})

    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df.set_index('timestamp', inplace=True)

    # Resample to 5-minute candles
    ohlc = df['last_price'].resample('5min').ohlc()
    ohlc = ohlc.dropna()

    # Calculate 5-period EMA
    ema = ohlc['close'].ewm(span=5, adjust=False).mean()

    candles = [
        {'x': index.isoformat(), 'o': row['open'], 'h': row['high'], 'l': row['low'], 'c': row['close']}
        for index, row in ohlc.iterrows()
    ]
    ema_data = [
        {'x': index.isoformat(), 'y': value}
        for index, value in ema.items()
    ]

    return jsonify({'candles': candles, 'ema': ema_data})
