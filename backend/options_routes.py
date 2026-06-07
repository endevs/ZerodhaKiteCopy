"""
Options Trading Analysis API Routes
Handles endpoints for fetching option chains, expiry dates, and candle data
"""
import logging
import datetime
from flask import Blueprint, request, jsonify, session
from database import get_db_connection
from kiteconnect import KiteConnect
from kiteconnect import exceptions as kite_exceptions

logger = logging.getLogger(__name__)

options_bp = Blueprint('options', __name__)

_INDEX_TOKENS = {'NIFTY': 256265, 'BANKNIFTY': 260105}


def _normalize_candle_ts(ts) -> str:
    """Normalize DB/Kite timestamps to YYYY-MM-DD HH:MM:SS (IST wall-clock)."""
    if hasattr(ts, 'strftime'):
        return ts.strftime('%Y-%m-%d %H:%M:%S')
    s = str(ts).strip()
    s = s.split('+')[0].split('Z')[0]
    if 'T' in s:
        s = s.replace('T', ' ')
    if '.' in s:
        s = s.split('.')[0]
    return s[:19] if len(s) >= 19 else s


def _fetch_index_candles_from_kite(kite, index: str, date_str: str) -> list:
    """Fetch 5m index OHLC from Kite when DB has no rows for the date."""
    token = _INDEX_TOKENS.get(index)
    if not token:
        return []
    try:
        selected_date = datetime.datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        return []
    from_dt = datetime.datetime.combine(selected_date, datetime.time(9, 15))
    to_dt = datetime.datetime.combine(selected_date, datetime.time(15, 30))
    try:
        hist = kite.historical_data(token, from_dt, to_dt, '5minute')
    except Exception as exc:
        logger.warning("Kite index candles failed for %s %s: %s", index, date_str, exc)
        return []
    candles = []
    for row in hist or []:
        ts = _normalize_candle_ts(row.get('date'))
        if not ts.startswith(date_str):
            continue
        candles.append({
            'timestamp': ts,
            'open': float(row.get('open') or 0),
            'high': float(row.get('high') or 0),
            'low': float(row.get('low') or 0),
            'close': float(row.get('close') or 0),
            'volume': int(row.get('volume') or 0),
        })
    return candles


def get_kite_client():
    """Get KiteConnect client from session user's credentials"""
    if 'user_id' not in session:
        raise ValueError("User not logged in")
    
    user_id = session.get('user_id')
    conn = get_db_connection()
    try:
        cursor = conn.execute(
            'SELECT app_key, app_secret, zerodha_access_token FROM users WHERE id = ? LIMIT 1',
            (user_id,)
        )
        user = cursor.fetchone()
        
        if not user or not user[0] or not user[2]:
            raise ValueError("Zerodha credentials not configured")
        
        kite = KiteConnect(api_key=user[0], access_token=user[2])
        return kite
    finally:
        conn.close()


@options_bp.route('/api/options/ltp', methods=['GET'])
def get_index_ltp():
    """Get current LTP for selected index"""
    try:
        if 'user_id' not in session:
            return jsonify({'error': 'User not logged in'}), 401
        
        index = request.args.get('index', 'BANKNIFTY').upper()
        
        if index == 'BANKNIFTY':
            symbol = 'NSE:NIFTY BANK'
        elif index == 'NIFTY':
            symbol = 'NSE:NIFTY 50'
        else:
            return jsonify({'error': 'Invalid index. Use NIFTY or BANKNIFTY'}), 400
        
        kite = get_kite_client()
        ltp_response = kite.ltp(symbol)
        
        if symbol not in ltp_response:
            return jsonify({'error': 'Could not fetch LTP'}), 500
        
        ltp = ltp_response[symbol]['last_price']
        
        return jsonify({
            'index': index,
            'ltp': ltp,
            'timestamp': datetime.datetime.now().isoformat()
        })
    except kite_exceptions.TokenException:
        return jsonify({
            'error': 'Zerodha session expired. Please log in again.',
            'authExpired': True
        }), 401
    except ValueError as e:
        return jsonify({'error': str(e)}), 401
    except Exception as e:
        logger.error(f"Error fetching LTP: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@options_bp.route('/api/options/expiry-dates', methods=['GET'])
def get_expiry_dates():
    """Get available expiry dates for selected index"""
    try:
        if 'user_id' not in session:
            return jsonify({'error': 'User not logged in'}), 401
        
        index = request.args.get('index', 'BANKNIFTY').upper()
        
        if index not in ['NIFTY', 'BANKNIFTY']:
            return jsonify({'error': 'Invalid index. Use NIFTY or BANKNIFTY'}), 400
        
        kite = get_kite_client()
        
        # Fetch instruments from NFO
        instruments = kite.instruments('NFO')
        
        # Get unique expiry dates for the index
        expiries = sorted(list(set([
            inst['expiry'] for inst in instruments
            if inst.get('name') == index and inst.get('expiry')
        ])))
        
        # Convert to date strings
        expiry_dates = [exp.strftime('%Y-%m-%d') if hasattr(exp, 'strftime') else str(exp) 
                       for exp in expiries]
        
        # Also get expiry dates from database (historical data)
        conn = get_db_connection()
        try:
            cursor = conn.execute("""
                SELECT DISTINCT expiry_date 
                FROM option_contracts 
                WHERE index_name = ?
                ORDER BY expiry_date DESC
            """, (index,))
            db_expiries = [row[0] for row in cursor.fetchall()]
            
            # Merge and deduplicate
            all_expiries = sorted(list(set(expiry_dates + db_expiries)))
        finally:
            conn.close()
        
        return jsonify({
            'index': index,
            'expiry_dates': all_expiries
        })
    except kite_exceptions.TokenException:
        return jsonify({
            'error': 'Zerodha session expired. Please log in again.',
            'authExpired': True
        }), 401
    except ValueError as e:
        return jsonify({'error': str(e)}), 401
    except Exception as e:
        logger.error(f"Error fetching expiry dates: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@options_bp.route('/api/options/fetch-chain', methods=['POST'])
def fetch_option_chain():
    """Fetch option chain for selected expiry date"""
    try:
        if 'user_id' not in session:
            return jsonify({'error': 'User not logged in'}), 401
        
        data = request.get_json()
        index = data.get('index', 'BANKNIFTY').upper()
        expiry_date_str = data.get('expiry_date')
        trading_date_str = data.get('trading_date')  # Get trading date
        
        if not expiry_date_str:
            return jsonify({'error': 'expiry_date is required'}), 400
        
        if not trading_date_str:
            return jsonify({'error': 'trading_date is required'}), 400
        
        if index not in ['NIFTY', 'BANKNIFTY']:
            return jsonify({'error': 'Invalid index. Use NIFTY or BANKNIFTY'}), 400
        
        # Parse dates
        try:
            if isinstance(expiry_date_str, str):
                expiry_date = datetime.datetime.strptime(expiry_date_str, '%Y-%m-%d').date()
            else:
                expiry_date = expiry_date_str
            
            if isinstance(trading_date_str, str):
                trading_date = datetime.datetime.strptime(trading_date_str, '%Y-%m-%d').date()
            else:
                trading_date = trading_date_str
        except (ValueError, TypeError) as e:
            return jsonify({'error': f'Invalid date format. Use YYYY-MM-DD: {str(e)}'}), 400
        
        kite = get_kite_client()
        
        # Check if expiry is in the future (active) or past (historical)
        today = datetime.date.today()
        is_active = expiry_date >= today
        
        # Get index high/low for the selected trading date
        conn = get_db_connection()
        try:
            cursor = conn.execute("""
                SELECT MIN(low) as min_low, MAX(high) as max_high, 
                       AVG(close) as avg_close
                FROM index_candles_5min
                WHERE index_name = ? AND date = ?
            """, (index, trading_date_str))
            
            row = cursor.fetchone()
            if row and row[0] and row[1]:
                index_low = row[0]
                index_high = row[1]
                index_close = row[2] if row[2] else (index_low + index_high) / 2
            else:
                # Fallback: try to get from daily data
                cursor = conn.execute("""
                    SELECT low, high, close
                    FROM index_daily_data
                    WHERE index_name = ? AND date = ?
                """, (index, trading_date_str))
                daily_row = cursor.fetchone()
                if daily_row:
                    index_low = daily_row[0]
                    index_high = daily_row[1]
                    index_close = daily_row[2]
                else:
                    # Last resort: use current LTP if available
                    if index == 'BANKNIFTY':
                        symbol = 'NSE:NIFTY BANK'
                    else:
                        symbol = 'NSE:NIFTY 50'
                    try:
                        ltp_response = kite.ltp(symbol)
                        current_ltp = ltp_response[symbol]['last_price'] if symbol in ltp_response else 0
                        index_low = current_ltp * 0.95  # Approximate 5% range
                        index_high = current_ltp * 1.05
                        index_close = current_ltp
                    except:
                        return jsonify({'error': f'No data found for {index} on {trading_date_str}'}), 404
        finally:
            conn.close()
        
        strike_step = 100 if index == 'BANKNIFTY' else 50
        
        if is_active and trading_date == today:
            # Fetch from Zerodha API for today's active contracts
            instruments = kite.instruments('NFO')
            
            expiry_str = expiry_date.strftime('%Y-%m-%d')
            options = [
                inst for inst in instruments
                if inst.get('name') == index and
                   inst.get('expiry') and
                   inst.get('expiry').strftime('%Y-%m-%d') == expiry_str
            ]
            
            # Use selected date's high/low to determine strike range
            min_strike = (int(index_low / strike_step) - 20) * strike_step
            max_strike = (int(index_high / strike_step) + 20) * strike_step
            
            filtered_options = [
                opt for opt in options
                if min_strike <= opt.get('strike', 0) <= max_strike
            ]
        else:
            # Fetch from database (historical) for the specific trading_date
            conn = get_db_connection()
            try:
                # Use selected date's high/low to filter strikes
                min_strike = (int(index_low / strike_step) - 20) * strike_step
                max_strike = (int(index_high / strike_step) + 20) * strike_step
                
                cursor = conn.execute("""
                    SELECT DISTINCT instrument_token, tradingsymbol, strike, expiry_date, instrument_type
                    FROM option_contracts
                    WHERE index_name = ? AND expiry_date = ? AND date = ?
                      AND strike >= ? AND strike <= ?
                    ORDER BY strike, instrument_type
                """, (index, expiry_date_str, trading_date_str, min_strike, max_strike))
                
                filtered_options = []
                for row in cursor.fetchall():
                    filtered_options.append({
                        'instrument_token': row[0],
                        'tradingsymbol': row[1],
                        'strike': row[2],
                        'expiry': datetime.datetime.strptime(row[3], '%Y-%m-%d').date() if isinstance(row[3], str) else row[3],
                        'instrument_type': row[4]
                    })
            finally:
                conn.close()
        
        # Calculate ATM strike based on selected date's close price
        atm_strike = round(index_close / strike_step) * strike_step
        
        # Organize by strike
        strikes = sorted(list(set([opt.get('strike') for opt in filtered_options])))
        chain_data = []
        
        for strike in strikes:
            ce_opt = next((opt for opt in filtered_options if opt.get('strike') == strike and opt.get('instrument_type') == 'CE'), None)
            pe_opt = next((opt for opt in filtered_options if opt.get('strike') == strike and opt.get('instrument_type') == 'PE'), None)
            
            chain_data.append({
                'strike': strike,
                'ce': {
                    'instrument_token': ce_opt.get('instrument_token') if ce_opt else None,
                    'tradingsymbol': ce_opt.get('tradingsymbol') if ce_opt else None,
                } if ce_opt else None,
                'pe': {
                    'instrument_token': pe_opt.get('instrument_token') if pe_opt else None,
                    'tradingsymbol': pe_opt.get('tradingsymbol') if pe_opt else None,
                } if pe_opt else None,
            })
        
        return jsonify({
            'index': index,
            'expiry_date': expiry_date_str,
            'trading_date': trading_date_str,
            'strikes': strikes,
            'chain': chain_data,
            'is_active': is_active,
            'atm_strike': atm_strike,  # Return ATM strike for frontend
            'index_range': {  # Return index range for debugging
                'low': index_low,
                'high': index_high,
                'close': index_close
            }
        })
    except kite_exceptions.TokenException:
        return jsonify({
            'error': 'Zerodha session expired. Please log in again.',
            'authExpired': True
        }), 401
    except ValueError as e:
        return jsonify({'error': str(e)}), 401
    except Exception as e:
        logger.error(f"Error fetching option chain: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@options_bp.route('/api/options/chain', methods=['GET'])
def get_option_chain():
    """Get stored option chain from database"""
    try:
        index = request.args.get('index', 'BANKNIFTY').upper()
        expiry_date = request.args.get('expiry_date')
        
        if not expiry_date:
            return jsonify({'error': 'expiry_date is required'}), 400
        
        conn = get_db_connection()
        try:
            cursor = conn.execute("""
                SELECT DISTINCT instrument_token, tradingsymbol, strike, expiry_date, instrument_type
                FROM option_contracts
                WHERE index_name = ? AND expiry_date = ?
                ORDER BY strike, instrument_type
            """, (index, expiry_date))
            
            options = []
            for row in cursor.fetchall():
                options.append({
                    'instrument_token': row[0],
                    'tradingsymbol': row[1],
                    'strike': row[2],
                    'expiry_date': row[3],
                    'instrument_type': row[4]
                })
        finally:
            conn.close()
        
        # Organize by strike
        strikes = sorted(list(set([opt['strike'] for opt in options])))
        chain_data = []
        
        for strike in strikes:
            ce_opt = next((opt for opt in options if opt['strike'] == strike and opt['instrument_type'] == 'CE'), None)
            pe_opt = next((opt for opt in options if opt['strike'] == strike and opt['instrument_type'] == 'PE'), None)
            
            chain_data.append({
                'strike': strike,
                'ce': ce_opt,
                'pe': pe_opt
            })
        
        return jsonify({
            'index': index,
            'expiry_date': expiry_date,
            'chain': chain_data
        })
    except Exception as e:
        logger.error(f"Error getting option chain: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@options_bp.route('/api/options/candles', methods=['GET'])
def get_option_candles():
    """Get 5-minute candle data for selected option"""
    try:
        if 'user_id' not in session:
            return jsonify({'error': 'User not logged in'}), 401
        
        instrument_token = request.args.get('instrument_token')
        expiry_date = request.args.get('expiry_date')
        
        if not instrument_token:
            return jsonify({'error': 'instrument_token is required'}), 400
        
        instrument_token = int(instrument_token)
        
        # Try to fetch from database first
        conn = get_db_connection()
        candles = []
        
        try:
            if expiry_date:
                cursor = conn.execute("""
                    SELECT timestamp, open, high, low, close, volume
                    FROM option_candles_5min
                    WHERE instrument_token = ? AND date = ?
                    ORDER BY timestamp
                """, (instrument_token, expiry_date))
            else:
                # Get most recent date
                cursor = conn.execute("""
                    SELECT timestamp, open, high, low, close, volume
                    FROM option_candles_5min
                    WHERE instrument_token = ?
                    ORDER BY timestamp DESC
                    LIMIT 75
                """, (instrument_token,))
            
            for row in cursor.fetchall():
                ts = row[0]
                if hasattr(ts, 'strftime'):
                    ts = ts.strftime('%Y-%m-%d %H:%M:%S')
                candles.append({
                    'timestamp': str(ts),
                    'open': row[1],
                    'high': row[2],
                    'low': row[3],
                    'close': row[4],
                    'volume': row[5] if row[5] else 0
                })
        finally:
            conn.close()
        
        # If no data in database, try Zerodha API (for active contracts)
        if not candles:
            try:
                kite = get_kite_client()
                today = datetime.date.today()
                from_date = today - datetime.timedelta(days=7)
                to_date = today
                if expiry_date:
                    try:
                        target = datetime.datetime.strptime(expiry_date, '%Y-%m-%d').date()
                        from_date = target
                        to_date = target
                    except ValueError:
                        pass

                data = kite.historical_data(
                    instrument_token=instrument_token,
                    from_date=from_date,
                    to_date=to_date,
                    interval='5minute'
                )

                def _candle_ts_str(ts) -> str:
                    if hasattr(ts, 'strftime'):
                        return ts.strftime('%Y-%m-%d %H:%M:%S')
                    return str(ts)

                candles = [
                    {
                        'timestamp': _candle_ts_str(candle['date']),
                        'open': candle['open'],
                        'high': candle['high'],
                        'low': candle['low'],
                        'close': candle['close'],
                        'volume': candle.get('volume', 0),
                    }
                    for candle in data
                ]
                if expiry_date:
                    candles = [
                        c for c in candles
                        if c['timestamp'].startswith(expiry_date)
                    ]
            except kite_exceptions.TokenException:
                return jsonify({
                    'error': 'Zerodha session expired. Please log in again.',
                    'authExpired': True
                }), 401
            except Exception as e:
                logger.warning(f"Could not fetch from Zerodha API: {e}")
        
        return jsonify({
            'instrument_token': instrument_token,
            'candles': candles,
            'count': len(candles)
        })
    except ValueError as e:
        return jsonify({'error': str(e)}), 401
    except Exception as e:
        logger.error(f"Error fetching candles: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@options_bp.route('/api/options/index-data', methods=['GET'])
def get_index_data():
    """Get index OHLC data for calculating strike range"""
    try:
        if 'user_id' not in session:
            return jsonify({'error': 'User not logged in'}), 401
        
        index = request.args.get('index', 'BANKNIFTY').upper()
        expiry_date = request.args.get('expiry_date')
        
        if index not in ['NIFTY', 'BANKNIFTY']:
            return jsonify({'error': 'Invalid index'}), 400
        
        conn = get_db_connection()
        try:
            # Get most recent trading date with data for this expiry
            if expiry_date:
                # Find the most recent date where we have option contracts for this expiry
                cursor = conn.execute("""
                    SELECT MAX(date) as max_date
                    FROM option_contracts
                    WHERE index_name = ? AND expiry_date = ?
                """, (index, expiry_date))
                row = cursor.fetchone()
                target_date = row[0] if row and row[0] else None
            else:
                # Get most recent date
                cursor = conn.execute("""
                    SELECT MAX(date) as max_date
                    FROM index_daily_data
                    WHERE index_name = ?
                """, (index,))
                row = cursor.fetchone()
                target_date = row[0] if row and row[0] else None
            
            if not target_date:
                return jsonify({'error': 'No data found'}), 404
            
            # Get daily OHLC
            cursor = conn.execute("""
                SELECT date, open, high, low, close, volume
                FROM index_daily_data
                WHERE index_name = ? AND date = ?
            """, (index, target_date))
            
            row = cursor.fetchone()
            if not row:
                return jsonify({'error': 'No data found for date'}), 404
            
            return jsonify({
                'index': index,
                'date': row[0],
                'open': row[1],
                'high': row[2],
                'low': row[3],
                'close': row[4],
                'volume': row[5] if row[5] else 0
            })
        finally:
            conn.close()
    except ValueError as e:
        return jsonify({'error': str(e)}), 401
    except Exception as e:
        logger.error(f"Error fetching index data: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@options_bp.route('/api/options/index-candles', methods=['GET'])
def get_index_candles():
    """Get 5-minute candle data for index on a specific date"""
    try:
        if 'user_id' not in session:
            return jsonify({'error': 'User not logged in'}), 401
        
        index = request.args.get('index', 'BANKNIFTY').upper()
        date_str = request.args.get('date')
        
        if not date_str:
            return jsonify({'error': 'Date parameter is required'}), 400
        
        if index not in ['NIFTY', 'BANKNIFTY']:
            return jsonify({'error': 'Invalid index'}), 400
        
        conn = get_db_connection()
        try:
            cursor = conn.execute("""
                SELECT timestamp, open, high, low, close, volume
                FROM index_candles_5min
                WHERE index_name = ? AND date = ?
                ORDER BY timestamp
            """, (index, date_str))
            
            candles = []
            for row in cursor.fetchall():
                candles.append({
                    'timestamp': _normalize_candle_ts(row[0]),
                    'open': row[1],
                    'high': row[2],
                    'low': row[3],
                    'close': row[4],
                    'volume': row[5] if row[5] else 0
                })
        finally:
            conn.close()

        if len(candles) == 0:
            try:
                kite = get_kite_client()
                candles = _fetch_index_candles_from_kite(kite, index, date_str)
                if candles:
                    logger.info(
                        "Fetched %d index candles from Kite for %s on %s",
                        len(candles), index, date_str,
                    )
            except kite_exceptions.TokenException:
                return jsonify({
                    'error': 'Zerodha session expired. Please log in again.',
                    'authExpired': True,
                }), 401
            except (ValueError, Exception) as exc:
                logger.warning("Kite fallback for index candles failed: %s", exc)

        if len(candles) == 0:
            logger.warning(f"No index candles found for {index} on {date_str}")
            return jsonify({
                'index': index,
                'date': date_str,
                'candles': [],
                'warning': f'No data found for {date_str}. Please check Database Record Status tab to see available dates.'
            }), 200

        return jsonify({
            'index': index,
            'date': date_str,
            'candles': candles
        })
    except ValueError as e:
        return jsonify({'error': str(e)}), 401
    except Exception as e:
        logger.error(f"Error fetching index candles: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@options_bp.route('/api/options/db-status', methods=['GET'])
def get_db_status():
    """Get database status showing what data is available"""
    try:
        if 'user_id' not in session:
            return jsonify({'error': 'User not logged in'}), 401
        
        conn = get_db_connection()
        try:
            # Get index candle data status
            cursor = conn.execute("""
                SELECT 
                    index_name,
                    date,
                    COUNT(*) as candle_count,
                    MIN(timestamp) as first_candle,
                    MAX(timestamp) as last_candle
                FROM index_candles_5min
                GROUP BY index_name, date
                ORDER BY index_name, date DESC
            """)
            
            index_data = []
            for row in cursor.fetchall():
                index_data.append({
                    'index': row[0],
                    'date': row[1],
                    'candle_count': row[2],
                    'first_candle': row[3],
                    'last_candle': row[4]
                })
            
            # Get option contracts status
            cursor = conn.execute("""
                SELECT 
                    index_name,
                    date,
                    COUNT(DISTINCT instrument_token) as contract_count,
                    COUNT(DISTINCT strike) as strike_count
                FROM option_contracts
                GROUP BY index_name, date
                ORDER BY index_name, date DESC
            """)
            
            option_data = []
            for row in cursor.fetchall():
                option_data.append({
                    'index': row[0],
                    'date': row[1],
                    'contract_count': row[2],
                    'strike_count': row[3]
                })
            
            # Get option candles status
            cursor = conn.execute("""
                SELECT 
                    oc.index_name,
                    oc.date,
                    COUNT(DISTINCT oc.instrument_token) as contracts_with_candles,
                    COUNT(oc5.id) as total_candles
                FROM option_contracts oc
                LEFT JOIN option_candles_5min oc5 ON oc.instrument_token = oc5.instrument_token AND oc.date = oc5.date
                GROUP BY oc.index_name, oc.date
                ORDER BY oc.index_name, oc.date DESC
            """)
            
            option_candle_data = []
            for row in cursor.fetchall():
                option_candle_data.append({
                    'index': row[0],
                    'date': row[1],
                    'contracts_with_candles': row[2] if row[2] else 0,
                    'total_candles': row[3] if row[3] else 0
                })
            
            # Summary statistics
            cursor = conn.execute("""
                SELECT 
                    index_name,
                    COUNT(DISTINCT date) as date_count,
                    MIN(date) as earliest_date,
                    MAX(date) as latest_date
                FROM index_candles_5min
                GROUP BY index_name
            """)
            
            summary = {}
            for row in cursor.fetchall():
                summary[row[0]] = {
                    'date_count': row[1],
                    'earliest_date': row[2],
                    'latest_date': row[3]
                }
            
            return jsonify({
                'index_data': index_data,
                'option_data': option_data,
                'option_candle_data': option_candle_data,
                'summary': summary
            })
        finally:
            conn.close()
    except Exception as e:
        logger.error(f"Error fetching database status: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


def _debug_log_options(hypothesis_id: str, message: str, data: dict) -> None:
    import json
    import os
    import time
    payload = {
        'sessionId': 'c3dc96',
        'hypothesisId': hypothesis_id,
        'location': 'options_routes.py:default-selection',
        'message': message,
        'data': data,
        'timestamp': int(time.time() * 1000),
    }
    path = os.environ.get('DEBUG_LOG_PATH', 'debug-c3dc96.log')
    try:
        with open(path, 'a', encoding='utf-8') as f:
            f.write(json.dumps(payload) + '\n')
    except Exception:
        pass


@options_bp.route('/api/options/default-selection', methods=['GET'])
def get_default_selection():
    """Default index, trading date, and nearest expiry for Options tab on load."""
    try:
        if 'user_id' not in session:
            _debug_log_options('A', 'default-selection unauthorized', {})
            return jsonify({'error': 'User not logged in'}), 401
        index = request.args.get('index', 'NIFTY').upper()
        if index not in ('NIFTY', 'BANKNIFTY'):
            index = 'NIFTY'
        today = datetime.date.today()
        trading_date = today.strftime('%Y-%m-%d')
        expiries: list = []
        try:
            kite = get_kite_client()
            instruments = kite.instruments('NFO')
            expiries = sorted(list(set([
                inst['expiry'].strftime('%Y-%m-%d') if hasattr(inst.get('expiry'), 'strftime') else str(inst['expiry'])
                for inst in instruments
                if inst.get('name') == index and inst.get('expiry')
            ])))
        except Exception:
            pass
        conn = get_db_connection()
        try:
            rows = conn.execute(
                "SELECT DISTINCT expiry_date FROM option_contracts WHERE index_name = ? ORDER BY expiry_date DESC",
                (index,),
            ).fetchall()
            db_ex = [r[0] for r in rows]
            expiries = sorted(list(set(expiries + db_ex)))
        finally:
            conn.close()
        from option_chain_board import pick_default_expiry
        expiry = pick_default_expiry(expiries, today)
        _debug_log_options('A', 'default-selection ok', {
            'index': index,
            'trading_date': trading_date,
            'expiry_date': expiry,
            'expiries_count': len(expiries),
        })
        return jsonify({
            'index': index,
            'trading_date': trading_date,
            'expiry_date': expiry,
            'expiry_dates': expiries,
        })
    except Exception as e:
        logger.error(f"default-selection error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@options_bp.route('/api/options/chain-board', methods=['GET'])
def get_chain_board():
    """Option chain with LTP, IV, OI and changes for UI board."""
    try:
        if 'user_id' not in session:
            return jsonify({'error': 'User not logged in'}), 401
        index = request.args.get('index', 'NIFTY').upper()
        trading_date = request.args.get('trading_date')
        expiry_date = request.args.get('expiry_date')
        if not trading_date or not expiry_date:
            return jsonify({'error': 'trading_date and expiry_date are required'}), 400
        kite = None
        try:
            kite = get_kite_client()
        except ValueError:
            pass
        from option_chain_board import build_chain_board
        board = build_chain_board(kite, index, trading_date, expiry_date, live_poll=True)
        return jsonify(board)
    except kite_exceptions.TokenException:
        return jsonify({
            'error': 'Zerodha session expired. Please log in again.',
            'authExpired': True,
        }), 401
    except Exception as e:
        logger.error(f"chain-board error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@options_bp.route('/api/options/spikes', methods=['GET'])
def get_option_spikes():
    try:
        if 'user_id' not in session:
            return jsonify({'error': 'User not logged in'}), 401
        index = request.args.get('index', 'NIFTY').upper()
        trading_date = request.args.get('trading_date', datetime.date.today().strftime('%Y-%m-%d'))
        expiry_date = request.args.get('expiry_date')
        from option_spike_detector import list_recent_spikes
        spikes = list_recent_spikes(index, trading_date, expiry_date)
        return jsonify({'spikes': spikes, 'index': index, 'trading_date': trading_date})
    except Exception as e:
        logger.error(f"spikes error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@options_bp.route('/api/options/capture/subscribe', methods=['POST'])
def subscribe_option_capture():
    """Register ATM±15 tokens for tick capture (called when Options tab is active)."""
    try:
        if 'user_id' not in session:
            return jsonify({'error': 'User not logged in'}), 401
        data = request.get_json() or {}
        index = data.get('index', 'NIFTY').upper()
        expiry_date_str = data.get('expiry_date')
        if not expiry_date_str:
            return jsonify({'error': 'expiry_date required'}), 400
        kite = get_kite_client()
        sym = 'NSE:NIFTY BANK' if index == 'BANKNIFTY' else 'NSE:NIFTY 50'
        spot = float(kite.ltp(sym)[sym]['last_price'])
        expiry_date = datetime.datetime.strptime(expiry_date_str, '%Y-%m-%d').date()
        trading_date = datetime.date.today()
        from option_chain_capture import capture_quotes_from_kite, resolve_atm_band_contracts
        band = resolve_atm_band_contracts(kite, index, expiry_date, spot, trading_date)
        capture_quotes_from_kite(kite, band, spot)
        return jsonify({'status': 'ok', 'tokens': len(band)})
    except Exception as e:
        logger.error(f"capture subscribe error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@options_bp.route('/api/options/collect-data', methods=['POST'])
def trigger_data_collection():
    """Manually trigger data collection for a specific date and index"""
    try:
        if 'user_id' not in session:
            return jsonify({'error': 'User not logged in'}), 401
        
        data = request.get_json()
        date_str = data.get('date')
        index = data.get('index')  # Optional: 'NIFTY' or 'BANKNIFTY'
        
        if not date_str:
            return jsonify({'error': 'Date parameter is required'}), 400
        
        try:
            if isinstance(date_str, str):
                collection_date = datetime.datetime.strptime(date_str, '%Y-%m-%d').date()
            else:
                collection_date = date_str
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400
        
        # Import the collection function
        from options_data_collector import collect_index_data, collect_option_chain
        
        kite = get_kite_client()
        results = {}
        
        # Collect for specific index or both
        indices_to_collect = [index] if index and index.upper() in ['NIFTY', 'BANKNIFTY'] else ['NIFTY', 'BANKNIFTY']
        
        for index_name in indices_to_collect:
            logger.info(f"Collecting data for {index_name} on {collection_date}")
            
            # Collect index data
            index_success = collect_index_data(index_name, collection_date, kite)
            
            if index_success:
                # Collect option chain
                chain_success = collect_option_chain(index_name, collection_date, kite)
                results[index_name] = {
                    'index_data': True,
                    'option_chain': chain_success
                }
            else:
                results[index_name] = {
                    'index_data': False,
                    'option_chain': False
                }
        
        return jsonify({
            'success': True,
            'date': date_str,
            'results': results,
            'message': f'Data collection completed for {date_str}'
        })
    except Exception as e:
        logger.error(f"Error triggering data collection: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500
