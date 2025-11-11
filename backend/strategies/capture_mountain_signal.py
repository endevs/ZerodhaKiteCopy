from .base_strategy import BaseStrategy
from utils.kite_utils import get_option_symbols
from utils.indicators import calculate_rsi
from rules import load_mountain_signal_pe_rules
import logging
import datetime
import re
import pandas as pd
import numpy as np
import uuid


def round_to_multiple(value, multiple):
    try:
        return int(round(float(value) / multiple) * multiple)
    except Exception:
        return int(value)


def extract_strike_from_symbol(symbol):
    try:
        match = re.search(r'(\d{4,6})(PE|CE)$', symbol.upper())
        if match:
            return int(match.group(1))
    except Exception:
        pass
    return None

class CaptureMountainSignal(BaseStrategy):
    description = """
    ## Capture Mountain Signal Strategy

    **Instruments:** Nifty & BankNifty ATM Options
    **Timeframe:** 5-minute candles
    **Indicator:** 5-period EMA

    ### PE (Put Entry) Logic
    - **Signal Candle:** Candle's LOW > 5 EMA
    - **Entry Trigger:** Next candle CLOSE < signal candle's LOW
    - **Stop Loss:** Price closes above signal candle's HIGH
    - **Target:** Wait for at least 1 candle where HIGH < 5 EMA, then if 2 consecutive candles CLOSE > 5 EMA -> Exit PE trade

    ### CE (Call Entry) Logic
    - **Signal Candle:** Candle's HIGH < 5 EMA
    - **Entry Trigger:** Next candle CLOSE > signal candle's HIGH
    - **Stop Loss:** Price closes below signal candle's LOW
    - **Target:** Wait for at least 1 candle where LOW > 5 EMA, then if 2 consecutive candles CLOSE < 5 EMA -> Exit CE trade
    """
    def __init__(self, kite, instrument, candle_time, start_time, end_time, stop_loss, target_profit, total_lot, trailing_stop_loss, segment, trade_type, strike_price, expiry_type, strategy_name_input, paper_trade=False, ema_period=5, session_id=None):
        super().__init__(kite, instrument, candle_time, start_time, end_time, stop_loss, target_profit, total_lot, trailing_stop_loss, segment, trade_type, strike_price, expiry_type, strategy_name_input)
        self.strategy_name_input = strategy_name_input
        self.paper_trade = paper_trade
        self.ema_period = ema_period
        self.paper_trade_session_id = session_id  # Store session_id for DB logging
        self.instrument_token = self._get_instrument_token()
        self.historical_data = [] # Stores 5-minute candles
        self.pe_signal_candle = None
        self.ce_signal_candle = None
        self.trade_placed = False
        self.position = 0  # 0: flat, 1: long, -1: short
        self.entry_price = 0
        self.exit_price = 0
        self.trade_history = []
        self.status = {
            'state': 'initializing',
            'message': 'Strategy is initializing.',
            'current_ltp': 0,
            'signal_status': 'Waiting for market data',
            'signal_candle_time': 'N/A',
            'signal_candle_high': 0,
            'signal_candle_low': 0,
            'pnl': 0,
            'paper_trade_mode': self.paper_trade,
            'position': self.position, # 0: flat, 1: long, -1: short
            'entry_price': self.entry_price,
            'exit_price': self.exit_price,
            'stop_loss_level': 0,
            'target_profit_level': 0,
            'traded_instrument': '',
            'entry_order_id': 'N/A',
            'sl_order_id': 'N/A',
            'tp_order_id': 'N/A',
            'mkt_close_order_id': 'N/A',
            'trade_history': self.trade_history,
            'candle_time_frame': self.candle_time,
            # Option prices for monitoring (ATM, ATM+2, ATM-2)
            'option_prices': {
                'atm_ce': None,
                'atm_pe': None,
                'atm_plus2_ce': None,
                'atm_plus2_pe': None,
                'atm_minus2_ce': None,
                'atm_minus2_pe': None
            },
            'option_symbols': {
                'atm_ce': None,
                'atm_pe': None,
                'atm_plus2_ce': None,
                'atm_plus2_pe': None,
                'atm_minus2_ce': None,
                'atm_minus2_pe': None
            },
            'traded_instrument_token': None,
            # Audit trail
            'audit_trail': []
        }
        self.last_candle_timestamp = None
        self.current_candle_data = None
        self.target_hit_candles = 0 # For target profit logic
        self.option_instrument_tokens = {}  # Cache for option instrument tokens
        self.last_option_price_update = None  # Track when we last updated option prices
        # Track all potential signals identified today
        self.status['signal_history_today'] = []
        # Track price action validation after trade exit (for re-entry)
        self.pe_signal_price_above_low = False  # After exit, need price HIGH > signal LOW before next entry
        self.ce_signal_price_below_high = False  # After exit, need price LOW < signal HIGH before next entry
        # Track which signal candles have already had an entry (to distinguish first entry vs re-entry)
        self.signal_candles_with_entry = set()  # Store signal candle indices that have had entries
        # Track if signal evaluation has been done for current candle (to prevent duplicate evaluations)
        self.signal_evaluated_for_current_candle = False
        # Track option contract trades (realistic simulation)
        self.option_trade_history = []
        self.active_option_trade = None

        # Load business rules for PE trades from DSL
        try:
            self.pe_rules = load_mountain_signal_pe_rules()
        except Exception as rules_error:
            logging.error(f"Failed to load Mountain Signal PE rules: {rules_error}", exc_info=True)
            self.pe_rules = {
                'option_trade': {
                    'stop_loss_percent': -0.17,
                    'target_percent': 0.45
                },
                'lot_sizes': {
                    'BANKNIFTY': 35,
                    'NIFTY': 75
                },
                'strike_rounding': {
                    'BANKNIFTY': 100,
                    'NIFTY': 50
                },
                'expiry_policy': {
                    'BANKNIFTY': 'monthly',
                    'NIFTY': 'weekly'
                },
                'evaluation': {
                    'seconds_before_close': 20
                },
                'exit_priority': ['option_stop_loss', 'option_target', 'market_close 15:15']
            }

        # Apply rule-driven configuration overrides
        instrument_upper = self.instrument.upper()
        expiry_policy = self.pe_rules.get('expiry_policy', {})
        if instrument_upper in expiry_policy:
            self.expiry_type = expiry_policy[instrument_upper].lower()

        evaluation_settings = self.pe_rules.get('evaluation', {})
        self._signal_evaluate_seconds = evaluation_settings.get('seconds_before_close', 20)
        self._signal_evaluate_buffer = evaluation_settings.get('buffer_seconds', 2)

    def _aligned_execution_time(self, base_dt: datetime.datetime) -> datetime.datetime:
        """Return the aligned execution time at minute % 5 == 4 and second == 40 for the candle window.
        For a 5-minute candle starting at t0 (minute divisible by 5, second 0), execution time = t0 + 4m40s.
        If current time is before the aligned time of current candle, use previous candle's aligned time.
        """
        # Determine candle start aligned to 5-minute
        candle_minutes = (base_dt.minute // int(self.candle_time)) * int(self.candle_time)
        candle_start = base_dt.replace(minute=candle_minutes, second=0, microsecond=0)
        aligned = candle_start + datetime.timedelta(minutes=int(self.candle_time) - 1, seconds=40)
        if base_dt < aligned:
            prev_start = candle_start - datetime.timedelta(minutes=int(self.candle_time))
            aligned = prev_start + datetime.timedelta(minutes=int(self.candle_time) - 1, seconds=40)
        return aligned

    def _get_instrument_token(self):
        if self.instrument == 'NIFTY':
            return 256265
        elif self.instrument == 'BANKNIFTY':
            return 260105
        return None

    def _get_option_instruments_for_monitoring(self, ltp):
        """Get instrument tokens and symbols for ATM, ATM+2, ATM-2 options (CE and PE)"""
        # Skip option monitoring during replay (when kite is None)
        if self.kite is None:
            return {}
        
        try:
            instruments = self.kite.instruments('NFO')
            
            # Find expiry date
            all_expiries = sorted(list(set([
                inst['expiry'] for inst in instruments 
                if inst['name'] == self.instrument and 'expiry' in inst and inst['expiry']
            ])))
            
            today = datetime.date.today()
            if self.expiry_type == 'weekly':
                expiry_date = next((d for d in all_expiries if d > today), None)
            elif self.expiry_type == 'next_weekly':
                expiries_after_today = [d for d in all_expiries if d > today]
                expiry_date = expiries_after_today[1] if len(expiries_after_today) > 1 else None
            elif self.expiry_type == 'monthly':
                expiry_date = next((d for d in all_expiries if (d - today).days >= 20), None)
            else:
                expiry_date = None
            
            if not expiry_date:
                return {}
            
            expiry_date_str = expiry_date.strftime('%Y-%m-%d')
            
            # Filter instruments by expiry
            filtered_instruments = [inst for inst in instruments 
                                   if inst['name'] == self.instrument and 
                                      inst['expiry'].strftime('%Y-%m-%d') == expiry_date_str]
            
            # Determine strike step and round ATM from index LTP (calculate signals on index)
            strike_step = 50 if self.instrument == 'NIFTY' else 100
            # Round to nearest step
            atm_rounded = round(ltp / strike_step) * strike_step
            
            # Available strikes for selected expiry
            strike_prices = sorted(list(set([inst['strike'] for inst in filtered_instruments])))
            if not strike_prices:
                return {}
            # Choose nearest available to rounded ATM (prevents old far-away strikes like 46000)
            atm_strike = min(strike_prices, key=lambda x: abs(x - atm_rounded))
            atm_strike_index = strike_prices.index(atm_strike)
            
            # Get ATM, ATM+2, ATM-2 strikes
            atm_minus2_index = max(0, atm_strike_index - 2)
            atm_plus2_index = min(len(strike_prices) - 1, atm_strike_index + 2)
            
            atm_strike_val = strike_prices[atm_strike_index]
            atm_minus2_strike = strike_prices[atm_minus2_index]
            atm_plus2_strike = strike_prices[atm_plus2_index]
            
            # Find instruments for each strike and option type
            option_data = {}
            for inst in filtered_instruments:
                strike = inst['strike']
                option_type = inst['instrument_type']
                
                if strike == atm_strike_val:
                    if option_type == 'CE':
                        option_data['atm_ce'] = {'token': inst['instrument_token'], 'symbol': inst['tradingsymbol'], 'strike': strike}
                    elif option_type == 'PE':
                        option_data['atm_pe'] = {'token': inst['instrument_token'], 'symbol': inst['tradingsymbol'], 'strike': strike}
                elif strike == atm_minus2_strike:
                    if option_type == 'CE':
                        option_data['atm_minus2_ce'] = {'token': inst['instrument_token'], 'symbol': inst['tradingsymbol'], 'strike': strike}
                    elif option_type == 'PE':
                        option_data['atm_minus2_pe'] = {'token': inst['instrument_token'], 'symbol': inst['tradingsymbol'], 'strike': strike}
                elif strike == atm_plus2_strike:
                    if option_type == 'CE':
                        option_data['atm_plus2_ce'] = {'token': inst['instrument_token'], 'symbol': inst['tradingsymbol'], 'strike': strike}
                    elif option_type == 'PE':
                        option_data['atm_plus2_pe'] = {'token': inst['instrument_token'], 'symbol': inst['tradingsymbol'], 'strike': strike}
            
            return option_data
        except Exception as e:
            logging.error(f"Error getting option instruments for monitoring: {e}", exc_info=True)
            return {}
    
    def _update_option_prices(self):
        """Fetch and update option prices (ATM, ATM+2, ATM-2) from Kite API"""
        # Skip option price updates during replay (when kite is None)
        if self.kite is None:
            return
        
        try:
            current_ltp = self.status.get('current_ltp', 0)
            if current_ltp == 0:
                return
            
            # Get option instruments (cache if not already cached or if LTP changed significantly)
            if not self.option_instrument_tokens or (self.last_option_price_update is None or 
                                                    (datetime.datetime.now() - self.last_option_price_update).total_seconds() > 300):
                self.option_instrument_tokens = self._get_option_instruments_for_monitoring(current_ltp)
                self.last_option_price_update = datetime.datetime.now()
            
            if not self.option_instrument_tokens:
                return
            
            # Prepare list of tokens to fetch
            tokens_to_fetch = []
            for key in ['atm_ce', 'atm_pe', 'atm_plus2_ce', 'atm_plus2_pe', 'atm_minus2_ce', 'atm_minus2_pe']:
                if key in self.option_instrument_tokens:
                    tokens_to_fetch.append(self.option_instrument_tokens[key]['token'])
            
            if not tokens_to_fetch:
                return
            
            # Fetch LTP for all option tokens at once
            ltp_response = self.kite.ltp(tokens_to_fetch)
            
            # Update option prices and symbols in status
            for key in ['atm_ce', 'atm_pe', 'atm_plus2_ce', 'atm_plus2_pe', 'atm_minus2_ce', 'atm_minus2_pe']:
                if key in self.option_instrument_tokens:
                    token = self.option_instrument_tokens[key]['token']
                    if token in ltp_response:
                        self.status['option_prices'][key] = ltp_response[token]['last_price']
                        self.status['option_symbols'][key] = self.option_instrument_tokens[key]['symbol']
                    else:
                        self.status['option_prices'][key] = None
                        self.status['option_symbols'][key] = self.option_instrument_tokens[key]['symbol']
        except Exception as e:
            logging.error(f"Error updating option prices: {e}", exc_info=True)

    def _get_option_lot_size(self):
        """Return option lot size based on instrument"""
        instrument_name = self.instrument.upper()
        lot_mapping = self.pe_rules.get('lot_sizes', {})
        base_lot = lot_mapping.get(instrument_name)
        if base_lot is None:
            base_lot = lot_mapping.get('DEFAULT')
        if base_lot is None:
            base_lot = 35 if 'BANK' in instrument_name else 75
        return int(base_lot * self.total_lot)

    def _get_option_price_snapshot(self, option_type, instrument_token=None):
        """Fetch latest option LTP using instrument token or cached option prices"""
        ltp_value = None
        if instrument_token and self.kite is not None:
            try:
                quote_key = f"NFO:{instrument_token}" if isinstance(instrument_token, str) and ':' not in instrument_token else instrument_token
                quote = self.kite.ltp([quote_key])
                instrument_key = list(quote.keys())[0]
                ltp_value = quote[instrument_key]['last_price']
            except Exception:
                ltp_value = None

        if ltp_value is None:
            price_key = 'atm_pe' if option_type == 'PE' else 'atm_ce'
            ltp_value = self.status.get('option_prices', {}).get(price_key)

        return ltp_value

    def _record_option_entry(self, option_type, signal_time, signal_high, signal_low, index_price, instrument_token, option_symbol, entry_time):
        option_entry_price = self._get_option_price_snapshot(option_type, instrument_token)
        if option_entry_price is None:
            return

        stop_loss_percent = self.pe_rules.get('option_trade', {}).get('stop_loss_percent', -0.17)
        target_percent = self.pe_rules.get('option_trade', {}).get('target_percent', 0.45)

        stop_loss_price = option_entry_price * (1 + stop_loss_percent)
        target_price = option_entry_price * (1 + target_percent)
        lot_size = self._get_option_lot_size()
        rounding_map = self.pe_rules.get('strike_rounding', {})
        rounding_value = rounding_map.get(self.instrument.upper())
        if rounding_value is None:
            rounding_value = 50 if 'BANK' not in self.instrument.upper() else 100
        atm_strike = extract_strike_from_symbol(option_symbol) or round_to_multiple(index_price, rounding_value)

        option_trade = {
            'signal_time': signal_time,
            'signal_type': option_type,
            'signal_high': float(signal_high),
            'signal_low': float(signal_low),
            'index_at_entry': float(index_price),
            'atm_strike': atm_strike,
            'option_symbol': option_symbol,
            'entry_time': entry_time,
            'option_entry_price': float(option_entry_price),
            'stop_loss_price': float(stop_loss_price),
            'target_price': float(target_price),
            'lot_size': lot_size,
            'exit_time': None,
            'option_exit_price': None,
            'exit_type': None,
            'pnl': None,
            'pnl_percent': None,
            'status': 'open'
        }

        self.option_trade_history.append(option_trade)
        self.active_option_trade = option_trade

    def _record_option_exit(self, exit_type, timestamp):
        if not self.active_option_trade:
            return

        instrument_token = self.status.get('traded_instrument_token')
        option_type = self.active_option_trade.get('signal_type', 'PE')
        option_exit_price = self._get_option_price_snapshot(option_type, instrument_token)
        if option_exit_price is None:
            option_exit_price = self.active_option_trade.get('option_entry_price')

        lot_size = self.active_option_trade.get('lot_size', self._get_option_lot_size())
        entry_price = self.active_option_trade.get('option_entry_price', 0)

        pnl = (option_exit_price - entry_price) * lot_size
        pnl_percent = ((option_exit_price - entry_price) / entry_price) * 100 if entry_price else 0

        exit_type_mapped = exit_type
        if exit_type in ('SL', 'STOP_LOSS'):
            exit_type_mapped = 'STOP_LOSS'
        elif exit_type in ('TP', 'TARGET'):
            exit_type_mapped = 'TARGET'
        elif exit_type == 'MKT_CLOSE':
            exit_type_mapped = 'MKT_CLOSE'

        self.active_option_trade.update({
            'exit_time': timestamp.isoformat() if isinstance(timestamp, datetime.datetime) else str(timestamp),
            'option_exit_price': float(option_exit_price),
            'exit_type': exit_type_mapped,
            'pnl': float(pnl),
            'pnl_percent': float(pnl_percent),
            'status': 'closed'
        })

        self.active_option_trade = None

    def get_option_trade_history(self):
        return self.option_trade_history
    
    def _add_audit_trail(self, event_type, message, data=None):
        """Add entry to audit trail for strategy behavior tracking"""
        try:
            audit_entry = {
                'timestamp': datetime.datetime.now().isoformat(),
                'event_type': event_type,  # 'signal_identified', 'entry', 'exit', 'stop_loss', 'target_hit', 'signal_reset', etc.
                'message': message,
                'data': data or {}
            }
            self.status['audit_trail'].append(audit_entry)
            
            # Keep only last 1000 audit entries
            if len(self.status['audit_trail']) > 1000:
                self.status['audit_trail'] = self.status['audit_trail'][-1000:]
            
            # Save to database if paper trading
            if self.paper_trade and self.paper_trade_session_id:
                try:
                    from database import get_db_connection
                    import json
                    conn = get_db_connection()
                    cursor = conn.cursor()
                    cursor.execute("""
                        INSERT INTO paper_trade_audit_trail 
                        (session_id, timestamp, log_type, message, details)
                        VALUES (?, ?, ?, ?, ?)
                    """, (
                        self.paper_trade_session_id,
                        datetime.datetime.now(),
                        event_type,
                        message,
                        json.dumps(data) if data else None
                    ))
                    conn.commit()
                    conn.close()
                except Exception as db_error:
                    logging.error(f"Error saving audit trail to database: {db_error}", exc_info=True)
            
            logging.info(f"[AUDIT] {event_type}: {message}")
        except Exception as e:
            logging.error(f"Error adding audit trail: {e}", exc_info=True)
    
    def _get_atm_option_symbol(self, ltp, option_type):
        """Get ATM option symbol and instrument token for trading"""
        # Skip during replay (when kite is None)
        if self.kite is None:
            return None, None
        
        try:
            # Get option symbols for ATM +/- 2 strikes
            option_tokens = get_option_symbols(self.kite, self.instrument, self.expiry_type, 2)
            if not option_tokens:
                logging.warning(f"Could not fetch option symbols for {self.instrument}")
                return None, None
            
            # Get all instruments to find the trading symbol
            instruments = self.kite.instruments('NFO')
            
            # Find expiry date
            all_expiries = sorted(list(set([
                inst['expiry'] for inst in instruments 
                if inst['name'] == self.instrument and 'expiry' in inst and inst['expiry']
            ])))
            
            today = datetime.date.today()
            expiry_type_lower = self.expiry_type.lower() if self.expiry_type else ''
            
            if expiry_type_lower == 'weekly':
                # Find the first expiry after today
                expiries_after_today = [d for d in all_expiries if d > today]
                expiry_date = expiries_after_today[0] if len(expiries_after_today) > 0 else None
                # If no expiry after today, try to get today's expiry or next available
                if not expiry_date:
                    expiry_date = next((d for d in all_expiries if d >= today), None)
            elif expiry_type_lower == 'next_weekly':
                # Find the second expiry after today
                expiries_after_today = [d for d in all_expiries if d > today]
                expiry_date = expiries_after_today[1] if len(expiries_after_today) > 1 else None
                # Fallback to first expiry if second doesn't exist
                if not expiry_date and len(expiries_after_today) > 0:
                    expiry_date = expiries_after_today[0]
            elif expiry_type_lower == 'monthly':
                # Find the next expiry that is at least 20 days away
                expiry_date = next((d for d in all_expiries if (d - today).days >= 20), None)
                # Fallback to furthest expiry if no monthly expiry found
                if not expiry_date and len(all_expiries) > 0:
                    expiry_date = max(all_expiries)
            else:
                expiry_date = None
            
            if not expiry_date:
                logging.warning(f"Could not find expiry date for {self.instrument} {self.expiry_type}. Available expiries: {all_expiries[:5] if len(all_expiries) > 0 else 'none'}")
                return None, None
            
            expiry_date_str = expiry_date.strftime('%Y-%m-%d')
            
            # Filter instruments by expiry and option type
            filtered_instruments = [inst for inst in instruments 
                                 if inst['name'] == self.instrument and 
                                    inst['instrument_type'] == option_type and
                                    inst['expiry'].strftime('%Y-%m-%d') == expiry_date_str]
            
            # Find ATM strike
            strike_prices = [inst['strike'] for inst in filtered_instruments]
            if not strike_prices:
                logging.warning(f"No strike prices found for {self.instrument} {option_type}")
                return None, None
            
            atm_strike = min(strike_prices, key=lambda x: abs(x - ltp))
            
            # Find the trading symbol and instrument token
            for inst in filtered_instruments:
                if inst['strike'] == atm_strike:
                    return inst['tradingsymbol'], inst['instrument_token']
            
            return None, None
        except Exception as e:
            logging.error(f"Error fetching ATM option symbol: {e}", exc_info=True)
            return None, None

    def _place_order(self, ltp, option_type, transaction_type):
        trading_symbol, instrument_token = self._get_atm_option_symbol(ltp, option_type)
        if not trading_symbol or not instrument_token:
            logging.error(f"Could not get trading symbol for {option_type} at LTP {ltp}")
            return None, None, None
        
        quantity = self.total_lot * 50 # Assuming 1 lot = 50 shares
        order_id = str(uuid.uuid4())[:8]

        if self.paper_trade:
            logging.info(f"[PAPER TRADE] Simulating {transaction_type} order for {trading_symbol} (token: {instrument_token}) with quantity {quantity}")
            return order_id, trading_symbol, instrument_token
        else:
            logging.info(f"Placing LIVE {transaction_type} order for {trading_symbol} (token: {instrument_token}) with quantity {quantity}")
            # Actual KiteConnect order placement would go here
            # order_id = self.kite.place_order(...)
            return order_id, trading_symbol, instrument_token

    def run(self):
        logging.info(f"Running Capture Mountain Signal strategy for {self.instrument}")
        self.status['state'] = 'running'
        self.status['message'] = 'Strategy is running and waiting for ticks.'

    def process_ticks(self, ticks):
        if not ticks:
            return

        latest_tick = ticks[-1] # Assuming ticks are ordered by time
        current_ltp = latest_tick['last_price']
        # Extract timestamp safely - handle different timestamp formats
        tick_timestamp = None
        if 'timestamp' in latest_tick:
            tick_timestamp = latest_tick['timestamp']
        elif 'last_trade_time' in latest_tick:
            tick_timestamp = latest_tick['last_trade_time']
        elif 'exchange_timestamp' in latest_tick:
            tick_timestamp = latest_tick['exchange_timestamp']
        
        if not tick_timestamp:
            # Skip this tick if no timestamp available
            logging.warning(f"Skipping tick in capture_mountain_signal due to missing timestamp: {latest_tick}")
            return

        self.status['current_ltp'] = current_ltp
        
        # Update option prices (every 5 seconds to avoid too many API calls)
        if self.last_option_price_update is None or \
           (datetime.datetime.now() - self.last_option_price_update).total_seconds() >= 5:
            self._update_option_prices()

        # Convert tick_timestamp to datetime object if it's not already
        if isinstance(tick_timestamp, (int, float)):
            tick_datetime = datetime.datetime.fromtimestamp(tick_timestamp)
        elif isinstance(tick_timestamp, str):
            try:
                tick_datetime = datetime.datetime.strptime(tick_timestamp, '%Y-%m-%d %H:%M:%S')
            except ValueError:
                tick_datetime = datetime.datetime.fromisoformat(tick_timestamp)
        else:
            tick_datetime = tick_timestamp # Assume it's already a datetime object

        # Check for Market Close Square Off (before processing ticks)
        # This ensures we check on every tick, not just on candle close
        if self.position != 0:
            tick_time = tick_datetime.time()
            market_close_square_off_time = datetime.time(15, 15)  # 3:15 PM
            market_close_time = datetime.time(15, 30)  # 3:30 PM
            
            if market_close_square_off_time <= tick_time < market_close_time:
                # Square off the trade using current LTP
                self.exit_price = current_ltp
                current_pnl = (self.exit_price - self.entry_price) * self.total_lot * 50 * self.position
                self.status['pnl'] = current_pnl
                
                self._add_audit_trail('market_close_square_off', f"Market close square off at {self.exit_price:.2f} (15 min before close)", {
                    'exit_price': self.exit_price,
                    'entry_price': self.entry_price,
                    'pnl': current_pnl,
                    'position': 'CE' if self.position == 1 else 'PE',
                    'square_off_time': '15:15',
                    'tick_time': tick_datetime.strftime('%H:%M:%S')
                })
                self._close_trade('MKT_CLOSE', tick_datetime)
                logging.info(f"Market close square off executed at {self.exit_price:.2f}. P&L: {current_pnl:.2f}")
                return  # Exit early after square off

        # Determine the current 5-minute candle's start time
        candle_interval_minutes = int(self.candle_time)
        current_candle_start_time = tick_datetime - datetime.timedelta(minutes=tick_datetime.minute % candle_interval_minutes, seconds=tick_datetime.second, microseconds=tick_datetime.microsecond)

        # Initialize or update current candle data
        if self.current_candle_data is None or self.current_candle_data['date'] != current_candle_start_time:
            # New candle started
            if self.current_candle_data is not None: # Process the completed candle
                self._process_completed_candle(self.current_candle_data)
            
            self.current_candle_data = {
                'date': current_candle_start_time,
                'open': current_ltp,
                'high': current_ltp,
                'low': current_ltp,
                'close': current_ltp,
                'volume': 0 # Volume not available in ticks, keep as 0 or estimate
            }
            self.historical_data.append(self.current_candle_data) # Add new candle to historical data
            # Reset signal evaluation flag for new candle
            self.signal_evaluated_for_current_candle = False
        else:
            # Update existing candle
            self.current_candle_data['high'] = max(self.current_candle_data['high'], current_ltp)
            self.current_candle_data['low'] = min(self.current_candle_data['low'], current_ltp)
            self.current_candle_data['close'] = current_ltp
            # self.current_candle_data['volume'] += latest_tick.get('volume_delta', 0) # If volume delta is available

        # Keep historical_data to a manageable size (e.g., last 100 candles)
        if len(self.historical_data) > 100:
            self.historical_data.pop(0)

        # Update status message
        self.status['message'] = f"Processing ticks. Current candle: {self.current_candle_data['date'].strftime('%H:%M')} - {current_ltp:.2f}"
        # Update aligned last execution time (minute % 5 == 4, second == 40)
        try:
            self.status['last_execution_time'] = self._aligned_execution_time(tick_datetime).isoformat()
        except Exception:
            pass

        # **SIGNAL EVALUATION TIMING: rule-driven seconds before candle close**
        # Calculate how many seconds we are from the candle end
        candle_duration_seconds = candle_interval_minutes * 60
        seconds_into_candle = (tick_datetime - current_candle_start_time).total_seconds()
        seconds_before_close = candle_duration_seconds - seconds_into_candle
        
        target_seconds = getattr(self, '_signal_evaluate_seconds', 20)
        buffer_seconds = getattr(self, '_signal_evaluate_buffer', 2)
        lower_bound = max(0, target_seconds - buffer_seconds)
        upper_bound = target_seconds + buffer_seconds

        # Evaluate signal close to candle completion while still prior to close
        if lower_bound <= seconds_before_close <= upper_bound:
            if not self.signal_evaluated_for_current_candle and len(self.historical_data) > self.ema_period:
                self._evaluate_signal_candle()
                self.signal_evaluated_for_current_candle = True
                logging.info(
                    f"Signal evaluation triggered at {tick_datetime.strftime('%H:%M:%S')} "
                    f"({seconds_before_close:.1f}s before candle close; target {target_seconds}s ± {buffer_seconds}s)"
                )

        # Only run strategy logic if we have enough historical data for EMA calculation
        if len(self.historical_data) > self.ema_period:
            self._apply_strategy_logic()

    def _process_completed_candle(self, candle):
        # This method is called when a candle closes. 
        # The main strategy logic will be applied here or in _apply_strategy_logic
        pass

    def _evaluate_signal_candle(self):
        """
        Evaluate signal candle conditions 20 seconds before candle close.
        This method checks if the CURRENT (forming) candle meets signal criteria.
        At 20 seconds before close, we have 99% complete candle data.
        """
        df = pd.DataFrame(self.historical_data)
        df['ema'] = df['close'].ewm(span=self.ema_period, adjust=False).mean()
        
        # Calculate RSI 14 for signal identification
        if len(df) >= 15:  # Need at least 15 candles for RSI 14
            df['rsi14'] = calculate_rsi(df['close'], period=14)
        else:
            df['rsi14'] = None

        # Ensure we have at least one candle
        if len(df) < 1:
            return

        # Use the CURRENT (last) candle for evaluation - it's still forming but 99% complete
        current_candle = df.iloc[-1]
        current_ema = current_candle['ema']
        current_rsi = current_candle['rsi14'] if 'rsi14' in df.columns and pd.notna(current_candle['rsi14']) else None

        timing_seconds = getattr(self, '_signal_evaluate_seconds', 20)
        timing_label = f"{int(timing_seconds)}s before close"

        # --- PE Signal Candle Identification: LOW > 5 EMA AND RSI > 70 ---
        # Note: We evaluate the forming candle shortly before close per rules
        if current_candle['low'] > current_ema:
            # RSI condition must be met at signal identification time
            if current_rsi is not None and current_rsi > 70:
                # Signal Reset: If a newer candle meets the same criteria (LOW > 5 EMA + RSI > 70), 
                # it REPLACES the previous PE signal candle
                if self.pe_signal_candle is not None:
                    # New PE signal candle replaces old one
                    # Reset price action validation and entry tracking
                    self.pe_signal_price_above_low = False
                    # Clear entry tracking for old signal
                    signal_candle_id = id(self.pe_signal_candle)
                    if signal_candle_id in self.signal_candles_with_entry:
                        self.signal_candles_with_entry.remove(signal_candle_id)
                
                self.pe_signal_candle = current_candle
                self.status['signal_status'] = f"PE Signal Candle Identified ({timing_label}): {self.pe_signal_candle['date'].strftime('%H:%M')} (H:{self.pe_signal_candle['high']:.2f}, L:{self.pe_signal_candle['low']:.2f})"
                self.status['signal_candle_time'] = self.pe_signal_candle['date'].strftime('%H:%M') + '-' + (self.pe_signal_candle['date'] + datetime.timedelta(minutes=int(self.candle_time))).strftime('%H:%M')
                self.status['signal_candle_high'] = self.pe_signal_candle['high']
                self.status['signal_candle_low'] = self.pe_signal_candle['low']
                self.ce_signal_candle = None # Only one active signal type
                self._add_audit_trail('signal_identified', self.status['signal_status'], {
                    'signal_type': 'PE',
                    'candle_time': self.status['signal_candle_time'],
                    'high': self.pe_signal_candle['high'],
                    'low': self.pe_signal_candle['low'],
                    'ema': current_ema,
                    'rsi': current_rsi,
                    'evaluation_timing': f'{int(timing_seconds)}_seconds_before_close'
                })
                # Append to today's signal history
                try:
                    signal_date = self.pe_signal_candle['date'] if isinstance(self.pe_signal_candle['date'], datetime.datetime) else None
                    if signal_date and signal_date.date() == datetime.date.today():
                        self.status['signal_history_today'].append({
                            'type': 'PE',
                            'time': self.status['signal_candle_time'],
                            'high': self.pe_signal_candle['high'],
                            'low': self.pe_signal_candle['low']
                        })
                        if len(self.status['signal_history_today']) > 200:
                            self.status['signal_history_today'] = self.status['signal_history_today'][-200:]
                except Exception:
                    pass
                logging.info(self.status['signal_status'])

        # --- CE Signal Candle Identification: HIGH < 5 EMA AND RSI < 30 ---
        # Note: We evaluate the forming candle shortly before close per rules
        if current_candle['high'] < current_ema:
            # RSI condition must be met at signal identification time
            if current_rsi is not None and current_rsi < 30:
                # Signal Reset: If a newer candle meets the same criteria (HIGH < 5 EMA + RSI < 30), 
                # it REPLACES the previous CE signal candle
                if self.ce_signal_candle is not None:
                    # New CE signal candle replaces old one
                    # Reset price action validation and entry tracking
                    self.ce_signal_price_below_high = False
                    # Clear entry tracking for old signal
                    signal_candle_id = id(self.ce_signal_candle)
                    if signal_candle_id in self.signal_candles_with_entry:
                        self.signal_candles_with_entry.remove(signal_candle_id)
                
                self.ce_signal_candle = current_candle
                self.status['signal_status'] = f"CE Signal Candle Identified ({timing_label}): {self.ce_signal_candle['date'].strftime('%H:%M')} (H:{self.ce_signal_candle['high']:.2f}, L:{self.ce_signal_candle['low']:.2f})"
                self.status['signal_candle_time'] = self.ce_signal_candle['date'].strftime('%H:%M') + '-' + (self.ce_signal_candle['date'] + datetime.timedelta(minutes=int(self.candle_time))).strftime('%H:%M')
                self.status['signal_candle_high'] = self.ce_signal_candle['high']
                self.status['signal_candle_low'] = self.ce_signal_candle['low']
                self.pe_signal_candle = None # Only one active signal type
                self._add_audit_trail('signal_identified', self.status['signal_status'], {
                    'signal_type': 'CE',
                    'candle_time': self.status['signal_candle_time'],
                    'high': self.ce_signal_candle['high'],
                    'low': self.ce_signal_candle['low'],
                    'ema': current_ema,
                    'rsi': current_rsi,
                    'evaluation_timing': f'{int(timing_seconds)}_seconds_before_close'
                })
                # Append to today's signal history
                try:
                    signal_date = self.ce_signal_candle['date'] if isinstance(self.ce_signal_candle['date'], datetime.datetime) else None
                    if signal_date and signal_date.date() == datetime.date.today():
                        self.status['signal_history_today'].append({
                            'type': 'CE',
                            'time': self.status['signal_candle_time'],
                            'high': self.ce_signal_candle['high'],
                            'low': self.ce_signal_candle['low']
                        })
                        if len(self.status['signal_history_today']) > 200:
                            self.status['signal_history_today'] = self.status['signal_history_today'][-200:]
                except Exception:
                    pass
                logging.info(self.status['signal_status'])

    def _apply_strategy_logic(self):
        df = pd.DataFrame(self.historical_data)
        df['ema'] = df['close'].ewm(span=self.ema_period, adjust=False).mean()
        
        # Calculate RSI 14 for signal identification
        if len(df) >= 15:  # Need at least 15 candles for RSI 14
            df['rsi14'] = calculate_rsi(df['close'], period=14)
        else:
            df['rsi14'] = None

        # Ensure we have at least two candles for signal/entry logic
        if len(df) < 2:
            self.status['signal_status'] = 'Not enough candles for signal identification.'
            return

        current_candle = df.iloc[-1]
        current_ema = current_candle['ema']

        # NOTE: Signal identification is now handled by _evaluate_signal_candle() 
        # which runs 20 seconds before candle close. This method only handles entry/exit logic.

        # Track price action: Check if price has traded above PE signal low or below CE signal high
        # This validation is only needed AFTER a trade exit (stop loss or target)
        if self.pe_signal_candle is not None and not self.trade_placed and not self.pe_signal_price_above_low:
            # Check if price (high) has traded above PE signal candle's low
            if current_candle['high'] > self.pe_signal_candle['low']:
                self.pe_signal_price_above_low = True
                logging.info(f"PE price action validation met: Price HIGH ({current_candle['high']:.2f}) > Signal LOW ({self.pe_signal_candle['low']:.2f})")
        
        if self.ce_signal_candle is not None and not self.trade_placed and not self.ce_signal_price_below_high:
            # Check if price (low) has traded below CE signal candle's high
            if current_candle['low'] < self.ce_signal_candle['high']:
                self.ce_signal_price_below_high = True
                logging.info(f"CE price action validation met: Price LOW ({current_candle['low']:.2f}) < Signal HIGH ({self.ce_signal_candle['high']:.2f})")

        # --- Trade Entry Logic ---
        if not self.trade_placed:
            # PE Entry: After exit, require price action validation
            if self.pe_signal_candle is not None:
                # Check if entry condition is met: current candle close < signal candle low
                entry_condition_met = current_candle['close'] < self.pe_signal_candle['low']
                
                if not entry_condition_met:
                    # Entry condition not met yet - waiting for price to break below signal low
                    self.status['signal_status'] = f"PE Signal Active - Waiting for Entry: Close must break below {self.pe_signal_candle['low']:.2f} (Current: {current_candle['close']:.2f})"
                    logging.debug(f"PE Entry condition not met: Close ({current_candle['close']:.2f}) >= Signal Low ({self.pe_signal_candle['low']:.2f})")
                else:
                    # Entry condition met - check if entry is allowed
                    signal_candle_id = id(self.pe_signal_candle)  # Use signal candle object ID as identifier
                    is_first_entry = signal_candle_id not in self.signal_candles_with_entry
                    
                    if is_first_entry:
                        # First entry: no price action validation needed
                        entry_allowed = True
                    else:
                        # Re-entry: price action validation required
                        entry_allowed = self.pe_signal_price_above_low
                        if not entry_allowed:
                            logging.info(f"PE re-entry blocked: Price action validation not met (need HIGH > {self.pe_signal_candle['low']:.2f})")
                            self._add_audit_trail('entry_blocked', 
                                f"PE re-entry blocked: Price must trade above {self.pe_signal_candle['low']:.2f} first",
                                {
                                    'signal_candle_low': self.pe_signal_candle['low'],
                                    'current_high': current_candle['high'],
                                    'reason': 'price_action_validation_failed'
                                })
                    
                    if entry_allowed:
                        self.position = -1  # Short position (Buy PE)
                        self.entry_price = current_candle['close']
                        self.trade_placed = True
                        self.status['state'] = 'position_open'
                        trading_symbol, instrument_token = self._get_atm_option_symbol(self.entry_price, 'PE')
                        if trading_symbol and instrument_token:
                            self.status['traded_instrument'] = trading_symbol
                            self.status['traded_instrument_token'] = instrument_token
                            self.status['stop_loss_level'] = self.pe_signal_candle['high'] # SL for PE is signal candle high
                            self.status['target_profit_level'] = np.nan # Target calculated dynamically
                            order_id, _, _ = self._place_order(self.entry_price, 'PE', 'BUY')
                            signal_time = self.pe_signal_candle['date'].strftime('%Y-%m-%d %H:%M:%S') if 'date' in self.pe_signal_candle else datetime.datetime.now().isoformat()
                            entry_timestamp = current_candle.get('date', datetime.datetime.now())
                            if isinstance(entry_timestamp, (pd.Timestamp, datetime.datetime)):
                                entry_time = entry_timestamp.strftime('%Y-%m-%d %H:%M:%S')
                            else:
                                entry_time = str(entry_timestamp)
                            self._record_option_entry(
                                option_type='PE',
                                signal_time=signal_time,
                                signal_high=self.pe_signal_candle['high'],
                                signal_low=self.pe_signal_candle['low'],
                                index_price=self.entry_price,
                                instrument_token=instrument_token,
                                option_symbol=trading_symbol,
                                entry_time=entry_time
                            )
                            self.status['entry_order_id'] = order_id
                            self.status['message'] = f"PE trade initiated at {self.entry_price:.2f}. SL: {self.status['stop_loss_level']:.2f}"
                            self.trade_history.append({
                                'time': current_candle['date'].strftime('%H:%M:%S'),
                                'action': 'BUY PE',
                                'price': self.entry_price,
                                'instrument': self.status['traded_instrument'],
                                'order_id': order_id
                            })
                            self._add_audit_trail('entry', self.status['message'], {
                                'option_type': 'PE',
                                'entry_price': self.entry_price,
                                'stop_loss': self.status['stop_loss_level'],
                                'signal_candle_high': self.pe_signal_candle['high'],
                                'signal_candle_low': self.pe_signal_candle['low'],
                                'instrument': trading_symbol,
                                'order_id': order_id
                            })
                            logging.info(self.status['message'])
                            # Mark this signal candle as having had an entry
                            self.signal_candles_with_entry.add(signal_candle_id)
                            # Reset price action validation after entry (for next exit/entry cycle)
                            self.pe_signal_price_above_low = False
                        else:
                            logging.error("Could not get trading symbol for PE trade")
                            return

            # CE Entry: After exit, require price action validation
            elif self.ce_signal_candle is not None:
                # Check if entry condition is met: current candle close > signal candle high
                entry_condition_met = current_candle['close'] > self.ce_signal_candle['high']
                
                if not entry_condition_met:
                    # Entry condition not met yet - waiting for price to break above signal high
                    self.status['signal_status'] = f"CE Signal Active - Waiting for Entry: Close must break above {self.ce_signal_candle['high']:.2f} (Current: {current_candle['close']:.2f})"
                    logging.debug(f"CE Entry condition not met: Close ({current_candle['close']:.2f}) <= Signal High ({self.ce_signal_candle['high']:.2f})")
                else:
                    # Entry condition met - check if entry is allowed
                    signal_candle_id = id(self.ce_signal_candle)  # Use signal candle object ID as identifier
                    is_first_entry = signal_candle_id not in self.signal_candles_with_entry
                    
                    if is_first_entry:
                        # First entry: no price action validation needed
                        entry_allowed = True
                    else:
                        # Re-entry: price action validation required
                        entry_allowed = self.ce_signal_price_below_high
                        if not entry_allowed:
                            logging.info(f"CE re-entry blocked: Price action validation not met (need LOW < {self.ce_signal_candle['high']:.2f})")
                            self._add_audit_trail('entry_blocked', 
                                f"CE re-entry blocked: Price must trade below {self.ce_signal_candle['high']:.2f} first",
                                {
                                    'signal_candle_high': self.ce_signal_candle['high'],
                                    'current_low': current_candle['low'],
                                    'reason': 'price_action_validation_failed'
                                })
                    
                    if entry_allowed:
                        self.position = 1  # Long position (Buy CE)
                        self.entry_price = current_candle['close']
                        self.trade_placed = True
                        self.status['state'] = 'position_open'
                        trading_symbol, instrument_token = self._get_atm_option_symbol(self.entry_price, 'CE')
                        if trading_symbol and instrument_token:
                            self.status['traded_instrument'] = trading_symbol
                            self.status['traded_instrument_token'] = instrument_token
                            self.status['stop_loss_level'] = self.ce_signal_candle['low'] # SL for CE is signal candle low
                            self.status['target_profit_level'] = np.nan # Target calculated dynamically
                            order_id, _, _ = self._place_order(self.entry_price, 'CE', 'BUY')
                            signal_time = self.ce_signal_candle['date'].strftime('%Y-%m-%d %H:%M:%S') if 'date' in self.ce_signal_candle else datetime.datetime.now().isoformat()
                            entry_timestamp = current_candle.get('date', datetime.datetime.now())
                            if isinstance(entry_timestamp, (pd.Timestamp, datetime.datetime)):
                                entry_time = entry_timestamp.strftime('%Y-%m-%d %H:%M:%S')
                            else:
                                entry_time = str(entry_timestamp)
                            self._record_option_entry(
                                option_type='CE',
                                signal_time=signal_time,
                                signal_high=self.ce_signal_candle['high'],
                                signal_low=self.ce_signal_candle['low'],
                                index_price=self.entry_price,
                                instrument_token=instrument_token,
                                option_symbol=trading_symbol,
                                entry_time=entry_time
                            )
                            self.status['entry_order_id'] = order_id
                            self.status['message'] = f"CE trade initiated at {self.entry_price:.2f}. SL: {self.status['stop_loss_level']:.2f}"
                            self.trade_history.append({
                                'time': current_candle['date'].strftime('%H:%M:%S'),
                                'action': 'BUY CE',
                                'price': self.entry_price,
                                'instrument': self.status['traded_instrument'],
                                'order_id': order_id
                            })
                            self._add_audit_trail('entry', self.status['message'], {
                                'option_type': 'CE',
                                'entry_price': self.entry_price,
                                'stop_loss': self.status['stop_loss_level'],
                                'signal_candle_high': self.ce_signal_candle['high'],
                                'signal_candle_low': self.ce_signal_candle['low'],
                                'instrument': trading_symbol,
                                'order_id': order_id
                            })
                            logging.info(self.status['message'])
                            # Mark this signal candle as having had an entry
                            self.signal_candles_with_entry.add(signal_candle_id)
                            # Reset price action validation after entry (for next exit/entry cycle)
                            self.ce_signal_price_below_high = False
                        else:
                            logging.error("Could not get trading symbol for CE trade")
                            return

        # --- Position Management (SL/Target) ---
        elif self.position != 0: # If a position is open
            current_pnl = (current_candle['close'] - self.entry_price) * self.total_lot * 50 * self.position
            self.status['pnl'] = current_pnl
            self.status['message'] = f"Position open. Entry: {self.entry_price:.2f}, Current: {current_candle['close']:.2f}, P&L: {current_pnl:.2f}"

            # Check for Market Close Square Off (15 minutes before market close at 3:30 PM)
            # Square off at 3:15 PM (15:15) or later
            current_candle_date = current_candle['date']
            if isinstance(current_candle_date, datetime.datetime):
                current_time = current_candle_date.time()
            elif isinstance(current_candle_date, str):
                try:
                    current_time = datetime.datetime.strptime(current_candle_date, '%Y-%m-%d %H:%M:%S').time()
                except ValueError:
                    current_time = datetime.datetime.fromisoformat(current_candle_date).time()
            else:
                # Try to extract time from various formats
                current_time = datetime.datetime.now().time()  # Fallback
                logging.warning(f"Could not parse current_candle date: {current_candle_date}, using current time")
            
            market_close_square_off_time = datetime.time(15, 15)  # 3:15 PM
            market_close_time = datetime.time(15, 30)  # 3:30 PM
            
            if market_close_square_off_time <= current_time < market_close_time:
                # Square off the trade 15 minutes before market close
                self.exit_price = current_candle['close']
                self._add_audit_trail('market_close_square_off', f"Market close square off at {self.exit_price:.2f} (15 min before close)", {
                    'exit_price': self.exit_price,
                    'entry_price': self.entry_price,
                    'pnl': self.status['pnl'],
                    'position': 'CE' if self.position == 1 else 'PE',
                    'square_off_time': '15:15',
                    'candle_time': str(current_candle_date)
                })
                self._close_trade('MKT_CLOSE', current_candle_date if isinstance(current_candle_date, datetime.datetime) else datetime.datetime.now())
                logging.info(f"Market close square off executed at {self.exit_price:.2f}. P&L: {self.status['pnl']:.2f}")
                return  # Exit early after square off

            # Check for Stop Loss
            if (self.position == 1 and current_candle['close'] <= self.status['stop_loss_level']) or \
               (self.position == -1 and current_candle['close'] >= self.status['stop_loss_level']):
                self.exit_price = current_candle['close']
                self._add_audit_trail('stop_loss', f"Stop Loss hit at {self.exit_price:.2f}", {
                    'exit_price': self.exit_price,
                    'entry_price': self.entry_price,
                    'pnl': self.status['pnl'],
                    'position': 'CE' if self.position == 1 else 'PE'
                })
                self._close_trade('SL', current_candle['date'])
                logging.info(self.status['message'])

            # Check for Target Profit (PE Logic)
            elif self.position == -1 and self.pe_signal_candle is not None: # Short position (PE)
                if current_candle['high'] < current_ema: # Wait for at least 1 candle where HIGH < 5 EMA
                    self.target_hit_candles += 1
                else:
                    self.target_hit_candles = 0 # Reset if condition not met
                
                if self.target_hit_candles >= 1: # If condition met for at least one candle
                    # Then if 2 consecutive candles CLOSE > 5 EMA -> Exit PE trade
                    if len(df) >= 3 and df.iloc[-1]['close'] > df.iloc[-1]['ema'] and df.iloc[-2]['close'] > df.iloc[-2]['ema']:
                        self.exit_price = current_candle['close']
                        self._add_audit_trail('target_hit', f"Target Profit hit at {self.exit_price:.2f} (PE)", {
                            'exit_price': self.exit_price,
                            'entry_price': self.entry_price,
                            'pnl': self.status['pnl'],
                            'target_candles': self.target_hit_candles
                        })
                        # Reset price action validation flag after exit (for next entry)
                        self.pe_signal_price_above_low = False
                        self._close_trade('TP', current_candle['date'])
                        logging.info(self.status['message'])

            # Check for Target Profit (CE Logic)
            elif self.position == 1 and self.ce_signal_candle is not None: # Long position (CE)
                if current_candle['low'] > current_ema: # Wait for at least 1 candle where LOW > 5 EMA
                    self.target_hit_candles += 1
                else:
                    self.target_hit_candles = 0 # Reset if condition not met

                if self.target_hit_candles >= 1: # If condition met for at least one candle
                    # Then if 2 consecutive candles CLOSE < 5 EMA -> Exit CE trade
                    if len(df) >= 3 and df.iloc[-1]['close'] < df.iloc[-1]['ema'] and df.iloc[-2]['close'] < df.iloc[-2]['ema']:
                        self.exit_price = current_candle['close']
                        self._add_audit_trail('target_hit', f"Target Profit hit at {self.exit_price:.2f} (CE)", {
                            'exit_price': self.exit_price,
                            'entry_price': self.entry_price,
                            'pnl': self.status['pnl'],
                            'target_candles': self.target_hit_candles
                        })
                        # Reset price action validation flag after exit (for next entry)
                        self.ce_signal_price_below_high = False
                        self._close_trade('TP', current_candle['date'])
                        logging.info(self.status['message'])

    def _close_trade(self, exit_type, timestamp):
        self.status['state'] = 'position_closed'
        exit_type_display = 'Market Close' if exit_type == 'MKT_CLOSE' else exit_type
        self.status['message'] = f"Position closed by {exit_type_display} at {self.exit_price:.2f}. P&L: {self.status['pnl']:.2f}"
        
        order_id, _, _ = self._place_order(self.exit_price, 'PE' if self.position == -1 else 'CE', 'SELL')
        if exit_type == 'SL':
            self.status['sl_order_id'] = order_id
        elif exit_type == 'TP':
            self.status['tp_order_id'] = order_id
        elif exit_type == 'MKT_CLOSE':
            self.status['mkt_close_order_id'] = order_id

        exit_action_display = 'EXIT (Market Close)' if exit_type == 'MKT_CLOSE' else f'EXIT ({exit_type})'
        self.trade_history.append({
            'time': timestamp.strftime('%H:%M:%S'),
            'action': exit_action_display,
            'price': self.exit_price,
            'instrument': self.status['traded_instrument'],
            'order_id': order_id
        })
        
        self._add_audit_trail('exit', self.status['message'], {
            'exit_type': exit_type,
            'exit_price': self.exit_price,
            'entry_price': self.entry_price,
            'pnl': self.status['pnl'],
            'order_id': order_id,
            'position': 'PE' if self.position == -1 else 'CE'
        })
        self._record_option_exit(exit_type, timestamp)
        
        self.position = 0
        self.trade_placed = False
        self.pe_signal_candle = None
        self.ce_signal_candle = None
        self.target_hit_candles = 0
        self.status['entry_order_id'] = 'N/A'
        self.status['sl_order_id'] = 'N/A'
        self.status['tp_order_id'] = 'N/A'
        self.status['mkt_close_order_id'] = 'N/A'

