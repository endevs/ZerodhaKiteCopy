
from .base_strategy import BaseStrategy
import logging
import datetime

class ORB(BaseStrategy):
    description = """
    ## Opening Range Breakout (ORB)

    This strategy identifies the high and low of the opening range and places a trade when the price breaks out of this range.

    **Timeframe:** Configurable (e.g., 15 minutes)
    **Instruments:** Nifty & BankNifty

    ### Logic
    - **Opening Range:** The high and low of the first 'x' minutes of the trading session.
    - **Buy Signal:** Price breaks above the opening range high.
    - **Sell Signal:** Price breaks below the opening range low.
    - **Stop Loss & Target:** Configurable percentages.
    """
    def __init__(self, kite, instrument, candle_time, start_time, end_time, stop_loss, target_profit, total_lot, trailing_stop_loss, segment, trade_type, strike_price, expiry_type, strategy_name_input, paper_trade=False):
        super().__init__(kite, instrument, candle_time, start_time, end_time, stop_loss, target_profit, total_lot, trailing_stop_loss, segment, trade_type, strike_price, expiry_type, strategy_name_input)
        self.strategy_name_input = strategy_name_input
        self.segment = segment
        self.total_lot = int(total_lot)
        self.trade_type = trade_type
        self.strike_price = strike_price
        self.expiry_type = expiry_type
        self.instrument_token = self._get_instrument_token()
        self.opening_range_high = 0
        self.opening_range_low = 0
        self.trade_placed = False
        self.trailing_stop_loss_price = 0
        self.paper_trade = paper_trade
        self.position = 0  # 0: flat, 1: long, -1: short
        self.entry_price = 0
        self.exit_price = 0
        self.trade_history = []
        self.status = {
            'state': 'initializing',
            'message': 'Strategy is initializing.',
            'opening_range_high': 0,
            'opening_range_low': 0,
            'current_price': 0,
            'pnl': 0,
            'paper_trade_mode': self.paper_trade,
            'position': self.position,
            'entry_price': self.entry_price,
            'exit_price': self.exit_price,
            'stop_loss_level': 0,
            'target_profit_level': 0,
            'traded_instrument': '',
            'trade_history': self.trade_history,
            'candle_time_frame': self.candle_time
        }

    def _get_instrument_token(self):
        # In a real application, you would have a more robust way to get the instrument token.
        # This is just a simple example.
        if self.instrument == 'NIFTY':
            return 256265  # NIFTY 50
        elif self.instrument == 'BANKNIFTY':
            return 260105  # NIFTY BANK
        return None

    def _get_atm_option_symbol(self, ltp, option_type):
        instruments = self.kite.instruments('NFO')
        
        # Filter instruments by expiry type
        today = datetime.date.today()
        if self.expiry_type == 'Weekly':
            # Find the next Thursday (weekly expiry)
            days_until_thursday = (3 - today.weekday() + 7) % 7
            if days_until_thursday == 0: # If today is Thursday, use next Thursday
                days_until_thursday = 7
            expiry_date = today + datetime.timedelta(days=days_until_thursday)
        elif self.expiry_type == 'Next Weekly':
            # Find the Thursday after next Thursday
            days_until_thursday = (3 - today.weekday() + 7) % 7
            if days_until_thursday == 0: # If today is Thursday, use next Thursday
                days_until_thursday = 7
            expiry_date = today + datetime.timedelta(days=days_until_thursday + 7)
        elif self.expiry_type == 'Monthly':
            # Find the last Thursday of the current month
            year = today.year
            month = today.month
            # Get the last day of the month
            last_day_of_month = datetime.date(year, month, 1) + datetime.timedelta(days=32) - datetime.timedelta(days=1)
            # Find the last Thursday
            while last_day_of_month.weekday() != 3: # 3 is Thursday
                last_day_of_month -= datetime.timedelta(days=1)
            expiry_date = last_day_of_month
        else:
            expiry_date = today # Default to today if expiry_type is not recognized

        # Format expiry date to match KiteConnect instrument format (YYYY-MM-DD)
        expiry_date_str = expiry_date.strftime('%Y-%m-%d')

        filtered_instruments = [inst for inst in instruments if 
                                inst['name'] == self.instrument and 
                                inst['instrument_type'] == option_type and
                                inst['expiry'].strftime('%Y-%m-%d') == expiry_date_str]

        # Find the nearest strike price
        strike_prices = [inst['strike'] for inst in filtered_instruments]
        if not strike_prices:
            logging.warning(f"No strike prices found for {self.instrument} {option_type} with expiry {expiry_date_str}")
            return None

        atm_strike = min(strike_prices, key=lambda x:abs(x-ltp))

        # Find the corresponding trading symbol
        for inst in filtered_instruments:
            if inst['strike'] == atm_strike:
                return inst['tradingsymbol']
        return None

    def _place_order(self, ltp, option_type):
        instrument_token_to_trade = self._get_atm_option_symbol(ltp, option_type)
        if not instrument_token_to_trade:
            logging.error(f"Could not find ATM option for {self.instrument} {option_type}")
            return

        # Get trading symbol for logging
        trading_symbol = ""
        try:
            instruments = self.kite.instruments('NFO')
            instrument_details = next((item for item in instruments if item["instrument_token"] == instrument_token_to_trade), None)
            trading_symbol = instrument_details['tradingsymbol'] if instrument_details else f"Unknown ({instrument_token_to_trade})"
        except Exception as e:
            logging.error(f"Error fetching instrument details for {instrument_token_to_trade}: {e}")
            trading_symbol = f"Unknown ({instrument_token_to_trade})"

        transaction_type = self.kite.TRANSACTION_TYPE_BUY if self.trade_type == 'Buy' else self.kite.TRANSACTION_TYPE_SELL
        quantity = self.total_lot * 50 # Assuming 1 lot = 50 shares for NIFTY/BANKNIFTY

        if self.paper_trade:
            logging.info(f"[PAPER TRADE] Simulating order for {trading_symbol} with quantity {quantity} ({self.total_lot} lots)")
            self.status['traded_instrument'] = trading_symbol
        else:
            logging.info(f"Placing LIVE order for {trading_symbol} with quantity {quantity} ({self.total_lot} lots)")
            # self.kite.place_order(
            #     variety=self.kite.VARIETY_REGULAR,
            #     exchange=self.kite.EXCHANGE_NFO,
            #     tradingsymbol=trading_symbol,
            #     transaction_type=transaction_type,
            #     quantity=quantity,
            #     product=self.kite.PRODUCT_MIS,
            #     order_type=self.kite.ORDER_TYPE_MARKET
            # )

    def run(self):
        logging.info(f"Running ORB strategy for {self.instrument}")
        self.status['state'] = 'running'
        self.status['message'] = 'Strategy is running and waiting for ticks.'

    def process_ticks(self, ticks):
        # Initialize status if not already set
        if self.status['state'] == 'initializing':
            self.status['state'] = 'waiting_for_opening_range'
            self.status['message'] = f"Waiting for the first {self.candle_time} minutes to form the opening range."
            self.status['paper_trade_mode'] = self.paper_trade
            self.status['candle_time_frame'] = self.candle_time

        start_time_obj = datetime.datetime.strptime(self.start_time, '%H:%M').time()
        end_time_obj = datetime.datetime.strptime(self.end_time, '%H:%M').time()
        opening_range_end_time_obj = (datetime.datetime.combine(datetime.date.today(), start_time_obj) + datetime.timedelta(minutes=int(self.candle_time))).time()

        for tick in ticks:
            # Ensure we only process ticks for the strategy's instrument
            if tick['instrument_token'] != self.instrument_token:
                continue

            # Extract timestamp safely
            timestamp_val = None
            if 'timestamp' in tick:
                timestamp_val = tick['timestamp']
            elif 'last_trade_time' in tick:
                timestamp_val = tick['last_trade_time']
            elif 'exchange_timestamp' in tick:
                timestamp_val = tick['exchange_timestamp']
            
            if not timestamp_val:
                logging.warning(f"Skipping tick in process_ticks due to missing timestamp: {tick}")
                continue

            if isinstance(timestamp_val, datetime.datetime):
                tick_datetime = timestamp_val
            else:
                tick_datetime = datetime.datetime.fromtimestamp(timestamp_val)
            
            tick_time = tick_datetime.time()
            current_price = tick['last_price']
            self.status['current_price'] = current_price

            # Only process within trading hours
            if not (start_time_obj <= tick_time <= end_time_obj):
                self.status['message'] = f"Outside trading hours ({self.start_time}-{self.end_time}). Current time: {tick_time}"
                continue

            # --- Opening Range Calculation ---
            if tick_time < opening_range_end_time_obj:
                if self.status['opening_range_high'] == 0 or current_price > self.status['opening_range_high']:
                    self.status['opening_range_high'] = current_price
                if self.status['opening_range_low'] == 0 or current_price < self.status['opening_range_low']:
                    self.status['opening_range_low'] = current_price
                self.status['state'] = 'waiting_for_opening_range'
                self.status['message'] = f"Calculating opening range ({self.candle_time} min). High: {self.status['opening_range_high']:.2f}, Low: {self.status['opening_range_low']:.2f}"
                continue # Continue to next tick if still in opening range

            # --- Trade Execution Logic ---
            if not self.trade_placed:
                self.status['state'] = 'monitoring_for_breakout'
                self.status['message'] = f"Monitoring for breakout. OR High: {self.status['opening_range_high']:.2f}, OR Low: {self.status['opening_range_low']:.2f}. Current: {current_price:.2f}"

                if current_price > self.status['opening_range_high']:
                    self.position = 1  # Long position
                    self.entry_price = current_price
                    self.trade_placed = True
                    self.status['state'] = 'position_open'
                    self.status['message'] = f"Long trade initiated at {self.entry_price:.2f} (Breakout above OR High)"
                    self.status['position'] = self.position
                    self.status['entry_price'] = self.entry_price
                    self.status['stop_loss_level'] = self.entry_price * (1 - self.stop_loss / 100)
                    self.status['target_profit_level'] = self.entry_price * (1 + self.target_profit / 100)
                    self.status['traded_instrument'] = self._get_atm_option_symbol(current_price, 'CE') # Assuming CE for long
                    self.trade_history.append({
                        'time': tick_datetime.strftime('%H:%M:%S'),
                        'action': 'BUY',
                        'price': self.entry_price,
                        'instrument': self.status['traded_instrument'],
                        'order_id': str(uuid.uuid4())[:8] # Dummy order ID
                    })
                    logging.info(self.status['message'])
                    # self._place_order(current_price, 'CE') # Actual order placement
                elif current_price < self.status['opening_range_low']:
                    self.position = -1  # Short position
                    self.entry_price = current_price
                    self.trade_placed = True
                    self.status['state'] = 'position_open'
                    self.status['message'] = f"Short trade initiated at {self.entry_price:.2f} (Breakout below OR Low)"
                    self.status['position'] = self.position
                    self.status['entry_price'] = self.entry_price
                    self.status['stop_loss_level'] = self.entry_price * (1 + self.stop_loss / 100)
                    self.status['target_profit_level'] = self.entry_price * (1 - self.target_profit / 100)
                    self.status['traded_instrument'] = self._get_atm_option_symbol(current_price, 'PE') # Assuming PE for short
                    self.trade_history.append({
                        'time': tick_datetime.strftime('%H:%M:%S'),
                        'action': 'SELL',
                        'price': self.entry_price,
                        'instrument': self.status['traded_instrument'],
                        'order_id': str(uuid.uuid4())[:8] # Dummy order ID
                    })
                    logging.info(self.status['message'])
                    # self._place_order(current_price, 'PE') # Actual order placement
            
            # --- Position Management (SL/Target) ---
            elif self.position != 0: # If a position is open
                current_pnl = (current_price - self.entry_price) * self.total_lot * 50 * self.position
                self.status['pnl'] = current_pnl
                self.status['message'] = f"Position open. Entry: {self.entry_price:.2f}, Current: {current_price:.2f}, P&L: {current_pnl:.2f}"

                # Check for Stop Loss
                if (self.position == 1 and current_price <= self.status['stop_loss_level']) or \
                   (self.position == -1 and current_price >= self.status['stop_loss_level']):
                    self.exit_price = current_price
                    self.status['state'] = 'position_closed'
                    self.status['message'] = f"Position closed by Stop Loss at {self.exit_price:.2f}. P&L: {current_pnl:.2f}"
                    self.trade_history.append({
                        'time': tick_datetime.strftime('%H:%M:%S'),
                        'action': 'SELL_SL' if self.position == 1 else 'BUY_SL',
                        'price': self.exit_price,
                        'instrument': self.status['traded_instrument'],
                        'order_id': str(uuid.uuid4())[:8] # Dummy order ID
                    })
                    self.position = 0
                    self.trade_placed = False
                    logging.info(self.status['message'])
                # Check for Target Profit
                elif (self.position == 1 and current_price >= self.status['target_profit_level']) or \
                     (self.position == -1 and current_price <= self.status['target_profit_level']):
                    self.exit_price = current_price
                    self.status['state'] = 'position_closed'
                    self.status['message'] = f"Position closed by Target Profit at {self.exit_price:.2f}. P&L: {current_pnl:.2f}"
                    self.trade_history.append({
                        'time': tick_datetime.strftime('%H:%M:%S'),
                        'action': 'SELL_TP' if self.position == 1 else 'BUY_TP',
                        'price': self.exit_price,
                        'instrument': self.status['traded_instrument'],
                        'order_id': str(uuid.uuid4())[:8] # Dummy order ID
                    })
                    self.position = 0
                    self.trade_placed = False
                    logging.info(self.status['message'])

    def backtest(self, from_date, to_date):
        logging.info(f"Running backtest for {self.instrument} from {from_date} to {to_date}")

        if not self.instrument_token:
            logging.error(f"Could not find instrument token for {self.instrument}")
            return 0, 0

        historical_data = self.kite.historical_data(self.instrument_token, from_date, to_date, f"{self.candle_time}minute")

        if not historical_data:
            logging.error("Could not fetch historical data for backtest.")
            return 0, 0

        pnl = 0
        trades = 0
        trade_placed = False
        entry_price = 0

        for candle in historical_data:
            if not trade_placed:
                if candle['high'] > self.opening_range_high:
                    trades += 1
                    entry_price = self.opening_range_high
                    trade_placed = True
                elif candle['low'] < self.opening_range_low:
                    trades += 1
                    entry_price = self.opening_range_low
                    trade_placed = True
            else:
                if candle['high'] > entry_price + (entry_price * (float(self.target_profit) / 100)):
                    pnl += (entry_price * (float(self.target_profit) / 100)) * float(self.total_lot * 50) # Use total_lot
                    trade_placed = False
                elif candle['low'] < entry_price - (entry_price * (float(self.stop_loss) / 100)):
                    pnl -= (entry_price * (float(self.stop_loss) / 100)) * float(self.total_lot * 50) # Use total_lot
                    trade_placed = False

        return pnl, trades

    def replay(self, ticks):
        logging.info(f"Running replay for {self.instrument}")

        pnl = 0
        trades = 0
        trade_placed = False
        entry_price = 0
        opening_range_high = 0
        opening_range_low = 0
        start_time = datetime.datetime.strptime(self.start_time, '%H:%M').time()

        # First, find the opening range from the ticks
        for tick in ticks:
            tick_time = datetime.datetime.strptime(tick['timestamp'], '%Y-%m-%d %H:%M:%S').time()
            if tick_time >= start_time:
                if opening_range_high == 0:
                    opening_range_high = tick['last_price']
                    opening_range_low = tick['last_price']
                else:
                    opening_range_high = max(opening_range_high, tick['last_price'])
                    opening_range_low = min(opening_range_low, tick['last_price'])

            # Assuming the opening range is for the first 15 minutes
            if tick_time >= (datetime.datetime.combine(datetime.date.today(), start_time) + datetime.timedelta(minutes=15)).time():
                break

        # Now, process the rest of the ticks for trading
        for tick in ticks:
            tick_time = datetime.datetime.strptime(tick['timestamp'], '%Y-%m-%d %H:%M:%S').time()
            if tick_time < (datetime.datetime.combine(datetime.date.today(), start_time) + datetime.timedelta(minutes=15)).time():
                continue

            if not trade_placed:
                if tick['last_price'] > opening_range_high:
                    trades += 1
                    entry_price = opening_range_high
                    trade_placed = True
                    # This is a buy, so we are long
                    position = 1
                elif tick['last_price'] < opening_range_low:
                    trades += 1
                    entry_price = opening_range_low
                    trade_placed = True
                    # This is a sell, so we are short
                    position = -1
            else:
                if position == 1: # Long position
                    if tick['last_price'] > entry_price + (entry_price * (self.target_profit / 100)):
                        pnl += (entry_price * (self.target_profit / 100)) * self.total_lot * 50
                        trade_placed = False
                    elif tick['last_price'] < entry_price - (entry_price * (self.stop_loss / 100)):
                        pnl -= (entry_price * (self.stop_loss / 100)) * self.total_lot * 50
                        trade_placed = False
                elif position == -1: # Short position
                    if tick['last_price'] < entry_price - (entry_price * (self.target_profit / 100)):
                        pnl += (entry_price * (self.target_profit / 100)) * self.total_lot * 50
                        trade_placed = False
                    elif tick['last_price'] > entry_price + (entry_price * (self.stop_loss / 100)):
                        pnl -= (entry_price * (self.stop_loss / 100)) * self.total_lot * 50
                        trade_placed = False

        return pnl, trades
