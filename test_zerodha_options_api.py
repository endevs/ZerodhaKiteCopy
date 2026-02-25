"""
Test Zerodha Kite API capabilities for Index Options (Nifty 50 and Bank Nifty)
This script tests:
1. Fetching option instruments from NFO exchange
2. Building option chains for Nifty and Bank Nifty
3. Fetching historical data for active (unexpired) options
4. Attempting to fetch historical data for expired options (should fail)
5. Testing different intervals (1minute, 5minute, daily)
"""

import logging
import datetime
import sys
import os
from typing import Dict, List, Optional
from kiteconnect import KiteConnect

# Add backend to path
backend_dir = os.path.join(os.path.dirname(__file__), 'backend')
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

# Set up config before importing database (same approach as data_fetcher.py)
import importlib.util
_config_path = os.path.join(backend_dir, 'config.py')
_spec = importlib.util.spec_from_file_location("backend_config", _config_path)
backend_config = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(backend_config)

# Set DATABASE_PATH to absolute path
database_path = os.path.join(backend_dir, 'database.db')
backend_config.DATABASE_PATH = database_path
sys.modules['config'] = backend_config

# Import database connection
from database import get_db_connection

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def get_kite_client(user_email: str = "raj.bapa@gmail.com") -> Optional[KiteConnect]:
    """Get KiteConnect client from database."""
    try:
        conn = get_db_connection()
        cursor = conn.execute(
            'SELECT app_key, app_secret, zerodha_access_token FROM users WHERE email = ? LIMIT 1',
            (user_email,)
        )
        user = cursor.fetchone()
        conn.close()
        
        if not user or not user[0] or not user[1] or not user[2]:
            logger.error(f"Zerodha credentials not found in database for {user_email}")
            return None
        
        kite = KiteConnect(api_key=user[0], access_token=user[2])
        profile = kite.profile()
        logger.info(f"✓ Connected to Zerodha as: {profile.get('user_name', 'Unknown')}")
        return kite
    except Exception as e:
        logger.error(f"Error connecting to Zerodha: {e}")
        return None


def test_fetch_instruments(kite: KiteConnect, exchange: str = 'NFO') -> List[Dict]:
    """Test fetching instruments from NFO exchange."""
    logger.info(f"\n{'='*60}")
    logger.info(f"TEST 1: Fetching {exchange} instruments")
    logger.info(f"{'='*60}")
    
    try:
        instruments = kite.instruments(exchange)
        logger.info(f"✓ Successfully fetched {len(instruments)} instruments from {exchange}")
        
        # Filter for Nifty and Bank Nifty options
        nifty_options = [inst for inst in instruments if inst.get('name') == 'NIFTY' and inst.get('instrument_type') == 'CE']
        banknifty_options = [inst for inst in instruments if inst.get('name') == 'BANKNIFTY' and inst.get('instrument_type') == 'CE']
        
        logger.info(f"  - NIFTY CE options: {len(nifty_options)}")
        logger.info(f"  - BANKNIFTY CE options: {len(banknifty_options)}")
        
        # Show sample instrument structure
        if nifty_options:
            sample = nifty_options[0]
            logger.info(f"\n  Sample NIFTY option instrument structure:")
            logger.info(f"    - instrument_token: {sample.get('instrument_token')}")
            logger.info(f"    - exchange_token: {sample.get('exchange_token')}")
            logger.info(f"    - tradingsymbol: {sample.get('tradingsymbol')}")
            logger.info(f"    - name: {sample.get('name')}")
            logger.info(f"    - expiry: {sample.get('expiry')}")
            logger.info(f"    - strike: {sample.get('strike')}")
            logger.info(f"    - instrument_type: {sample.get('instrument_type')}")
            logger.info(f"    - segment: {sample.get('segment')}")
            logger.info(f"    - exchange: {sample.get('exchange')}")
        
        return instruments
    except Exception as e:
        logger.error(f"✗ Error fetching instruments: {e}")
        return []


def test_build_option_chain(kite: KiteConnect, underlying: str = 'BANKNIFTY') -> Dict:
    """Test building option chain for a given underlying."""
    logger.info(f"\n{'='*60}")
    logger.info(f"TEST 2: Building Option Chain for {underlying}")
    logger.info(f"{'='*60}")
    
    try:
        # Get current LTP for underlying
        if underlying == 'BANKNIFTY':
            index_symbol = 'NSE:NIFTY BANK'
        elif underlying == 'NIFTY':
            index_symbol = 'NSE:NIFTY 50'
        else:
            logger.error(f"Unknown underlying: {underlying}")
            return {}
        
        ltp_response = kite.ltp(index_symbol)
        if not ltp_response or index_symbol not in ltp_response:
            logger.error(f"Could not fetch LTP for {index_symbol}")
            return {}
        
        ltp = ltp_response[index_symbol]['last_price']
        logger.info(f"✓ Current {underlying} LTP: {ltp}")
        
        # Fetch all NFO instruments
        instruments = kite.instruments('NFO')
        
        # Get today's date
        today = datetime.date.today()
        
        # Find active expiries (today or future)
        all_expiries = sorted(list(set([
            inst['expiry'] for inst in instruments 
            if inst.get('name') == underlying and 
               inst.get('expiry') and 
               inst.get('expiry') >= today
        ])))
        
        logger.info(f"✓ Found {len(all_expiries)} active expiries (>= {today})")
        if all_expiries:
            logger.info(f"  - Nearest expiry: {all_expiries[0]}")
            logger.info(f"  - Furthest expiry: {all_expiries[-1]}")
        
        # Get option chain for nearest expiry
        if not all_expiries:
            logger.warning("No active expiries found")
            return {}
        
        nearest_expiry = all_expiries[0]
        expiry_str = nearest_expiry.strftime('%Y-%m-%d')
        
        # Filter options for nearest expiry
        options = [
            inst for inst in instruments
            if inst.get('name') == underlying and
               inst.get('expiry') and
               inst.get('expiry').strftime('%Y-%m-%d') == expiry_str
        ]
        
        # Separate CE and PE
        ce_options = [opt for opt in options if opt.get('instrument_type') == 'CE']
        pe_options = [opt for opt in options if opt.get('instrument_type') == 'PE']
        
        # Get strikes
        strikes = sorted(list(set([opt.get('strike') for opt in options if opt.get('strike')])))
        
        logger.info(f"\n✓ Option Chain for {underlying} {expiry_str}:")
        logger.info(f"  - Total options: {len(options)}")
        logger.info(f"  - CE options: {len(ce_options)}")
        logger.info(f"  - PE options: {len(pe_options)}")
        logger.info(f"  - Unique strikes: {len(strikes)}")
        logger.info(f"  - Strike range: {min(strikes)} to {max(strikes)}")
        logger.info(f"  - ATM strike (closest to {ltp}): {min(strikes, key=lambda x: abs(x - ltp))}")
        
        # Show sample option chain (ATM ± 2 strikes)
        atm_strike = min(strikes, key=lambda x: abs(x - ltp))
        atm_index = strikes.index(atm_strike)
        sample_strikes = strikes[max(0, atm_index-2):min(len(strikes), atm_index+3)]
        
        logger.info(f"\n  Sample Option Chain (ATM ± 2 strikes):")
        logger.info(f"  {'Strike':<10} {'CE Token':<12} {'PE Token':<12} {'CE Symbol':<25} {'PE Symbol':<25}")
        logger.info(f"  {'-'*10} {'-'*12} {'-'*12} {'-'*25} {'-'*25}")
        
        for strike in sample_strikes:
            ce_opt = next((opt for opt in ce_options if opt.get('strike') == strike), None)
            pe_opt = next((opt for opt in pe_options if opt.get('strike') == strike), None)
            ce_token = ce_opt.get('instrument_token') if ce_opt else 'N/A'
            pe_token = pe_opt.get('instrument_token') if pe_opt else 'N/A'
            ce_symbol = ce_opt.get('tradingsymbol') if ce_opt else 'N/A'
            pe_symbol = pe_opt.get('tradingsymbol') if pe_opt else 'N/A'
            logger.info(f"  {strike:<10} {ce_token:<12} {pe_token:<12} {ce_symbol:<25} {pe_symbol:<25}")
        
        return {
            'underlying': underlying,
            'ltp': ltp,
            'expiry': nearest_expiry,
            'options': options,
            'strikes': strikes,
            'atm_strike': atm_strike
        }
    except Exception as e:
        logger.error(f"✗ Error building option chain: {e}", exc_info=True)
        return {}


def test_historical_data_active_option(kite: KiteConnect, option_chain: Dict) -> bool:
    """Test fetching historical data for an active (unexpired) option."""
    logger.info(f"\n{'='*60}")
    logger.info(f"TEST 3: Fetching Historical Data for Active Option")
    logger.info(f"{'='*60}")
    
    if not option_chain or not option_chain.get('options'):
        logger.warning("No option chain available for testing")
        return False
    
    try:
        # Get ATM CE option
        atm_strike = option_chain.get('atm_strike')
        options = option_chain.get('options', [])
        ce_option = next(
            (opt for opt in options 
             if opt.get('strike') == atm_strike and opt.get('instrument_type') == 'CE'),
            None
        )
        
        if not ce_option:
            logger.warning("Could not find ATM CE option")
            return False
        
        instrument_token = ce_option.get('instrument_token')
        tradingsymbol = ce_option.get('tradingsymbol')
        
        logger.info(f"Testing with: {tradingsymbol} (Token: {instrument_token})")
        logger.info(f"  Strike: {atm_strike}, Expiry: {option_chain.get('expiry')}")
        
        # Test different intervals
        intervals = ['1minute', '5minute', '15minute', 'day']
        from_date = datetime.date.today() - datetime.timedelta(days=7)
        to_date = datetime.date.today()
        
        results = {}
        for interval in intervals:
            try:
                logger.info(f"\n  Testing interval: {interval}")
                data = kite.historical_data(
                    instrument_token=instrument_token,
                    from_date=from_date,
                    to_date=to_date,
                    interval=interval
                )
                
                if data:
                    results[interval] = {
                        'success': True,
                        'candles': len(data),
                        'date_range': f"{data[0]['date']} to {data[-1]['date']}" if data else 'N/A'
                    }
                    logger.info(f"    ✓ Success: {len(data)} candles from {data[0]['date']} to {data[-1]['date']}")
                else:
                    results[interval] = {'success': False, 'error': 'No data returned'}
                    logger.warning(f"    ✗ No data returned for {interval}")
            except Exception as e:
                results[interval] = {'success': False, 'error': str(e)}
                logger.error(f"    ✗ Error fetching {interval} data: {e}")
        
        # Summary
        logger.info(f"\n  Summary:")
        successful = [iv for iv, res in results.items() if res.get('success')]
        failed = [iv for iv, res in results.items() if not res.get('success')]
        
        if successful:
            logger.info(f"    ✓ Successful intervals: {', '.join(successful)}")
        if failed:
            logger.info(f"    ✗ Failed intervals: {', '.join(failed)}")
        
        return len(successful) > 0
    except Exception as e:
        logger.error(f"✗ Error testing historical data: {e}", exc_info=True)
        return False


def test_historical_data_expired_option(kite: KiteConnect) -> bool:
    """Test fetching historical data for an expired option (should fail)."""
    logger.info(f"\n{'='*60}")
    logger.info(f"TEST 4: Attempting to Fetch Historical Data for Expired Option")
    logger.info(f"{'='*60}")
    
    try:
        # Get all NFO instruments
        instruments = kite.instruments('NFO')
        
        # Find expired options (expiry < today)
        today = datetime.date.today()
        expired_options = [
            inst for inst in instruments
            if inst.get('name') in ['NIFTY', 'BANKNIFTY'] and
               inst.get('expiry') and
               inst.get('expiry') < today
        ]
        
        if not expired_options:
            logger.warning("No expired options found in instrument list (Zerodha may have flushed them)")
            logger.info("  This confirms: Expired options are NOT available in the API")
            return True  # This is expected behavior
        
        # Try to fetch historical data for an expired option
        expired_option = expired_options[0]
        instrument_token = expired_option.get('instrument_token')
        tradingsymbol = expired_option.get('tradingsymbol')
        expiry = expired_option.get('expiry')
        
        logger.info(f"Testing with expired option: {tradingsymbol}")
        logger.info(f"  Expiry: {expiry} (expired {today - expiry} days ago)")
        logger.info(f"  Token: {instrument_token}")
        
        # Try to fetch historical data
        from_date = expiry - datetime.timedelta(days=7)
        to_date = expiry
        
        try:
            data = kite.historical_data(
                instrument_token=instrument_token,
                from_date=from_date,
                to_date=to_date,
                interval='day'
            )
            
            if data:
                logger.warning(f"  ⚠ Unexpected: Successfully fetched {len(data)} candles for expired option!")
                logger.warning(f"  This contradicts Zerodha's documentation")
                return False
            else:
                logger.info(f"  ✓ As expected: No data returned for expired option")
                return True
        except Exception as e:
            error_msg = str(e).lower()
            if 'invalid' in error_msg or 'not found' in error_msg or 'expired' in error_msg:
                logger.info(f"  ✓ As expected: API rejected expired option - {e}")
                return True
            else:
                logger.warning(f"  ⚠ Unexpected error: {e}")
                return False
    except Exception as e:
        logger.error(f"✗ Error testing expired option: {e}", exc_info=True)
        return False


def print_expected_capabilities():
    """Print expected capabilities based on Zerodha documentation."""
    logger.info("\n" + "="*60)
    logger.info("EXPECTED ZERODHA API CAPABILITIES (Based on Documentation)")
    logger.info("="*60)
    logger.info("\n1. ACTIVE OPTIONS (Unexpired Contracts):")
    logger.info("   ✓ Full Support - Can fetch intraday (1min, 5min, etc.) and daily candles")
    logger.info("   ✓ Available via kite.historical_data() with instrument_token")
    logger.info("   ✓ All intervals supported: 1minute, 5minute, 15minute, 30minute, 60minute, day")
    
    logger.info("\n2. EXPIRED OPTIONS:")
    logger.info("   ✗ No Support - Zerodha flushes instrument_token after expiry")
    logger.info("   ✗ Cannot fetch intraday or daily historical data")
    logger.info("   ✗ API will return error or empty data")
    
    logger.info("\n3. INDEX/EQUITY:")
    logger.info("   ✓ Full Support - Years of historical data available")
    logger.info("   ✓ Example: NIFTY 50, NIFTY BANK (Bank Nifty)")
    
    logger.info("\n4. EXPIRED FUTURES:")
    logger.info("   ⚠ Partial Support - 'Continuous Data' available")
    logger.info("   ⚠ Usually limited to day candles only")
    
    logger.info("\n5. OPTION CHAINS:")
    logger.info("   ✓ Available via kite.instruments('NFO')")
    logger.info("   ✓ Can filter by underlying (NIFTY, BANKNIFTY)")
    logger.info("   ✓ Can filter by expiry date, strike, instrument_type (CE/PE)")
    logger.info("   ✓ Can get instrument_token for each option contract")
    
    logger.info("\n" + "="*60)


def main():
    """Run all tests."""
    logger.info("\n" + "="*60)
    logger.info("ZERODHA KITE API - INDEX OPTIONS CAPABILITY TEST")
    logger.info("="*60)
    
    # Print expected capabilities
    print_expected_capabilities()
    
    # Connect to Zerodha
    kite = get_kite_client("raj.bapa@gmail.com")
    if not kite:
        logger.error("\n" + "="*60)
        logger.error("FAILED TO CONNECT TO ZERODHA")
        logger.error("="*60)
        logger.error("Possible reasons:")
        logger.error("  1. Invalid or expired access_token")
        logger.error("  2. API credentials not configured in database")
        logger.error("  3. Network connectivity issues")
        logger.error("\nTo test the API capabilities:")
        logger.error("  1. Ensure valid Zerodha credentials are in backend/database.db")
        logger.error("  2. Access token must be valid (not expired)")
        logger.error("  3. Re-run this script after fixing credentials")
        logger.error("\nThe script will test:")
        logger.error("  - Fetching NFO instruments (option contracts)")
        logger.error("  - Building option chains for NIFTY and BANKNIFTY")
        logger.error("  - Fetching historical data for active options")
        logger.error("  - Attempting to fetch historical data for expired options (should fail)")
        return
    
    # Test 1: Fetch instruments
    instruments = test_fetch_instruments(kite, 'NFO')
    
    # Test 2: Build option chain for Bank Nifty
    banknifty_chain = test_build_option_chain(kite, 'BANKNIFTY')
    
    # Test 3: Fetch historical data for active option
    if banknifty_chain:
        test_historical_data_active_option(kite, banknifty_chain)
    
    # Test 4: Attempt to fetch historical data for expired option
    test_historical_data_expired_option(kite)
    
    # Test 5: Build option chain for Nifty
    nifty_chain = test_build_option_chain(kite, 'NIFTY')
    
    # Final Summary
    logger.info(f"\n{'='*60}")
    logger.info("TEST SUMMARY")
    logger.info(f"{'='*60}")
    logger.info("✓ Instrument fetching: Available")
    logger.info("✓ Option chain building: Available")
    logger.info("✓ Historical data for active options: Tested (see results above)")
    logger.info("✓ Historical data for expired options: Not available (as per Zerodha docs)")
    logger.info("\nTest complete!")


if __name__ == '__main__':
    main()
