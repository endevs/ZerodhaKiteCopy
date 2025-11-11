"""
Market Replay Manager with pause/resume/speed controls
"""
import threading
import time
import logging
import datetime
from flask_socketio import SocketIO

class MarketReplayManager:
    def __init__(self, socketio: SocketIO):
        self.socketio = socketio
        self.active_replays = {}  # {session_id: replay_thread_info}
        self.lock = threading.Lock()
    
    def start_replay(self, session_id, user_id, strategy_data, historical_candles, instrument_token, instrument_display, speed=1.0):
        """Start a market replay in a separate thread"""
        with self.lock:
            if session_id in self.active_replays:
                return {'status': 'error', 'message': 'Replay already running for this session'}
            
            replay_info = {
                'thread': None,
                'speed': speed,
                'paused': False,
                'stop_requested': False,
                'current_index': 0,
                'total_candles': len(historical_candles),
                'historical_candles': historical_candles,
                'strategy_data': strategy_data,
                'user_id': user_id,
                'instrument_token': instrument_token,
                'instrument_display': instrument_display,
                'pnl': 0,
                'trades': 0,
                'strategy': None,
                'index_data': [],  # Store index price data for top chart
                'strategy_data_points': [],  # Store strategy execution data for bottom chart
                'audit_trail': [],  # Store all strategy events
            }
            
            thread = threading.Thread(
                target=self._run_replay,
                args=(session_id, replay_info),
                daemon=True
            )
            replay_info['thread'] = thread
            self.active_replays[session_id] = replay_info
            thread.start()
            
            return {'status': 'success', 'message': 'Replay started'}
    
    def pause_replay(self, session_id):
        """Pause a running replay"""
        with self.lock:
            if session_id in self.active_replays:
                self.active_replays[session_id]['paused'] = True
                self.socketio.emit('replay_update', {
                    'status': 'paused',
                    'message': 'Replay paused'
                }, room=session_id)
                return True
            return False
    
    def resume_replay(self, session_id, speed=None):
        """Resume a paused replay"""
        with self.lock:
            if session_id in self.active_replays:
                replay_info = self.active_replays[session_id]
                replay_info['paused'] = False
                if speed is not None:
                    replay_info['speed'] = speed
                self.socketio.emit('replay_update', {
                    'status': 'running',
                    'message': 'Replay resumed'
                }, room=session_id)
                return True
            return False
    
    def stop_replay(self, session_id):
        """Stop a running replay"""
        with self.lock:
            if session_id in self.active_replays:
                self.active_replays[session_id]['stop_requested'] = True
                return True
            return False
    
    def change_speed(self, session_id, speed):
        """Change replay speed"""
        with self.lock:
            if session_id in self.active_replays:
                self.active_replays[session_id]['speed'] = speed
                return True
            return False
    
    def _run_replay(self, session_id, replay_info):
        """Run the replay in a separate thread"""
        try:
            from strategies.orb import ORB
            from strategies.capture_mountain_signal import CaptureMountainSignal
            
            strategy_data = replay_info['strategy_data']
            historical_candles = replay_info['historical_candles']
            speed = replay_info['speed']
            
            # Initialize strategy
            strategy_type = strategy_data['strategy_type']
            if strategy_type == 'orb':
                strategy_class = ORB
            elif strategy_type == 'capture_mountain_signal':
                strategy_class = CaptureMountainSignal
            else:
                self.socketio.emit('replay_error', {
                    'message': f'Unknown strategy type: {strategy_type}'
                }, room=session_id)
                return
            
            strategy = strategy_class(
                None,  # No kite object for replay
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
                paper_trade=True  # Always paper trade in replay
            )
            
            replay_info['strategy'] = strategy
            
            total_candles = len(historical_candles)
            base_delay = 0.1  # Base delay of 0.1 seconds per candle (can be adjusted)
            
            # Initialize tracking variables
            cumulative_pnl = 0
            total_trades = 0
            entry_price = None
            position = 0  # 0 = no position, 1 = long, -1 = short
            
            # Process each historical candle
            for i, candle in enumerate(historical_candles):
                # Check for stop request
                if replay_info['stop_requested']:
                    self.socketio.emit('replay_complete', {
                        'pnl': cumulative_pnl,
                        'trades': total_trades,
                        'stopped': True,
                        'audit_trail': replay_info['audit_trail'][-100:],  # Last 100 entries
                        'index_data': replay_info['index_data'],
                        'strategy_data_points': replay_info['strategy_data_points']
                    }, room=session_id)
                    break
                
                # Handle pause
                while replay_info['paused'] and not replay_info['stop_requested']:
                    time.sleep(0.1)
                
                if replay_info['stop_requested']:
                    break
                
                # Extract candle data
                candle_date = candle.get('date')
                if isinstance(candle_date, str):
                    try:
                        candle_date = datetime.datetime.fromisoformat(candle_date)
                    except:
                        candle_date = datetime.datetime.strptime(candle_date, '%Y-%m-%d %H:%M:%S')
                
                open_price = candle.get('open', 0)
                high_price = candle.get('high', 0)
                low_price = candle.get('low', 0)
                close_price = candle.get('close', 0)
                volume = candle.get('volume', 0)
                
                # Create tick-like data from candle for strategy processing
                # Simulate ticks for the candle (using open, high, low, close)
                tick_data = {
                    'instrument_token': replay_info['instrument_token'],
                    'last_price': close_price,
                    'timestamp': candle_date,
                    'volume': volume
                }
                
                # Process candle through strategy
                try:
                    if hasattr(strategy, 'process_ticks'):
                        strategy.process_ticks([tick_data])
                    elif hasattr(strategy, 'on_tick'):
                        strategy.on_tick(tick_data)
                    
                    # Get current strategy status
                    strategy_status = getattr(strategy, 'status', {})
                    current_pnl = strategy_status.get('pnl', 0)
                    current_position = strategy_status.get('position', 0)
                    
                    # Track position changes and trades
                    if current_position != position:
                        if position == 0 and current_position != 0:
                            # Entry
                            entry_price = close_price
                            total_trades += 1
                            replay_info['audit_trail'].append({
                                'timestamp': candle_date.isoformat(),
                                'event_type': 'entry',
                                'message': f'{strategy_type.upper()} Entry at {close_price:.2f}',
                                'price': close_price,
                                'position': current_position
                            })
                        elif position != 0 and current_position == 0:
                            # Exit
                            exit_pnl = current_pnl - cumulative_pnl
                            cumulative_pnl = current_pnl
                            replay_info['audit_trail'].append({
                                'timestamp': candle_date.isoformat(),
                                'event_type': 'exit',
                                'message': f'{strategy_type.upper()} Exit at {close_price:.2f}, P&L: {exit_pnl:.2f}',
                                'price': close_price,
                                'pnl': exit_pnl
                            })
                        position = current_position
                    
                    cumulative_pnl = current_pnl
                    replay_info['pnl'] = cumulative_pnl
                    replay_info['trades'] = total_trades
                    
                except Exception as e:
                    logging.error(f"Error processing candle in replay: {e}", exc_info=True)
                
                # Store index data for top chart
                replay_info['index_data'].append({
                    'time': candle_date.isoformat(),
                    'open': open_price,
                    'high': high_price,
                    'low': low_price,
                    'close': close_price,
                    'volume': volume
                })
                
                # Store strategy execution data for bottom chart
                strategy_data_point = {
                    'time': candle_date.isoformat(),
                    'price': close_price,
                    'pnl': cumulative_pnl,
                    'position': position,
                    'entry_price': entry_price
                }
                
                # Add EMA if available
                if hasattr(strategy, 'historical_data') and strategy.historical_data:
                    last_candle_idx = len(strategy.historical_data) - 1
                    if last_candle_idx >= 0:
                        last_hist = strategy.historical_data[last_candle_idx]
                        if hasattr(last_hist, 'ema') or (isinstance(last_hist, dict) and 'ema' in last_hist):
                            strategy_data_point['ema'] = last_hist.get('ema') if isinstance(last_hist, dict) else getattr(last_hist, 'ema', None)
                
                replay_info['strategy_data_points'].append(strategy_data_point)
                
                # Update progress
                progress = ((i + 1) / total_candles) * 100
                replay_info['current_index'] = i + 1
                
                # Get audit trail from strategy if available
                strategy_audit = strategy_status.get('audit_trail', [])
                if strategy_audit and len(strategy_audit) > len(replay_info['audit_trail']):
                    # Add new audit entries
                    new_entries = strategy_audit[len(replay_info['audit_trail']):]
                    replay_info['audit_trail'].extend(new_entries)
                
                # Emit update every candle (or you can throttle this)
                self.socketio.emit('replay_update', {
                    'currentPrice': close_price,
                    'currentTime': candle_date.isoformat(),
                    'pnl': cumulative_pnl,
                    'progress': progress,
                    'status': 'running',
                    'trades': total_trades,
                    'audit_trail': replay_info['audit_trail'][-50:],  # Last 50 entries for real-time display
                    'index_data': replay_info['index_data'][-100:],  # Last 100 candles for chart
                    'strategy_data_points': replay_info['strategy_data_points'][-100:],  # Last 100 points for chart
                    'position': position,
                    'entry_price': entry_price
                }, room=session_id)
                
                # Wait based on speed
                current_speed = replay_info.get('speed', speed)
                delay = base_delay / current_speed if current_speed > 0 else base_delay
                time.sleep(delay)
            
            # Calculate final results
            final_pnl = cumulative_pnl
            final_trades = total_trades
            
            # Emit completion
            self.socketio.emit('replay_complete', {
                'pnl': final_pnl,
                'trades': final_trades,
                'stopped': False,
                'audit_trail': replay_info['audit_trail'],
                'index_data': replay_info['index_data'],
                'strategy_data_points': replay_info['strategy_data_points'],
                'metrics': {
                    'total_pnl': final_pnl,
                    'total_trades': final_trades,
                    'win_rate': 0,  # Calculate if you track wins/losses
                    'avg_pnl_per_trade': final_pnl / final_trades if final_trades > 0 else 0
                }
            }, room=session_id)
            
        except Exception as e:
            logging.error(f"Error in replay thread: {e}", exc_info=True)
            self.socketio.emit('replay_error', {
                'message': str(e)
            }, room=session_id)
        finally:
            # Clean up
            with self.lock:
                if session_id in self.active_replays:
                    del self.active_replays[session_id]

