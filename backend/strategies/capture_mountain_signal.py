from .base_strategy import BaseStrategy
from utils.kite_utils import get_option_symbols
from utils.indicators import calculate_rsi
from rules import load_mountain_signal_pe_rules
from kiteconnect import KiteConnect
from kiteconnect.exceptions import TokenException, NetworkException, InputException
import logging
import datetime
import re
import pandas as pd
import numpy as np
import uuid
import time
from typing import Optional, Dict, Any


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
    _GLOBAL_NFO_INSTRUMENTS: Optional[list] = None
    _GLOBAL_NFO_LAST_FETCH: Optional[datetime.datetime] = None

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
    def __init__(
        self,
        kite,
        instrument,
        candle_time,
        start_time,
        end_time,
        stop_loss,
        target_profit,
        total_lot,
        trailing_stop_loss,
        segment,
        trade_type,
        strike_price,
        expiry_type,
        strategy_name_input,
        paper_trade=False,
        ema_period=5,
        session_id=None,
        live_order_context: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(kite, instrument, candle_time, start_time, end_time, stop_loss, target_profit, total_lot, trailing_stop_loss, segment, trade_type, strike_price, expiry_type, strategy_name_input)
        self.strategy_name_input = strategy_name_input
        self.paper_trade = paper_trade
        self.ema_period = ema_period
        self.paper_trade_session_id = session_id  # Store session_id for DB logging
        self.live_order_context: Dict[str, Any] = live_order_context.copy() if isinstance(live_order_context, dict) else {}
        self._live_kite_client: Optional[KiteConnect] = self.live_order_context.get('kite_client')
        self.instrument_token = self._get_instrument_token()
        self.historical_data = [] # Stores 5-minute candles
        self._yesterday_candles = []  # Store yesterday's candles for EMA/RSI initialization
        self.pe_signal_candle = None
        self.ce_signal_candle = None
        self.trade_placed = False
        self.position = 0  # 0: flat, 1: long, -1: short
        self.entry_price = 0
        self.exit_price = 0
        self.trade_history = []
        lot_size_context = self.live_order_context.get('lot_size')
        try:
            option_lot_size = int(lot_size_context)
        except Exception:
            option_lot_size = None
        if not option_lot_size or option_lot_size <= 0:
            if 'BANK' in (self.instrument or '').upper():
                option_lot_size = 15  # BANKNIFTY lot size is 15
            elif 'NIFTY' in (self.instrument or '').upper():
                option_lot_size = 50  # NIFTY lot size is 50
            else:
                option_lot_size = 50
        self.option_lot_size = int(max(1, option_lot_size))
        self.live_order_context['lot_size'] = self.option_lot_size
        self.live_order_context.setdefault('product', 'MIS')
        self.live_order_context.setdefault('tag', 'AIML-LIVE')

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
            'audit_trail': [],
            'lot_size': self.option_lot_size,
            'last_live_order_error': None,
        }
        self.last_candle_timestamp = None
        self.current_candle_data = None
        self.target_hit_candles = 0 # For target profit logic
        self.option_instrument_tokens = {}  # Cache for option instrument tokens
        self.last_option_price_update = None  # Track when we last updated option prices
        # Track all potential signals identified today
        self.status['signal_history_today'] = []
        # Track ALL signal evaluations (identified and ignored) with timestamps and reasons
        self.status['signal_evaluations'] = []  # List of all evaluations with timestamp, result, reason
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

        self._instruments_cache = CaptureMountainSignal._GLOBAL_NFO_INSTRUMENTS
        self._last_instruments_fetch = CaptureMountainSignal._GLOBAL_NFO_LAST_FETCH

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
            now = datetime.datetime.now()
            cache_ttl = datetime.timedelta(minutes=15)
            reuse_cache = (
                self._instruments_cache is not None and
                self._last_instruments_fetch is not None and
                (now - self._last_instruments_fetch) < cache_ttl
            )
            if reuse_cache:
                instruments = self._instruments_cache
            else:
                instruments = self.kite.instruments('NFO')
                self._instruments_cache = instruments
                self._last_instruments_fetch = now
                CaptureMountainSignal._GLOBAL_NFO_INSTRUMENTS = instruments
                CaptureMountainSignal._GLOBAL_NFO_LAST_FETCH = now
            
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
        except TokenException as exc:
            logging.error(f"Token error while fetching option instruments: {exc}")
            return {}
        except NetworkException as exc:
            wait_seconds = getattr(exc, 'retry_after', None)
            logging.warning(f"Rate limited while fetching option instruments: {exc}. "
                            f"{'Retrying after ' + str(wait_seconds) + 's' if wait_seconds else 'Will retry later.'}")
            # Return cached instruments if available, otherwise empty dict
            return self._instruments_cache or {}
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
                    # Update lot size from instrument data if available
                    if 'lot_size' in inst and inst['lot_size'] and inst['lot_size'] > 0:
                        self.option_lot_size = int(inst['lot_size'])
                        self.live_order_context['lot_size'] = self.option_lot_size
                        logging.info(f"Updated lot size from instrument data: {self.option_lot_size}")
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
        
        try:
            # Calculate base quantity
            base_quantity = int(max(1, int(self.total_lot)) * max(1, int(self.option_lot_size)))
            # Ensure quantity is a multiple of lot size (required by Kite API)
            quantity = round_to_multiple(base_quantity, self.option_lot_size)
        except Exception:
            base_quantity = max(1, int(self.total_lot)) * self.option_lot_size
            quantity = round_to_multiple(base_quantity, self.option_lot_size)

        if self.paper_trade or not self.live_order_context.get('api_key') or not self.live_order_context.get('access_token'):
            order_id = str(uuid.uuid4())[:8]
            logging.info(
                f"[PAPER TRADE] Simulating {transaction_type} order for {trading_symbol} (token: {instrument_token}) with quantity {quantity}"
            )
            return order_id, trading_symbol, instrument_token

        try:
            if self._live_kite_client is None:
                api_key = self.live_order_context.get('api_key')
                access_token = self.live_order_context.get('access_token')
                kite_live = KiteConnect(api_key=api_key)
                kite_live.set_access_token(access_token)
                self._live_kite_client = kite_live
                self.live_order_context['kite_client'] = kite_live
                logging.info("[LIVE TRADE] Kite client initialized for live orders.")
            else:
                kite_live = self._live_kite_client

            txn_type = transaction_type.upper()
            txn_constant = kite_live.TRANSACTION_TYPE_BUY if txn_type == 'BUY' else kite_live.TRANSACTION_TYPE_SELL
            product_setting = self.live_order_context.get('product') or 'MIS'
            if product_setting.upper() == 'MIS':
                product_constant = kite_live.PRODUCT_MIS
            elif product_setting.upper() == 'NRML':
                product_constant = kite_live.PRODUCT_NRML
            else:
                product_constant = product_setting.upper()

            params = {
                'variety': kite_live.VARIETY_REGULAR,
                'exchange': kite_live.EXCHANGE_NFO,
                'tradingsymbol': trading_symbol,
                'transaction_type': txn_constant,
                'quantity': quantity,
                'product': product_constant,
                'order_type': kite_live.ORDER_TYPE_MARKET,
                'validity': kite_live.VALIDITY_DAY,
            }
            if self.live_order_context.get('tag'):
                params['tag'] = str(self.live_order_context['tag'])

            order_id = kite_live.place_order(**params)
            logging.info(
                f"[LIVE TRADE] Order {order_id} placed: {txn_type} {trading_symbol} qty={quantity} (deployment={self.live_order_context.get('deployment_id')})"
            )
            self.status['last_live_order_error'] = None
            return order_id, trading_symbol, instrument_token
        except TokenException as exc:
            logging.error(f"[LIVE TRADE] Token error while placing {transaction_type} order for {trading_symbol}: {exc}")
            self.status['last_live_order_error'] = str(exc)
            return None, trading_symbol, instrument_token
        except NetworkException as exc:
            wait_seconds = getattr(exc, 'retry_after', 5)  # Default to 5 seconds if not specified
            logging.warning(f"[LIVE TRADE] Network error (rate limited?) while placing {transaction_type} order for {trading_symbol}: {exc}. "
                          f"Will retry after {wait_seconds}s")
            self.status['last_live_order_error'] = f"Rate limited: {exc}. Retry after {wait_seconds}s"
            # Wait before returning to allow retry
            time.sleep(min(wait_seconds, 10))  # Cap at 10 seconds
            return None, trading_symbol, instrument_token
        except InputException as exc:
            logging.error(f"[LIVE TRADE] Input error while placing {transaction_type} order for {trading_symbol}: {exc}. "
                         f"Quantity was {quantity}, lot size is {self.option_lot_size}")
            self.status['last_live_order_error'] = str(exc)
            return None, trading_symbol, instrument_token
        except Exception as exc:
            logging.error(
                f"[LIVE TRADE] Failed to place {transaction_type} order for {trading_symbol}: {exc}",
                exc_info=True,
            )
            self.status['last_live_order_error'] = str(exc)
            return None, trading_symbol, instrument_token

    def _initialize_historical_data_from_market_open(self):
        """
        Fetch historical data from market open (9:15 AM) when strategy is deployed mid-day.
        Uses yesterday's closing data to initialize EMA/RSI calculations.
        Evaluates all signals from the beginning of the day.
        """
        if self.kite is None:
            logging.warning("Kite client not available, skipping historical data initialization")
            return
        
        try:
            today = datetime.date.today()
            market_open_time = datetime.time(9, 15)
            market_close_time = datetime.time(15, 30)
            now = datetime.datetime.now()
            current_time = now.time()
            
            # Check if market is open (9:15 AM to 3:30 PM)
            if current_time < market_open_time or current_time > market_close_time:
                logging.info("Market is closed, skipping historical data initialization")
                return
            
            # Calculate start time (market open today)
            start_dt = datetime.datetime.combine(today, market_open_time)
            # End time is current time (or market close if past 3:30 PM)
            end_dt = min(now, datetime.datetime.combine(today, market_close_time))
            
            # Get previous trading day for EMA/RSI initialization
            prev_date = today
            days_back = 0
            while days_back < 5:  # Max 5 days back to find a trading day
                prev_date = prev_date - datetime.timedelta(days=1)
                days_back += 1
                # Skip weekends (Saturday=5, Sunday=6)
                if prev_date.weekday() < 5:
                    break
            
            # Fetch yesterday's closing data (last 20 candles for RSI initialization)
            prev_start = datetime.datetime.combine(prev_date, market_open_time)
            prev_end = datetime.datetime.combine(prev_date, market_close_time)
            
            logging.info(f"Fetching historical data from {start_dt} to {end_dt} for {self.instrument}")
            self.status['signal_status'] = 'Initializing historical data from market open...'
            
            # Fetch yesterday's data for EMA/RSI initialization
            try:
                prev_candles = self.kite.historical_data(
                    self.instrument_token,
                    from_date=prev_start,
                    to_date=prev_end,
                    interval='5minute',
                    continuous=False
                )
                
                # Convert to DataFrame and calculate initial EMA/RSI
                if prev_candles:
                    prev_df = pd.DataFrame(prev_candles)
                    prev_df['date'] = pd.to_datetime(prev_df['date'])
                    prev_df = prev_df.sort_values('date')
                    
                    # Store last few candles for EMA/RSI continuity
                    if len(prev_df) > 0:
                        # Keep last 20 candles for RSI calculation
                        # Convert to dict and ensure date is datetime
                        yesterday_records = prev_df.tail(20).to_dict('records')
                        for record in yesterday_records:
                            if isinstance(record['date'], pd.Timestamp):
                                record['date'] = record['date'].to_pydatetime()
                        self._yesterday_candles = yesterday_records
                        logging.info(f"Loaded {len(self._yesterday_candles)} candles from previous trading day")
                    else:
                        self._yesterday_candles = []
                else:
                    self._yesterday_candles = []
            except Exception as e:
                logging.warning(f"Could not fetch yesterday's data: {e}")
                self._yesterday_candles = []
            
            # Fetch today's data from market open
            try:
                today_candles = self.kite.historical_data(
                    self.instrument_token,
                    from_date=start_dt,
                    to_date=end_dt,
                    interval='5minute',
                    continuous=False
                )
                
                if not today_candles:
                    logging.info("No historical candles found for today")
                    return
                
                # Convert to DataFrame
                df = pd.DataFrame(today_candles)
                df['date'] = pd.to_datetime(df['date'])
                df = df.sort_values('date')
                
                # Combine yesterday's candles with today's for EMA/RSI calculation
                combined_candles = []
                if self._yesterday_candles:
                    # Convert yesterday's candles to same format
                    for candle in self._yesterday_candles:
                        combined_candles.append({
                            'date': candle['date'],
                            'open': candle['open'],
                            'high': candle['high'],
                            'low': candle['low'],
                            'close': candle['close'],
                            'volume': candle.get('volume', 0)
                        })
                
                # Add today's candles
                for _, row in df.iterrows():
                    combined_candles.append({
                        'date': row['date'],
                        'open': row['open'],
                        'high': row['high'],
                        'low': row['low'],
                        'close': row['close'],
                        'volume': row.get('volume', 0)
                    })
                
                # Calculate EMA and RSI on combined data
                combined_df = pd.DataFrame(combined_candles)
                combined_df['ema5'] = combined_df['close'].ewm(span=self.ema_period, adjust=False).mean()
                
                # Calculate RSI 14
                if len(combined_df) >= 15:
                    combined_df['rsi14'] = calculate_rsi(combined_df['close'], period=14)
                else:
                    combined_df['rsi14'] = None
                
                # Process only today's candles and evaluate signals
                today_df = combined_df[combined_df['date'].dt.date == today].copy()
                
                # Initialize historical_data with today's candles
                self.historical_data = []
                signals_identified = []
                signals_ignored = []
                
                for idx, row in today_df.iterrows():
                    candle_data = {
                        'date': row['date'],
                        'open': float(row['open']),
                        'high': float(row['high']),
                        'low': float(row['low']),
                        'close': float(row['close']),
                        'volume': float(row.get('volume', 0))
                    }
                    
                    # Get corresponding EMA and RSI from combined_df
                    ema5_value = float(row['ema5']) if pd.notna(row['ema5']) else None
                    rsi14_value = float(row['rsi14']) if pd.notna(row['rsi14']) else None
                    
                    # Add to historical data
                    self.historical_data.append(candle_data)
                    
                    # Evaluate signal for this candle (if we have EMA and RSI)
                    if ema5_value is not None and rsi14_value is not None:
                        # Check PE signal: LOW > 5 EMA AND RSI STRICTLY > 70
                        # IMPORTANT: RSI must be STRICTLY > 70 (not >= 70) for PE signal
                        candle_time_str = row['date'].strftime('%H:%M') if isinstance(row['date'], (datetime.datetime, pd.Timestamp)) else str(row['date'])
                        low_above_ema = candle_data['low'] > ema5_value
                        rsi_above_70 = rsi14_value > 70
                        
                        # Track evaluation for historical data
                        eval_record = {
                            'timestamp': row['date'].isoformat() if isinstance(row['date'], (datetime.datetime, pd.Timestamp)) else str(row['date']),
                            'candle_time': candle_time_str,
                            'candle_start': row['date'].isoformat() if isinstance(row['date'], (datetime.datetime, pd.Timestamp)) else str(row['date']),
                            'low': float(candle_data['low']),
                            'high': float(candle_data['high']),
                            'close': float(candle_data['close']),
                            'ema': float(ema5_value),
                            'rsi': float(rsi14_value),
                            'low_above_ema': low_above_ema,
                            'rsi_above_70': rsi_above_70,
                            'result': None,
                            'reason': None,
                            'signal_type': 'PE'
                        }
                        
                        if low_above_ema and rsi_above_70:  # Strictly greater than 70
                            eval_record['result'] = 'identified'
                            eval_record['reason'] = f"PE Signal identified: LOW ({candle_data['low']:.2f}) > EMA ({ema5_value:.2f}) AND RSI ({rsi14_value:.2f}) > 70"
                            signal_info = {
                                'type': 'PE',
                                'timestamp': row['date'],
                                'candle_time': row['date'],
                                'signal_high': candle_data['high'],
                                'signal_low': candle_data['low'],
                                'ema_value': ema5_value,
                                'rsi_value': rsi14_value,
                                'price': candle_data['close'],
                                'reasons': [
                                    f"PE Signal: Candle LOW ({candle_data['low']:.2f}) > 5 EMA ({ema5_value:.2f})",
                                    f"RSI ({rsi14_value:.2f}) > 70 (Overbought condition)"
                                ]
                            }
                            signals_identified.append(signal_info)
                            self._add_audit_trail('signal_identified', 
                                f"PE Signal identified at {candle_time_str}: {', '.join(signal_info['reasons'])}",
                                signal_info
                            )
                        else:
                            eval_record['result'] = 'ignored'
                            if not low_above_ema:
                                eval_record['reason'] = f"Signal ignored: LOW ({candle_data['low']:.2f}) <= EMA ({ema5_value:.2f})"
                            else:
                                eval_record['reason'] = f"Signal ignored: RSI ({rsi14_value:.2f}) <= 70 (required > 70)"
                        
                        # Add to evaluation history
                        if 'signal_evaluations' not in self.status:
                            self.status['signal_evaluations'] = []
                        self.status['signal_evaluations'].append(eval_record)
                        
                        # Check CE signal: HIGH < 5 EMA AND RSI < 30
                        # NOTE: CE signals are IGNORED in live trading - only PE trades are allowed
                        if candle_data['high'] < ema5_value and rsi14_value < 30:
                            # CE signal detected but ignored for live trading
                            ignore_reason = f"CE signal detected but ignored (LIVE TRADING: Only PE trades allowed). HIGH ({candle_data['high']:.2f}) < EMA ({ema5_value:.2f}) AND RSI ({rsi14_value:.2f}) < 30"
                            signals_ignored.append({
                                'type': 'CE',
                                'timestamp': row['date'],
                                'candle_time': row['date'],
                                'reason': ignore_reason,
                                'ema_value': ema5_value,
                                'rsi_value': rsi14_value,
                                'price': candle_data['close']
                            })
                            self._add_audit_trail('signal_ignored', ignore_reason, {
                                'candle_time': row['date'],
                                'ema': ema5_value,
                                'rsi': rsi14_value,
                                'reason': 'CE signals disabled for live trading'
                            })
                        # Check if signal conditions were almost met but RSI didn't satisfy
                        elif candle_data['low'] > ema5_value and rsi14_value <= 70:
                            # PE condition met but RSI not satisfied
                            ignore_reason = f"PE signal condition met (LOW {candle_data['low']:.2f} > EMA {ema5_value:.2f}) but RSI ({rsi14_value:.2f}) <= 70 (required > 70)"
                            signals_ignored.append({
                                'type': 'PE',
                                'timestamp': row['date'],
                                'candle_time': row['date'],
                                'reason': ignore_reason,
                                'ema_value': ema5_value,
                                'rsi_value': rsi14_value,
                                'price': candle_data['close']
                            })
                            self._add_audit_trail('signal_ignored', ignore_reason, {
                                'candle_time': row['date'],
                                'ema': ema5_value,
                                'rsi': rsi14_value
                            })
                        elif candle_data['high'] < ema5_value and rsi14_value >= 30:
                            # CE condition met but RSI not satisfied
                            ignore_reason = f"CE signal condition met (HIGH {candle_data['high']:.2f} < EMA {ema5_value:.2f}) but RSI ({rsi14_value:.2f}) >= 30 (required < 30)"
                            signals_ignored.append({
                                'type': 'CE',
                                'timestamp': row['date'],
                                'candle_time': row['date'],
                                'reason': ignore_reason,
                                'ema_value': ema5_value,
                                'rsi_value': rsi14_value,
                                'price': candle_data['close']
                            })
                            self._add_audit_trail('signal_ignored', ignore_reason, {
                                'candle_time': row['date'],
                                'ema': ema5_value,
                                'rsi': rsi14_value
                            })
                
                # Update status with initialization results
                self.status['historical_data_initialized'] = True
                self.status['signals_from_market_open'] = signals_identified
                self.status['ignored_signals_from_market_open'] = signals_ignored
                self.status['historical_candles_loaded'] = len(self.historical_data)
                
                if len(self.historical_data) >= self.ema_period:
                    self.status['signal_status'] = f'Historical data loaded: {len(self.historical_data)} candles from market open. {len(signals_identified)} signals identified, {len(signals_ignored)} ignored.'
                else:
                    self.status['signal_status'] = f'Building historical data ({len(self.historical_data)}/{self.ema_period} candles)'
                
                logging.info(f"Initialized {len(self.historical_data)} candles from market open. {len(signals_identified)} signals identified, {len(signals_ignored)} ignored.")
                
                # Set the most recent signal candle if any signals were identified
                if signals_identified:
                    latest_signal = signals_identified[-1]
                    if latest_signal['type'] == 'PE':
                        # Create a signal candle object for PE
                        signal_date = latest_signal['candle_time']
                        if isinstance(signal_date, pd.Timestamp):
                            signal_date = signal_date.to_pydatetime()
                        elif isinstance(signal_date, str):
                            try:
                                signal_date = datetime.datetime.fromisoformat(signal_date)
                            except:
                                signal_date = datetime.datetime.now()
                        
                        self.pe_signal_candle = pd.Series({
                            'date': signal_date,
                            'high': latest_signal['signal_high'],
                            'low': latest_signal['signal_low'],
                            'close': latest_signal['price']
                        })
                        
                        # Update status fields to reflect the signal candle
                        self.status['signal_candle_time'] = signal_date.strftime('%H:%M') + '-' + (signal_date + datetime.timedelta(minutes=int(self.candle_time))).strftime('%H:%M')
                        self.status['signal_candle_high'] = float(latest_signal['signal_high'])
                        self.status['signal_candle_low'] = float(latest_signal['signal_low'])
                        self.status['signal_status'] = f"PE Signal Candle Identified (from historical data): {signal_date.strftime('%H:%M')} (H:{latest_signal['signal_high']:.2f}, L:{latest_signal['signal_low']:.2f})"
                        
                        logging.info(f"PE Signal candle set from historical data: {signal_date.strftime('%H:%M')} (H:{latest_signal['signal_high']:.2f}, L:{latest_signal['signal_low']:.2f})")
                    elif latest_signal['type'] == 'CE':
                        # Create a signal candle object for CE (but CE signals are ignored in live trading)
                        signal_date = latest_signal['candle_time']
                        if isinstance(signal_date, pd.Timestamp):
                            signal_date = signal_date.to_pydatetime()
                        elif isinstance(signal_date, str):
                            try:
                                signal_date = datetime.datetime.fromisoformat(signal_date)
                            except:
                                signal_date = datetime.datetime.now()
                        
                        # CE signals are ignored, but we still clear any existing CE signal candle
                        self.ce_signal_candle = None
                        logging.debug(f"CE Signal detected in historical data but ignored (only PE trades allowed): {signal_date.strftime('%H:%M')}")
                
            except Exception as e:
                logging.error(f"Error initializing historical data: {e}", exc_info=True)
                self.status['signal_status'] = f'Error loading historical data: {str(e)}'
        
        except Exception as e:
            logging.error(f"Error in _initialize_historical_data_from_market_open: {e}", exc_info=True)
            self.status['signal_status'] = f'Error initializing historical data: {str(e)}'

    def _check_and_restore_existing_position(self):
        """
        Check for existing positions in Zerodha and restore strategy state if a position is found.
        This prevents entering a new trade when one is already active after server restart.
        """
        if self.kite is None or self._live_kite_client is None:
            return
        
        try:
            # Get positions from Kite
            positions = self._live_kite_client.positions()
            
            if not positions or not isinstance(positions, dict):
                return
            
            # Check net positions (day positions)
            net_positions = positions.get('net', [])
            if not net_positions:
                return
            
            # Find positions that match our strategy's option symbols
            # We need to check if there's an active option position
            for pos in net_positions:
                quantity = pos.get('quantity', 0)
                if quantity == 0:
                    continue
                
                tradingsymbol = pos.get('tradingsymbol', '').upper()
                product = pos.get('product', '').upper()
                
                # Check if this is an option position (PE or CE)
                if 'PE' in tradingsymbol or 'CE' in tradingsymbol:
                    # Check if it matches our strategy's instrument (BANKNIFTY or NIFTY)
                    instrument_match = False
                    if 'BANK' in self.instrument.upper() and 'BANKNIFTY' in tradingsymbol:
                        instrument_match = True
                    elif 'NIFTY' in self.instrument.upper() and 'NIFTY' in tradingsymbol and 'BANKNIFTY' not in tradingsymbol:
                        instrument_match = True
                    
                    if instrument_match:
                        # We have an active position - restore strategy state
                        avg_price = pos.get('average_price', 0)
                        last_price = pos.get('last_price', 0)
                        instrument_token = pos.get('instrument_token', 0)
                        
                        # Determine position type (PE = short, CE = long)
                        if 'PE' in tradingsymbol:
                            self.position = -1  # Short position (PE)
                            option_type = 'PE'
                        elif 'CE' in tradingsymbol:
                            self.position = 1  # Long position (CE)
                            option_type = 'CE'
                        else:
                            continue  # Skip if not PE or CE
                        
                        # Restore entry price and trade state
                        if avg_price > 0:
                            self.entry_price = float(avg_price)
                        else:
                            self.entry_price = float(last_price) if last_price > 0 else 0
                        
                        # Restore option trade state
                        option_entry_price = self.entry_price
                        lot_size = abs(quantity)
                        
                        # Create a minimal option trade record for tracking
                        restored_option_trade = {
                            'signal_time': datetime.datetime.now().isoformat(),  # We don't have the original signal time
                            'signal_type': option_type,
                            'signal_high': 0,  # Will be updated when we get more data
                            'signal_low': 0,  # Will be updated when we get more data
                            'index_at_entry': 0,  # Will be updated
                            'option_symbol': tradingsymbol,
                            'entry_time': datetime.datetime.now().isoformat(),  # We don't have the original entry time
                            'option_entry_price': float(option_entry_price),
                            'stop_loss_price': 0,  # Will be calculated
                            'target_price': 0,  # Will be calculated
                            'lot_size': lot_size,
                            'exit_time': None,
                            'option_exit_price': None,
                            'exit_type': None,
                            'pnl': None,
                            'status': 'open'
                        }
                        self.active_option_trade = restored_option_trade
                        self.option_trade_history.append(restored_option_trade)
                        
                        self.trade_placed = True
                        self.status['position'] = self.position
                        self.status['entry_price'] = self.entry_price
                        self.status['traded_instrument'] = tradingsymbol
                        self.status['traded_instrument_token'] = instrument_token
                        self.status['state'] = 'position_open'
                        self.status['message'] = f'Restored existing position: {tradingsymbol} @ {self.entry_price:.2f}'
                        
                        # Calculate current P&L
                        if last_price > 0:
                            # For options, P&L calculation is different
                            # PE: Profit when option price goes up (we bought at entry_price, current is last_price)
                            # CE: Profit when option price goes up (we bought at entry_price, current is last_price)
                            option_pnl = (float(last_price) - float(option_entry_price)) * lot_size
                            self.status['pnl'] = option_pnl
                        
                        # Set stop loss and target levels (will be recalculated based on current market conditions)
                        # For now, set conservative defaults
                        if option_type == 'PE':
                            # PE stop loss is typically 17% below entry
                            self.status['stop_loss_level'] = float(option_entry_price) * 0.83
                            # PE target is typically 45% above entry
                            self.status['target_profit_level'] = float(option_entry_price) * 1.45
                        else:  # CE
                            # CE stop loss is typically 17% below entry
                            self.status['stop_loss_level'] = float(option_entry_price) * 0.83
                            # CE target is typically 45% above entry
                            self.status['target_profit_level'] = float(option_entry_price) * 1.45
                        
                        logging.warning(
                            f"Restored existing position for {self.instrument}: "
                            f"{tradingsymbol}, Quantity: {quantity}, Entry: {self.entry_price:.2f}, "
                            f"Current: {last_price:.2f}, Position: {option_type}, "
                            f"P&L: {self.status.get('pnl', 0):.2f}"
                        )
                        
                        # Mark that we have an active position so we don't enter a new trade
                        self._add_audit_trail(
                            'position_restored',
                            f'Restored existing position after restart: {tradingsymbol} @ {self.entry_price:.2f}',
                            {
                                'tradingsymbol': tradingsymbol,
                                'quantity': quantity,
                                'entry_price': self.entry_price,
                                'current_price': last_price,
                                'position': option_type,
                                'product': product,
                                'pnl': self.status.get('pnl', 0),
                                'instrument_token': instrument_token
                            }
                        )
                        return  # Found and restored position, exit
        
        except Exception as e:
            logging.error(f"Error checking for existing positions: {e}", exc_info=True)
            # Don't fail strategy initialization if position check fails
            # Just log the error and continue

    def run(self):
        logging.info(f"Running Capture Mountain Signal strategy for {self.instrument}")
        self.status['state'] = 'running'
        self.status['message'] = 'Strategy is running and waiting for ticks.'
        
        # Check for existing positions first (before initializing historical data)
        # This prevents entering a new trade when one is already active after server restart
        self._check_and_restore_existing_position()
        
        # Initialize historical data from market open if deployed during market hours
        self._initialize_historical_data_from_market_open()

    def process_ticks(self, ticks):
        if not ticks:
            return

        # Filter ticks to only process ticks for this strategy's instrument
        # The strategy monitors the index (BANKNIFTY or NIFTY), not options
        relevant_ticks = [tick for tick in ticks if tick.get('instrument_token') == self.instrument_token]
        
        if not relevant_ticks:
            # No ticks for this instrument, but this is normal if we're subscribed to multiple instruments
            return

        latest_tick = relevant_ticks[-1] # Assuming ticks are ordered by time
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
        
        # Update signal status to indicate we're receiving data
        if self.status.get('signal_status') == 'Waiting for market data':
            # Check if we have enough historical data to start evaluating
            if len(self.historical_data) >= self.ema_period:
                self.status['signal_status'] = 'Monitoring market for signals'
            else:
                self.status['signal_status'] = f'Building historical data ({len(self.historical_data)}/{self.ema_period} candles)'
        
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
                current_pnl = (self.exit_price - self.entry_price) * self.total_lot * self.option_lot_size * self.position
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
        
        # **SIGNAL EVALUATION TIMING: rule-driven seconds before candle close**
        # Calculate how many seconds we are from the candle end
        candle_duration_seconds = candle_interval_minutes * 60
        seconds_into_candle = (tick_datetime - current_candle_start_time).total_seconds()
        seconds_before_close = candle_duration_seconds - seconds_into_candle
        
        target_seconds = getattr(self, '_signal_evaluate_seconds', 20)
        buffer_seconds = getattr(self, '_signal_evaluate_buffer', 2)
        lower_bound = max(0, target_seconds - buffer_seconds)
        upper_bound = target_seconds + buffer_seconds

        # Check if we're at the evaluation time (20 seconds before candle close)
        is_evaluation_time = lower_bound <= seconds_before_close <= upper_bound

        # Update "Last Check" timestamp ONLY at evaluation time (20 seconds before candle close)
        # This ensures it shows the exact time when signal evaluation happens
        if is_evaluation_time:
            try:
                self.status['last_check'] = tick_datetime.strftime('%Y-%m-%d %H:%M:%S')
                self.status['last_execution_time'] = tick_datetime.isoformat()
            except Exception:
                pass

        # Evaluate signal AND run strategy logic ONLY at the evaluation time (20 seconds before candle close)
        # Example: For 12:15 candle (12:15:00 to 12:19:59), evaluation happens at 12:19:40 (20s before 12:20:00)
        if is_evaluation_time:
            candle_time_str = self.current_candle_data['date'].strftime('%H:%M') if self.current_candle_data and 'date' in self.current_candle_data else 'N/A'
            if not self.signal_evaluated_for_current_candle and len(self.historical_data) > self.ema_period:
                self._evaluate_signal_candle()
                self.signal_evaluated_for_current_candle = True
                logging.info(
                    f"[TIMING] Signal evaluation at {tick_datetime.strftime('%H:%M:%S')} "
                    f"for candle {candle_time_str} ({seconds_before_close:.1f}s before close; target {target_seconds}s ± {buffer_seconds}s)"
                )
            
            # Run strategy logic (entry/exit decisions) ONLY at evaluation time (20 seconds before candle close)
            # Entry decisions are made at this time, not continuously on every tick
            if len(self.historical_data) > self.ema_period:
                logging.debug(
                    f"[TIMING] Strategy logic (entry/exit) evaluation at {tick_datetime.strftime('%H:%M:%S')} "
                    f"for candle {candle_time_str} ({seconds_before_close:.1f}s before close)"
                )
                self._apply_strategy_logic()
        else:
            # Outside evaluation time: Only run exit logic if position is open (for stop loss/target monitoring)
            # But do NOT check entry conditions outside evaluation time
            if len(self.historical_data) > self.ema_period and self.trade_placed:
                # Only check exit conditions (SL/Target/Market Close) - not entry
                self._check_exit_conditions_only()

    def _check_exit_conditions_only(self):
        """
        Check only exit conditions (SL/Target/Market Close) without checking entry conditions.
        This is called outside the evaluation time window to continuously monitor exits.
        """
        if not self.trade_placed or self.position == 0:
            return
        
        df = pd.DataFrame(self.historical_data)
        if len(df) < 1:
            return
        
        current_candle = df.iloc[-1]
        current_ema = df['ema'].iloc[-1] if 'ema' in df.columns else None
        
        # Check for Market Close Square Off (15 minutes before market close at 3:30 PM)
        current_candle_date = current_candle['date']
        if isinstance(current_candle_date, datetime.datetime):
            current_time = current_candle_date.time()
        elif isinstance(current_candle_date, str):
            try:
                current_time = datetime.datetime.strptime(current_candle_date, '%Y-%m-%d %H:%M:%S').time()
            except ValueError:
                current_time = datetime.datetime.fromisoformat(current_candle_date).time()
        else:
            current_time = datetime.datetime.now().time()
        
        market_close_square_off_time = datetime.time(15, 15)  # 3:15 PM
        market_close_time = datetime.time(15, 30)  # 3:30 PM
        
        if market_close_square_off_time <= current_time < market_close_time:
            self.exit_price = current_candle['close']
            self._add_audit_trail('market_close_square_off', f"Market close square off at {self.exit_price:.2f} (15 min before close)", {
                'exit_price': self.exit_price,
                'entry_price': self.entry_price,
                'pnl': self.status.get('pnl', 0),
                'position': 'PE',
                'square_off_time': '15:15',
                'candle_time': str(current_candle_date)
            })
            self._close_trade('MKT_CLOSE', current_candle_date if isinstance(current_candle_date, datetime.datetime) else datetime.datetime.now())
            return
        
        # Check for Stop Loss (can happen anytime)
        if self.position == -1 and current_candle['close'] >= self.status.get('stop_loss_level', float('inf')):
            self.exit_price = current_candle['close']
            self._add_audit_trail('stop_loss', f"Stop Loss hit at {self.exit_price:.2f}", {
                'exit_price': self.exit_price,
                'entry_price': self.entry_price,
                'pnl': self.status.get('pnl', 0),
                'position': 'PE'
            })
            self._close_trade('SL', current_candle['date'] if isinstance(current_candle['date'], datetime.datetime) else datetime.datetime.now())
            return
        
        # Check for Target Profit (PE Logic) - only at evaluation time, but we can check the condition here
        # The actual exit will happen at the next evaluation time
        if self.position == -1 and self.pe_signal_candle is not None and current_ema is not None:
            if current_candle['high'] < current_ema:
                self.target_hit_candles += 1
            else:
                self.target_hit_candles = 0
            
            # Target exit will be checked at evaluation time in _apply_strategy_logic

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
        # Note: We evaluate the forming candle 20 seconds before close per rules
        # IMPORTANT: RSI must be STRICTLY > 70 (not >= 70) for PE signal
        # Following business rules: RULE "Identify PE Signal" and RULE "Reset PE Signal"
        
        candle_time_str = current_candle['date'].strftime('%H:%M') if 'date' in current_candle else 'N/A'
        evaluation_timestamp = datetime.datetime.now()
        
        logging.debug(f"[SIGNAL EVAL] Checking PE signal for candle {candle_time_str}: LOW={current_candle['low']:.2f}, EMA={current_ema:.2f}, RSI={current_rsi}")
        
        # Check conditions according to rules
        low_above_ema = current_candle['low'] > current_ema
        rsi_above_70 = current_rsi is not None and current_rsi > 70
        
        # Track this evaluation
        evaluation_record = {
            'timestamp': evaluation_timestamp.isoformat(),
            'candle_time': candle_time_str,
            'candle_start': current_candle['date'].isoformat() if 'date' in current_candle else None,
            'low': float(current_candle['low']),
            'high': float(current_candle['high']),
            'close': float(current_candle['close']),
            'ema': float(current_ema),
            'rsi': float(current_rsi) if current_rsi is not None else None,
            'low_above_ema': low_above_ema,
            'rsi_above_70': rsi_above_70,
            'result': None,  # 'identified', 'ignored', 'reset', 'cleared'
            'reason': None,
            'signal_type': 'PE'
        }
        
        if low_above_ema and rsi_above_70:
            # Signal condition MET - Check if this is a new signal or reset
            old_signal_time = None
            if self.pe_signal_candle is not None:
                old_signal_time = self.pe_signal_candle['date'].strftime('%H:%M') if 'date' in self.pe_signal_candle else 'N/A'
                # RULE "Reset PE Signal": If existing signal and new candle meets criteria, replace it
                evaluation_record['result'] = 'reset'
                evaluation_record['reason'] = f"PE Signal reset: Newer candle {candle_time_str} replaces previous signal at {old_signal_time}"
                logging.info(f"[SIGNAL EVAL] ✓ PE Signal RESET: Replacing signal from {old_signal_time} with new signal at {candle_time_str}")
                # Reset price action validation and entry tracking
                self.pe_signal_price_above_low = False
                # Clear entry tracking for old signal
                signal_candle_id = id(self.pe_signal_candle)
                if signal_candle_id in self.signal_candles_with_entry:
                    self.signal_candles_with_entry.remove(signal_candle_id)
            else:
                # RULE "Identify PE Signal": New signal identified
                evaluation_record['result'] = 'identified'
                evaluation_record['reason'] = f"PE Signal identified: LOW ({current_candle['low']:.2f}) > EMA ({current_ema:.2f}) AND RSI ({current_rsi:.2f}) > 70"
                logging.info(f"[SIGNAL EVAL] ✓ PE Signal IDENTIFIED: {candle_time_str} (H:{current_candle['high']:.2f}, L:{current_candle['low']:.2f})")
            
            # Set the signal candle
            self.pe_signal_candle = current_candle
            self.status['signal_status'] = f"PE Signal Candle Identified ({timing_label}): {candle_time_str} - Waiting for Trade Entry (H:{current_candle['high']:.2f}, L:{current_candle['low']:.2f})"
            self.status['signal_candle_time'] = candle_time_str + '-' + (current_candle['date'] + datetime.timedelta(minutes=int(self.candle_time))).strftime('%H:%M')
            self.status['signal_candle_high'] = float(current_candle['high'])
            self.status['signal_candle_low'] = float(current_candle['low'])
            self.ce_signal_candle = None  # Only one active signal type
            
            self._add_audit_trail('signal_identified', self.status['signal_status'], {
                'signal_type': 'PE',
                'candle_time': self.status['signal_candle_time'],
                'high': self.pe_signal_candle['high'],
                'low': self.pe_signal_candle['low'],
                'ema': current_ema,
                'rsi': current_rsi,
                'evaluation_timing': f'{int(timing_seconds)}_seconds_before_close',
                'old_signal_time': old_signal_time
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
            
        elif self.pe_signal_candle is not None:
            # RULE "Clear PE Signal": If signal exists but conditions no longer met, clear it
            if not low_above_ema or not rsi_above_70:
                evaluation_record['result'] = 'cleared'
                if not low_above_ema:
                    evaluation_record['reason'] = f"PE Signal cleared: LOW ({current_candle['low']:.2f}) <= EMA ({current_ema:.2f})"
                else:
                    evaluation_record['reason'] = f"PE Signal cleared: RSI ({current_rsi:.2f}) <= 70 (required > 70)"
                logging.info(f"[SIGNAL EVAL] ✗ PE Signal CLEARED: {evaluation_record['reason']}")
                self.pe_signal_candle = None
                self.status['signal_status'] = 'No active signal - Waiting for next signal'
                self.status['signal_candle_time'] = 'N/A'
                self.status['signal_candle_high'] = 0
                self.status['signal_candle_low'] = 0
        else:
            # No signal exists and conditions not met - log as ignored
            evaluation_record['result'] = 'ignored'
            if not low_above_ema:
                evaluation_record['reason'] = f"Signal ignored: LOW ({current_candle['low']:.2f}) <= EMA ({current_ema:.2f})"
            else:
                evaluation_record['reason'] = f"Signal ignored: RSI ({current_rsi:.2f}) <= 70 (required > 70)"
            logging.debug(f"[SIGNAL EVAL] ✗ {evaluation_record['reason']}")
        
        # Add evaluation record to history (keep last 500 evaluations)
        if 'signal_evaluations' not in self.status:
            self.status['signal_evaluations'] = []
        self.status['signal_evaluations'].append(evaluation_record)
        if len(self.status['signal_evaluations']) > 500:
            self.status['signal_evaluations'] = self.status['signal_evaluations'][-500:]

        # --- CE Signal Candle Identification: HIGH < 5 EMA AND RSI < 30 ---
        # NOTE: CE signals are IGNORED in live trading - only PE trades are allowed
        # CE signals are detected but not processed for trade entry
        if current_candle['high'] < current_ema:
            # RSI condition must be met at signal identification time
            if current_rsi is not None and current_rsi < 30:
                # CE signal detected but ignored - log as ignored signal
                ignore_reason = f"CE signal detected but ignored (LIVE TRADING: Only PE trades allowed). HIGH ({current_candle['high']:.2f}) < EMA ({current_ema:.2f}) AND RSI ({current_rsi:.2f}) < 30"
                self._add_audit_trail('signal_ignored', ignore_reason, {
                    'signal_type': 'CE',
                    'candle_time': current_candle['date'].strftime('%H:%M') if 'date' in current_candle else 'N/A',
                    'high': current_candle['high'],
                    'low': current_candle['low'],
                    'ema': current_ema,
                    'rsi': current_rsi,
                    'reason': 'CE signals disabled for live trading'
                })
                # Clear any existing CE signal candle
                if self.ce_signal_candle is not None:
                    self.ce_signal_candle = None
                    self.ce_signal_price_below_high = False
                logging.debug(ignore_reason)

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
            if len(self.historical_data) < self.ema_period:
                self.status['signal_status'] = f'Building historical data ({len(self.historical_data)}/{self.ema_period} candles needed)'
            else:
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
        
        # CE signal processing disabled for live trading - only PE trades allowed
        # if self.ce_signal_candle is not None and not self.trade_placed and not self.ce_signal_price_below_high:
        #     # Check if price (low) has traded below CE signal candle's high
        #     if current_candle['low'] < self.ce_signal_candle['high']:
        #         self.ce_signal_price_below_high = True
        #         logging.info(f"CE price action validation met: Price LOW ({current_candle['low']:.2f}) < Signal HIGH ({self.ce_signal_candle['high']:.2f})")

        # --- Trade Entry Logic ---
        if not self.trade_placed:
            # PE Entry: After exit, require price action validation
            if self.pe_signal_candle is not None:
                # Check if entry condition is met: current candle close < signal candle low
                entry_condition_met = current_candle['close'] < self.pe_signal_candle['low']
                
                if not entry_condition_met:
                    # Entry condition not met yet - waiting for price to break below signal low
                    # Following ENTRY "PE Breakout Entry" rule: TRIGGER when candle.close falls below signal.low
                    signal_time_str = self.pe_signal_candle['date'].strftime('%H:%M') if 'date' in self.pe_signal_candle else 'N/A'
                    self.status['signal_status'] = f"PE Signal Active ({signal_time_str}) - Waiting for Trade Entry: Close must break below {self.pe_signal_candle['low']:.2f} (Current: {current_candle['close']:.2f})"
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
                        trading_symbol, instrument_token = self._get_atm_option_symbol(current_candle['close'], 'PE')
                        if not trading_symbol or not instrument_token:
                            logging.error("Could not get trading symbol for PE trade")
                            return
                        proposed_entry_price = current_candle['close']
                        order_id, _, _ = self._place_order(proposed_entry_price, 'PE', 'BUY')
                        if order_id is None:
                            failure_msg = f"PE entry order failed at {proposed_entry_price:.2f}"
                            self.status['state'] = 'error'
                            self.status['entry_order_id'] = 'FAILED'
                            self.status['message'] = failure_msg
                            self._add_audit_trail(
                                'entry_failed',
                                failure_msg,
                                {
                                    'option_type': 'PE',
                                    'entry_price': proposed_entry_price,
                                    'signal_candle_high': self.pe_signal_candle['high'],
                                    'signal_candle_low': self.pe_signal_candle['low'],
                                    'reason': self.status.get('last_live_order_error'),
                                },
                            )
                            logging.error(failure_msg)
                            return

                        self.position = -1  # Short position (Buy PE)
                        self.entry_price = proposed_entry_price
                        self.trade_placed = True
                        self.status['state'] = 'position_open'
                        self.status['traded_instrument'] = trading_symbol
                        self.status['traded_instrument_token'] = instrument_token
                        self.status['stop_loss_level'] = self.pe_signal_candle['high']  # SL for PE is signal candle high
                        self.status['target_profit_level'] = np.nan  # Target calculated dynamically
                        
                        # Set exit conditions for display
                        self.status['exit_conditions'] = {
                            'option_stop_loss': {
                                'type': 'Option Stop Loss',
                                'condition': f'Option premium falls below {self.entry_price * 0.83:.2f} (17% below entry)',
                                'priority': 1,
                                'active': True
                            },
                            'option_target': {
                                'type': 'Option Target',
                                'condition': f'Option premium rises above {self.entry_price * 1.45:.2f} (45% above entry)',
                                'priority': 2,
                                'active': True
                            },
                            'index_stop_loss': {
                                'type': 'Index Stop Loss',
                                'condition': f'Index closes above {self.pe_signal_candle["high"]:.2f} (signal candle HIGH)',
                                'priority': 3,
                                'active': True
                            },
                            'index_target': {
                                'type': 'Index Target',
                                'condition': 'Index HIGH < 5 EMA for 1 candle, then 2 consecutive candles CLOSE > 5 EMA',
                                'priority': 4,
                                'active': True
                            },
                            'market_close': {
                                'type': 'Market Close',
                                'condition': 'Automatic square-off at 3:15 PM (15 minutes before market close)',
                                'priority': 5,
                                'active': True,
                                'time': '15:15'
                            }
                        }
                        signal_time = (
                            self.pe_signal_candle['date'].strftime('%Y-%m-%d %H:%M:%S')
                            if 'date' in self.pe_signal_candle
                            else datetime.datetime.now().isoformat()
                        )
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

            # CE Entry: DISABLED for live trading - only PE trades allowed
            # CE signals are ignored and no trades are entered
            elif False:  # Disabled: self.ce_signal_candle is not None:
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
                        trading_symbol, instrument_token = self._get_atm_option_symbol(current_candle['close'], 'CE')
                        if not trading_symbol or not instrument_token:
                            logging.error("Could not get trading symbol for CE trade")
                            return
                        proposed_entry_price = current_candle['close']
                        order_id, _, _ = self._place_order(proposed_entry_price, 'CE', 'BUY')
                        if order_id is None:
                            failure_msg = f"CE entry order failed at {proposed_entry_price:.2f}"
                            self.status['state'] = 'error'
                            self.status['entry_order_id'] = 'FAILED'
                            self.status['message'] = failure_msg
                            self._add_audit_trail(
                                'entry_failed',
                                failure_msg,
                                {
                                    'option_type': 'CE',
                                    'entry_price': proposed_entry_price,
                                    'signal_candle_high': self.ce_signal_candle['high'],
                                    'signal_candle_low': self.ce_signal_candle['low'],
                                    'reason': self.status.get('last_live_order_error'),
                                },
                            )
                            logging.error(failure_msg)
                            return

                        self.position = 1  # Long position (Buy CE)
                        self.entry_price = proposed_entry_price
                        self.trade_placed = True
                        self.status['state'] = 'position_open'
                        self.status['traded_instrument'] = trading_symbol
                        self.status['traded_instrument_token'] = instrument_token
                        self.status['stop_loss_level'] = self.ce_signal_candle['low']  # SL for CE is signal candle low
                        self.status['target_profit_level'] = np.nan  # Target calculated dynamically
                        
                        # Set exit conditions for display
                        self.status['exit_conditions'] = {
                            'option_stop_loss': {
                                'type': 'Option Stop Loss',
                                'condition': f'Option premium falls below {self.entry_price * 0.83:.2f} (17% below entry)',
                                'priority': 1,
                                'active': True
                            },
                            'option_target': {
                                'type': 'Option Target',
                                'condition': f'Option premium rises above {self.entry_price * 1.45:.2f} (45% above entry)',
                                'priority': 2,
                                'active': True
                            },
                            'index_stop_loss': {
                                'type': 'Index Stop Loss',
                                'condition': f'Index closes below {self.ce_signal_candle["low"]:.2f} (signal candle LOW)',
                                'priority': 3,
                                'active': True
                            },
                            'index_target': {
                                'type': 'Index Target',
                                'condition': 'Index LOW > 5 EMA for 1 candle, then 2 consecutive candles CLOSE < 5 EMA',
                                'priority': 4,
                                'active': True
                            },
                            'market_close': {
                                'type': 'Market Close',
                                'condition': 'Automatic square-off at 3:15 PM (15 minutes before market close)',
                                'priority': 5,
                                'active': True,
                                'time': '15:15'
                            }
                        }
                        signal_time = (
                            self.ce_signal_candle['date'].strftime('%Y-%m-%d %H:%M:%S')
                            if 'date' in self.ce_signal_candle
                            else datetime.datetime.now().isoformat()
                        )
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

        # --- Position Management (SL/Target) ---
        elif self.position != 0: # If a position is open
            current_pnl = (current_candle['close'] - self.entry_price) * self.total_lot * self.option_lot_size * self.position
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
            # NOTE: This should never execute in live trading since CE trades are disabled
            # Only PE trades (position == -1) are allowed
            elif self.position == 1 and self.ce_signal_candle is not None: # Long position (CE) - DISABLED
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
        """
        Close the current trade position.
        For live trades, checks actual position from Zerodha and uses exact quantity to avoid margin issues.
        """
        if self.paper_trade or not self._live_kite_client:
            # Paper trade or no live client - use standard method
            order_id, _, _ = self._place_order(self.exit_price, 'PE' if self.position == -1 else 'CE', 'SELL')
            if order_id is None:
                failure_msg = f"Exit order failed at {self.exit_price:.2f}. Manual intervention required."
                self.status['state'] = 'error'
                self.status['message'] = failure_msg
                self._add_audit_trail('exit_failed', failure_msg, {
                    'exit_type': exit_type,
                    'exit_price': self.exit_price,
                    'entry_price': self.entry_price,
                    'position': 'PE' if self.position == -1 else 'CE',
                    'reason': self.status.get('last_live_order_error'),
                })
                logging.error(failure_msg)
                return
        else:
            # Live trade - check actual position and use exact quantity
            try:
                positions = self._live_kite_client.positions()
                net_positions = positions.get('net', []) if isinstance(positions, dict) else []
                
                # Find our position
                traded_symbol = self.status.get('traded_instrument', '').upper()
                actual_position = None
                for pos in net_positions:
                    if str(pos.get('tradingsymbol', '')).upper() == traded_symbol:
                        qty = pos.get('quantity', 0)
                        if qty != 0:
                            actual_position = pos
                            break
                
                if actual_position:
                    # Use actual position details
                    exit_qty = abs(int(actual_position.get('quantity', 0)))
                    tradingsymbol = actual_position.get('tradingsymbol')
                    exchange = actual_position.get('exchange') or 'NFO'
                    product = actual_position.get('product') or self._live_kite_client.PRODUCT_MIS
                    
                    # Determine transaction type to close position
                    # If quantity > 0, we need to SELL to close
                    # If quantity < 0, we need to BUY to close
                    qty = actual_position.get('quantity', 0)
                    if qty > 0:
                        transaction_type = self._live_kite_client.TRANSACTION_TYPE_SELL
                    else:
                        transaction_type = self._live_kite_client.TRANSACTION_TYPE_BUY
                    
                    # Convert product string to constant if needed
                    if isinstance(product, str):
                        if product.upper() == 'MIS':
                            product_constant = self._live_kite_client.PRODUCT_MIS
                        elif product.upper() == 'NRML':
                            product_constant = self._live_kite_client.PRODUCT_NRML
                        else:
                            product_constant = product
                    else:
                        product_constant = product
                    
                    # Place order to close position
                    order_id = self._live_kite_client.place_order(
                        variety=self._live_kite_client.VARIETY_REGULAR,
                        exchange=exchange,
                        tradingsymbol=tradingsymbol,
                        transaction_type=transaction_type,
                        quantity=exit_qty,
                        product=product_constant,
                        order_type=self._live_kite_client.ORDER_TYPE_MARKET,
                        validity=self._live_kite_client.VALIDITY_DAY,
                        tag=self.live_order_context.get('tag', f"AIML-LIVE-{self.live_order_context.get('deployment_id', 'EXIT')}")
                    )
                    logging.info(
                        f"[LIVE TRADE] Exit order {order_id} placed: {transaction_type} {tradingsymbol} qty={exit_qty} "
                        f"(closing position, exit_type={exit_type})"
                    )
                    self.status['last_live_order_error'] = None
                else:
                    # Position not found in Zerodha - might already be closed
                    logging.warning(f"Position {traded_symbol} not found in Zerodha. May already be closed.")
                    # Try standard method as fallback
                    order_id, _, _ = self._place_order(self.exit_price, 'PE' if self.position == -1 else 'CE', 'SELL')
                    if order_id is None:
                        failure_msg = f"Exit order failed: Position {traded_symbol} not found and fallback order failed."
                        self.status['state'] = 'error'
                        self.status['message'] = failure_msg
                        self._add_audit_trail('exit_failed', failure_msg, {
                            'exit_type': exit_type,
                            'exit_price': self.exit_price,
                            'entry_price': self.entry_price,
                            'position': 'PE' if self.position == -1 else 'CE',
                            'reason': 'Position not found in Zerodha',
                        })
                        logging.error(failure_msg)
                        return
            except Exception as exc:
                logging.error(f"Error closing trade using actual position: {exc}", exc_info=True)
                # Fallback to standard method
                order_id, _, _ = self._place_order(self.exit_price, 'PE' if self.position == -1 else 'CE', 'SELL')
                if order_id is None:
                    failure_msg = f"Exit order failed at {self.exit_price:.2f}. Error: {str(exc)}"
                    self.status['state'] = 'error'
                    self.status['message'] = failure_msg
                    self._add_audit_trail('exit_failed', failure_msg, {
                        'exit_type': exit_type,
                        'exit_price': self.exit_price,
                        'entry_price': self.entry_price,
                        'position': 'PE' if self.position == -1 else 'CE',
                        'reason': str(exc),
                    })
                    logging.error(failure_msg)
                    return

        self.status['state'] = 'position_closed'
        exit_type_display = 'Market Close' if exit_type == 'MKT_CLOSE' else exit_type
        self.status['message'] = f"Position closed by {exit_type_display} at {self.exit_price:.2f}. P&L: {self.status['pnl']:.2f}"
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

