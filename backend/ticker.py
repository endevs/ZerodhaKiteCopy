
from kiteconnect import KiteTicker
import logging
import datetime
from database import get_db_connection
from utils import get_option_symbols

class Ticker:
    def __init__(self, api_key, access_token, running_strategies, socketio, kite):
        self.kws = KiteTicker(api_key, access_token)
        self.running_strategies = running_strategies
        self.socketio = socketio
        self.kite = kite
        self.kws.on_ticks = self.on_ticks
        self.kws.on_connect = self.on_connect
        self.kws.on_close = self.on_close
        self.db_connection = get_db_connection() # Initialize DB connection here

    def on_ticks(self, ws, ticks):
        try:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                for tick in ticks:
                    instrument_token = tick['instrument_token']
                    status_row = cursor.execute('SELECT status FROM tick_data_status WHERE instrument_token = ?', (instrument_token,)).fetchone()
                    status = status_row[0] if status_row else 'Stopped'

                    if status == 'Running':
                        timestamp = None
                        if 'timestamp' in tick:
                            timestamp = tick['timestamp']
                        elif 'last_trade_time' in tick:
                            timestamp = tick['last_trade_time']
                        elif 'exchange_timestamp' in tick:
                            timestamp = tick['exchange_timestamp']
                        
                        if timestamp:
                            if isinstance(timestamp, datetime.datetime):
                                timestamp_str = timestamp.strftime('%Y-%m-%d %H:%M:%S')
                            else:
                                timestamp_str = datetime.datetime.fromtimestamp(timestamp).strftime('%Y-%m-%d %H:%M:%S')
                            
                            cursor.execute(
                                "INSERT INTO tick_data (instrument_token, timestamp, last_price, volume) VALUES (?, ?, ?, ?)",
                                (tick['instrument_token'], timestamp_str, tick['last_price'], tick.get('volume', 0))
                            )
                        else:
                            logging.warning(f"Skipping tick because it has no timestamp: {tick}")
                conn.commit()
        except Exception as e:
            logging.error(f"Error storing tick data for replay: {e}")

        conn = get_db_connection()
        cursor = conn.cursor()
        for tick in ticks:
            # Store tick data in the database
            instrument_token = tick['instrument_token']
            last_price = tick['last_price']
            volume = tick.get('volume', 0)  # Volume might not be present for all tick types
            
            timestamp = None
            if 'timestamp' in tick:
                timestamp = tick['timestamp']
            elif 'last_trade_time' in tick:
                timestamp = tick['last_trade_time']
            elif 'exchange_timestamp' in tick:
                timestamp = tick['exchange_timestamp']

            if timestamp:
                if isinstance(timestamp, datetime.datetime):
                    timestamp = timestamp.strftime('%Y-%m-%d %H:%M:%S')
                else:
                    timestamp = datetime.datetime.fromtimestamp(timestamp).strftime('%Y-%m-%d %H:%M:%S')
            else:
                logging.warning(f"Skipping tick because it has no timestamp: {tick}")
                continue

            # Determine trading_symbol and instrument_type based on instrument_token
            trading_symbol = ""
            instrument_type = ""
            if instrument_token == 256265: # NIFTY 50
                trading_symbol = "NIFTY 50"
                instrument_type = "INDEX"
            elif instrument_token == 260105: # NIFTY BANK
                trading_symbol = "BANKNIFTY"
                instrument_type = "INDEX"
            # Add more conditions for other instruments as needed

            if trading_symbol and instrument_type:
                try:
                    cursor.execute(
                        "INSERT INTO market_data (instrument_token, trading_symbol, timestamp, last_price, volume, instrument_type) VALUES (?, ?, ?, ?, ?, ?)",
                        (instrument_token, trading_symbol, timestamp, last_price, volume, instrument_type)
                    )
                    conn.commit()
                except Exception as e:
                    logging.error(f"Error storing tick data: {e}")
                    conn.rollback()

        conn.close()

        # Process ticks for strategies and emit updates (iterate over a snapshot to avoid runtime errors
        # if the dict is modified concurrently by pause/square-off actions)
        for unique_run_id, strategy_info in list(self.running_strategies.items()):
            strategy_obj = strategy_info['strategy']
            db_id = strategy_info.get('db_id')
            user_id = strategy_info.get('user_id', 0)
            
            # Process ticks for this strategy with error handling
            try:
                strategy_obj.process_ticks(ticks)
            except Exception as e:
                logging.error(f"Error processing ticks for strategy {db_id} ({strategy_info.get('name', 'unknown')}): {e}", exc_info=True)
                # Don't stop other strategies if one fails
            
            # Emit strategy update to subscribed clients
            if db_id and user_id:
                try:
                    room_name = f"strategy_{user_id}_{db_id}"
                    strategy_status = strategy_obj.status if hasattr(strategy_obj, 'status') else {}
                    
                    # Prepare comprehensive metrics including all strategy details
                    metrics = {
                        'currentPrice': strategy_status.get('current_price', strategy_status.get('current_ltp', 0)),
                        'entryPrice': strategy_status.get('entry_price', 0),
                        'currentPnL': strategy_status.get('pnl', 0),
                        'unrealizedPnL': strategy_status.get('pnl', 0),
                        'realizedPnL': strategy_status.get('realized_pnl', 0),
                        'quantity': strategy_status.get('quantity', 0),
                        'status': strategy_status.get('state', 'running'),
                        'instrument': strategy_info.get('instrument', ''),
                        'strategyName': strategy_info.get('name', ''),
                        'option_prices': strategy_status.get('option_prices', {}),
                        'option_symbols': strategy_status.get('option_symbols', {}),
                        'traded_instrument': strategy_status.get('traded_instrument', ''),
                        'traded_instrument_token': strategy_status.get('traded_instrument_token'),
                        'audit_trail': strategy_status.get('audit_trail', [])[-50:],  # Last 50 entries
                        # Mountain signal specific
                        'signal_status': strategy_status.get('signal_status', ''),
                        'signal_candle_time': strategy_status.get('signal_candle_time', 'N/A'),
                        'signal_candle_high': strategy_status.get('signal_candle_high', 0),
                        'signal_candle_low': strategy_status.get('signal_candle_low', 0),
                        'entry_order_id': strategy_status.get('entry_order_id', 'N/A'),
                        'sl_order_id': strategy_status.get('sl_order_id', 'N/A'),
                        'tp_order_id': strategy_status.get('tp_order_id', 'N/A'),
                        'stop_loss_level': strategy_status.get('stop_loss_level', 0),
                        'target_profit_level': strategy_status.get('target_profit_level', 0),
                        'paper_trade_mode': strategy_status.get('paper_trade_mode', False),
                        'position': strategy_status.get('position', 0),
                        'message': strategy_status.get('message', ''),
                        # Prefer aligned execution time from strategy if available
                        'last_execution_time': strategy_status.get('last_execution_time', datetime.datetime.now().isoformat())
                    }
                    
                    # Get historical candles if available (for charting)
                    historical_candles = []
                    if hasattr(strategy_obj, 'historical_data'):
                        candles = getattr(strategy_obj, 'historical_data', [])
                        for candle in candles[-50:]:  # Last 50 candles
                            try:
                                candle_date = candle.get('date') if isinstance(candle, dict) else getattr(candle, 'date', None)
                                if candle_date:
                                    # Handle pandas Timestamp
                                    if hasattr(candle_date, 'to_pydatetime'):
                                        date_str = candle_date.to_pydatetime().isoformat()
                                    elif hasattr(candle_date, 'isoformat'):
                                        date_str = candle_date.isoformat()
                                    elif isinstance(candle_date, datetime.datetime):
                                        date_str = candle_date.isoformat()
                                    else:
                                        date_str = str(candle_date)
                                else:
                                    date_str = datetime.datetime.now().isoformat()
                                
                                historical_candles.append({
                                    'time': date_str,
                                    'open': float(candle.get('open') if isinstance(candle, dict) else getattr(candle, 'open', 0)),
                                    'high': float(candle.get('high') if isinstance(candle, dict) else getattr(candle, 'high', 0)),
                                    'low': float(candle.get('low') if isinstance(candle, dict) else getattr(candle, 'low', 0)),
                                    'close': float(candle.get('close') if isinstance(candle, dict) else getattr(candle, 'close', 0)),
                                    'volume': float(candle.get('volume', 0) if isinstance(candle, dict) else getattr(candle, 'volume', 0))
                                })
                            except Exception as e:
                                logging.debug(f"Error processing candle data: {e}")
                                continue
                    
                    # Calculate 5 EMA if we have candles
                    if len(historical_candles) > 0 and hasattr(strategy_obj, 'ema_period'):
                        ema_period = getattr(strategy_obj, 'ema_period', 5)
                        if len(historical_candles) >= ema_period:
                            # Calculate EMA for last candles
                            closes = [c['close'] for c in historical_candles]
                            # Simple EMA calculation
                            multiplier = 2 / (ema_period + 1)
                            ema_values = []
                            ema = closes[0]
                            for close in closes:
                                ema = (close - ema) * multiplier + ema
                                ema_values.append(ema)
                            
                            # Add EMA to last candle
                            if len(ema_values) > 0:
                                for i, candle in enumerate(historical_candles):
                                    if i < len(ema_values):
                                        candle['ema5'] = ema_values[i]
                    
                    # Get signal candle info for CE/PE break lines
                    signal_candle_high = strategy_status.get('signal_candle_high', 0)
                    signal_candle_low = strategy_status.get('signal_candle_low', 0)
                    position = strategy_status.get('position', 0)
                    
                    # Determine break levels
                    pe_break_level = None
                    ce_break_level = None
                    if position == -1 and signal_candle_low > 0:  # PE position
                        pe_break_level = signal_candle_low
                    elif position == 1 and signal_candle_high > 0:  # CE position
                        ce_break_level = signal_candle_high
                    
                    # Sanitize signal_history_today to ensure JSON serializable
                    signal_history = []
                    for sig in strategy_status.get('signal_history_today', []):
                        try:
                            sanitized_sig = {}
                            for key, value in sig.items():
                                # Convert pandas Timestamp to string
                                if hasattr(value, 'to_pydatetime'):
                                    sanitized_sig[key] = value.to_pydatetime().isoformat()
                                elif hasattr(value, 'isoformat'):
                                    sanitized_sig[key] = value.isoformat()
                                elif isinstance(value, datetime.datetime):
                                    sanitized_sig[key] = value.isoformat()
                                else:
                                    sanitized_sig[key] = value
                            signal_history.append(sanitized_sig)
                        except Exception as e:
                            logging.debug(f"Error sanitizing signal history entry: {e}")
                            continue
                    
                    # Emit to strategy room
                    self.socketio.emit('strategy_update', {
                        'strategy_id': str(db_id),
                        'metrics': metrics,
                        'historical_candles': historical_candles,
                        'signal_candle_high': float(signal_candle_high) if signal_candle_high else None,
                        'signal_candle_low': float(signal_candle_low) if signal_candle_low else None,
                        'pe_break_level': float(pe_break_level) if pe_break_level else None,
                        'ce_break_level': float(ce_break_level) if ce_break_level else None,
                        'signal_history_today': signal_history,
                        'log': {
                            'timestamp': datetime.datetime.now().isoformat(),
                            'action': strategy_status.get('message', 'Processing'),
                            'price': float(metrics['currentPrice']) if metrics.get('currentPrice') else 0,
                            'quantity': int(metrics['quantity']) if metrics.get('quantity') else 0,
                            'pnl': float(metrics['currentPnL']) if metrics.get('currentPnL') else 0,
                            'status': 'active'
                        }
                    }, room=room_name)
                    
                    # Emit paper trade specific updates if this is a paper trade strategy
                    if strategy_info.get('paper_trade'):
                        try:
                            # Prepare audit log for paper trade
                            latest_audit = strategy_status.get('audit_trail', [])
                            audit_log = None
                            if latest_audit:
                                latest_entry = latest_audit[-1]
                                audit_log = {
                                    'id': len(latest_audit),
                                    'timestamp': latest_entry.get('timestamp', datetime.datetime.now().isoformat()),
                                    'type': latest_entry.get('type', 'info'),
                                    'message': latest_entry.get('message', ''),
                                    'details': latest_entry.get('data', {})
                                }
                            
                            # Prepare chart data (today's candles only)
                            today = datetime.datetime.now().date()
                            today_candles = []
                            today_ema = []
                            today_rsi = []
                            
                            for candle in historical_candles[-100:]:  # Last 100 candles
                                try:
                                    candle_time = datetime.datetime.fromisoformat(candle['time']) if isinstance(candle['time'], str) else candle['time']
                                    if isinstance(candle_time, datetime.datetime) and candle_time.date() == today:
                                        today_candles.append({
                                            'x': candle['time'],
                                            'o': candle['open'],
                                            'h': candle['high'],
                                            'l': candle['low'],
                                            'c': candle['close']
                                        })
                                        if 'ema5' in candle:
                                            today_ema.append({'x': candle['time'], 'y': candle['ema5']})
                                        # RSI calculation would need to be added if not already in strategy
                                except Exception as e:
                                    logging.debug(f"Error processing candle for paper trade: {e}")
                                    continue
                            
                            # Prepare trade event if a trade was just placed or closed
                            trade_event = None
                            if strategy_status.get('trade_placed') and not strategy_status.get('last_trade_event_emitted'):
                                # New trade entry
                                trade_event = {
                                    'signalTime': strategy_status.get('signal_candle_time', ''),
                                    'signalType': 'PE' if strategy_status.get('position') == -1 else 'CE',
                                    'signalHigh': strategy_status.get('signal_candle_high', 0),
                                    'signalLow': strategy_status.get('signal_candle_low', 0),
                                    'entryTime': datetime.datetime.now().isoformat(),
                                    'entryPrice': strategy_status.get('entry_price', 0),
                                    'optionSymbol': strategy_status.get('traded_instrument', ''),
                                    'optionPrice': strategy_status.get('option_prices', {}).get('atm_pe' if strategy_status.get('position') == -1 else 'atm_ce', 0),
                                    'exitTime': None,
                                    'exitPrice': None,
                                    'exitType': None,
                                    'pnl': None,
                                    'pnlPercent': None
                                }
                                strategy_status['last_trade_event_emitted'] = True
                            elif not strategy_status.get('trade_placed') and strategy_status.get('last_trade_event_emitted'):
                                # Trade was closed
                                trade_event = {
                                    'exitTime': datetime.datetime.now().isoformat(),
                                    'exitPrice': strategy_status.get('exit_price', 0),
                                    'exitType': strategy_status.get('exit_type', ''),
                                    'pnl': strategy_status.get('pnl', 0),
                                    'pnlPercent': strategy_status.get('pnl_percent', 0)
                                }
                                strategy_status['last_trade_event_emitted'] = False
                            
                            # Emit paper trade update (only if there's new data)
                            if audit_log or len(today_candles) > 0 or trade_event:
                                self.socketio.emit('paper_trade_update', {
                                    'status': strategy_status.get('message', 'Running'),
                                    'auditLog': audit_log,
                                    'chartData': {
                                        'candles': today_candles,
                                        'ema5': today_ema,
                                        'rsi14': today_rsi
                                    },
                                    'tradeEvent': trade_event
                                }, room=f'paper_trade_{db_id}')
                        except Exception as e:
                            logging.error(f"Error emitting paper trade update for strategy {db_id}: {e}", exc_info=True)
                    
                except Exception as e:
                    logging.error(f"Error emitting strategy update for strategy {db_id}: {e}", exc_info=True)
        
        # Broadcast ticks to the frontend
        try:
            for tick in ticks:
                instrument_token = tick.get('instrument_token')
                last_price = tick.get('last_price')
                
                if not instrument_token or last_price is None:
                    continue
                
                # Emit market data to all connected clients
                # Flask-SocketIO emits to all clients by default when called from server side
                try:
                    # Combine both formats in one emit for efficiency
                    if instrument_token == 256265: # NIFTY 50
                        market_data = {
                            'nifty_price': str(last_price),
                            'instrument_token': instrument_token,
                            'last_price': last_price,
                            'timestamp': datetime.datetime.now().isoformat(),
                            'volume': tick.get('volume', 0)
                        }
                        self.socketio.emit('market_data', market_data, namespace='/')
                        # Log periodically to avoid spam (every 100 ticks or ~10 seconds)
                        if hasattr(self, '_nifty_tick_count'):
                            self._nifty_tick_count += 1
                        else:
                            self._nifty_tick_count = 1
                        if self._nifty_tick_count % 100 == 0:
                            logging.debug(f"Emitted NIFTY market_data: {last_price}")
                    elif instrument_token == 260105: # NIFTY BANK
                        market_data = {
                            'banknifty_price': str(last_price),
                            'instrument_token': instrument_token,
                            'last_price': last_price,
                            'timestamp': datetime.datetime.now().isoformat(),
                            'volume': tick.get('volume', 0)
                        }
                        self.socketio.emit('market_data', market_data, namespace='/')
                        # Log periodically to avoid spam
                        if hasattr(self, '_banknifty_tick_count'):
                            self._banknifty_tick_count += 1
                        else:
                            self._banknifty_tick_count = 1
                        if self._banknifty_tick_count % 100 == 0:
                            logging.debug(f"Emitted BANKNIFTY market_data: {last_price}")
                    else:
                        # For other instruments, emit generic format
                        self.socketio.emit('market_data', {
                            'instrument_token': instrument_token,
                            'last_price': last_price,
                            'timestamp': datetime.datetime.now().isoformat(),
                            'volume': tick.get('volume', 0)
                        }, namespace='/')
                except Exception as e:
                    logging.error(f"Error emitting market_data for instrument {instrument_token}: {e}", exc_info=True)
        except Exception as e:
            logging.error(f"Error broadcasting ticks to frontend: {e}", exc_info=True)

    def on_connect(self, ws, response):
        logging.info("Kite Ticker connected")
        instrument_tokens = [256265, 260105] # NIFTY 50 and NIFTY BANK

        # Get NIFTY weekly options (with error handling)
        try:
            nifty_weekly_options = get_option_symbols(self.kite, 'NIFTY', 'weekly', 10)
            if nifty_weekly_options:
                instrument_tokens.extend(nifty_weekly_options)
        except Exception as e:
            logging.warning(f"Error fetching NIFTY weekly options: {e}")

        # Get NIFTY next weekly options (with error handling)
        try:
            nifty_next_weekly_options = get_option_symbols(self.kite, 'NIFTY', 'next_weekly', 10)
            if nifty_next_weekly_options:
                instrument_tokens.extend(nifty_next_weekly_options)
        except Exception as e:
            logging.warning(f"Error fetching NIFTY next weekly options: {e}")

        # Get BANKNIFTY monthly options (with error handling)
        try:
            banknifty_monthly_options = get_option_symbols(self.kite, 'BANKNIFTY', 'monthly', 10)
            if banknifty_monthly_options:
                instrument_tokens.extend(banknifty_monthly_options)
        except Exception as e:
            logging.warning(f"Error fetching BANKNIFTY monthly options: {e}")

        for strategy_info in self.running_strategies.values():
            instrument_tokens.append(strategy_info['strategy'].instrument_token)
        
        # Remove duplicates
        instrument_tokens = list(set(instrument_tokens))

        ws.subscribe(instrument_tokens)
        ws.set_mode(ws.MODE_FULL, instrument_tokens)

        # Populate the tick_data_status table
        try:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                for token in instrument_tokens:
                    cursor.execute("INSERT OR IGNORE INTO tick_data_status (instrument_token, status) VALUES (?, ?)", (token, 'Running'))
                conn.commit()
        except Exception as e:
            logging.error(f"Error populating tick_data_status table: {e}")

    def on_close(self, ws, code, reason):
        logging.info(f"Kite Ticker connection closed: {code} - {reason}")

    def start(self):
        try:
            logging.info("Starting Kite Ticker...")
            self.kws.connect(threaded=True)
            logging.info("Kite Ticker start() called successfully")
        except Exception as e:
            logging.error(f"Error starting Kite Ticker: {e}", exc_info=True)
            raise
