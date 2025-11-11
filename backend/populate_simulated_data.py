
import sqlite3
import datetime
import random

def populate_simulated_data():
    conn = sqlite3.connect('database.db')
    conn.execute('DELETE FROM simulated_market_data')

    # Sample data for 31st Oct 2025
    instrument_token = 256265 # NIFTY 50
    start_time = datetime.datetime(2025, 10, 31, 9, 15, 0)
    end_time = datetime.datetime(2025, 10, 31, 15, 30, 0)
    current_time = start_time

    last_price = 20000

    while current_time < end_time:
        last_price += random.uniform(-10, 10)
        conn.execute(
            'INSERT INTO simulated_market_data (instrument_token, timestamp, last_price) VALUES (?, ?, ?)',
            (instrument_token, current_time, last_price)
        )
        current_time += datetime.timedelta(minutes=1)

    conn.commit()
    conn.close()

if __name__ == '__main__':
    populate_simulated_data()
    print("Simulated data populated successfully!")
