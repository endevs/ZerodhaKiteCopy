"""
Kite Connect Utility Functions
Helper functions for Zerodha Kite API operations
"""
import datetime
import logging


def get_option_symbols(kite, underlying, expiry_type, num_strikes):
    """
    Get option symbols for a given underlying, expiry type, and number of strikes
    
    Args:
        kite: KiteConnect instance
        underlying: 'NIFTY' or 'BANKNIFTY'
        expiry_type: 'weekly', 'next_weekly', or 'monthly'
        num_strikes: Number of strikes on each side of ATM
    
    Returns:
        List of instrument tokens
    """
    logging.info(f"Fetching option symbols for {underlying} {expiry_type}")
    
    if underlying == 'NIFTY':
        instrument = 'NSE:NIFTY 50'
    elif underlying == 'BANKNIFTY':
        instrument = 'NSE:NIFTY BANK'
    else:
        logging.error(f"Unknown underlying: {underlying}")
        return []

    try:
        ltp_response = kite.ltp(instrument)
        if not ltp_response or instrument not in ltp_response:
            logging.error(f"Could not fetch LTP for {instrument}")
            return []
        ltp = ltp_response[instrument]['last_price']
        logging.info(f"LTP for {instrument}: {ltp}")
    except Exception as e:
        logging.error(f"Error fetching LTP for {instrument}: {e}")
        return []
    
    try:
        instruments = kite.instruments('NFO')
        logging.info(f"Fetched {len(instruments)} NFO instruments.")
    except Exception as e:
        logging.error(f"Error fetching NFO instruments: {e}")
        return []

    # Get all unique expiry dates for the underlying
    all_expiries = sorted(list(set([
        inst['expiry'] for inst in instruments 
        if inst['name'] == underlying and 'expiry' in inst and inst['expiry']
    ])))

    today = datetime.date.today()
    
    # Normalize expiry_type to lowercase for case-insensitive matching
    expiry_type_lower = expiry_type.lower() if expiry_type else ''
    
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
        logging.error(f"Could not find expiry date for {underlying} {expiry_type}. Available expiries: {all_expiries[:5] if len(all_expiries) > 0 else 'none'}")
        return []

    expiry_date_str = expiry_date.strftime('%Y-%m-%d')

    # Filter by underlying and expiry
    filtered_instruments = [
        inst for inst in instruments 
        if inst['name'] == underlying and 
           'expiry' in inst and inst['expiry'] and
           inst['expiry'].strftime('%Y-%m-%d') == expiry_date_str
    ]
    logging.info(f"Found {len(filtered_instruments)} instruments after filtering by expiry.")

    # Find ATM strike
    strike_prices = sorted(list(set([inst['strike'] for inst in filtered_instruments])))
    if not strike_prices:
        return []
    atm_strike = min(strike_prices, key=lambda x: abs(x - ltp))
    atm_strike_index = strike_prices.index(atm_strike)

    # Get ATM +/- num_strikes
    start_index = max(0, atm_strike_index - num_strikes)
    end_index = min(len(strike_prices) - 1, atm_strike_index + num_strikes)
    selected_strikes = strike_prices[start_index:end_index+1]

    # Get trading symbols for the selected strikes (both CE and PE)
    option_symbols = []
    for inst in filtered_instruments:
        if inst['strike'] in selected_strikes:
            option_symbols.append(inst['instrument_token'])

    logging.info(f"Found {len(option_symbols)} option symbols for {underlying} {expiry_type}")
    return option_symbols

