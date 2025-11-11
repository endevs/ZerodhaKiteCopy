
import sqlite3
import datetime
import random

def populate_sample_data():
    conn = sqlite3.connect('database.db')
    conn.execute('DELETE FROM five_minute_candles')

    # Sample data for 31st Oct 2025
    instrument_token = 256265 # NIFTY 50
    start_time = datetime.datetime(2025, 10, 31, 9, 15, 0)
    end_time = datetime.datetime(2025, 10, 31, 15, 30, 0)
    current_time = start_time

    open_price = 20000
    ema = open_price

    while current_time < end_time:
        high_price = open_price + random.uniform(0, 20)
        low_price = open_price - random.uniform(0, 20)
        close_price = random.uniform(low_price, high_price)
        volume = random.randint(1000, 5000)

        # Calculate EMA (simple moving average for simplicity)
        ema = (close_price * (2 / (5 + 1))) + (ema * (1 - (2 / (5 + 1))))

        conn.execute(
            'INSERT INTO five_minute_candles (instrument_token, timestamp, open, high, low, close, volume, ema) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            (instrument_token, current_time, open_price, high_price, low_price, close_price, volume, ema)
        )

        open_price = close_price
        current_time += datetime.timedelta(minutes=5)

    conn.commit()
    conn.close()

if __name__ == '__main__':
    populate_sample_data()
    print("Sample data populated successfully!")
