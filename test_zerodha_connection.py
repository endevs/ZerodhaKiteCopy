"""
Quick test to verify Zerodha API connection by fetching profile and balance
"""
import logging
import sys
import os
from kiteconnect import KiteConnect

# Add backend to path
backend_dir = os.path.join(os.path.dirname(__file__), 'backend')
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

# Set up config before importing database
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
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def test_zerodha_connection():
    """Test Zerodha connection by fetching profile and balance."""
    logger.info("="*60)
    logger.info("Testing Zerodha API Connection")
    logger.info("="*60)
    
    try:
        # Get credentials from database for specific user
        user_email = "raj.bapa@gmail.com"
        logger.info(f"Fetching credentials for user: {user_email}")
        
        conn = get_db_connection()
        cursor = conn.execute(
            'SELECT app_key, app_secret, zerodha_access_token FROM users WHERE email = ? LIMIT 1',
            (user_email,)
        )
        user = cursor.fetchone()
        conn.close()
        
        if not user or not user[0] or not user[1] or not user[2]:
            logger.error(f"✗ Zerodha credentials not found in database for {user_email}")
            return False
        
        api_key = user[0]
        access_token = user[2]
        
        logger.info(f"✓ Found credentials in database")
        logger.info(f"  API Key: {api_key[:10]}...{api_key[-4:]}")
        logger.info(f"  Access Token: {access_token[:10]}...{access_token[-4:]}")
        
        # Connect to Zerodha
        logger.info("\nConnecting to Zerodha...")
        kite = KiteConnect(api_key=api_key, access_token=access_token)
        
        # Test 1: Fetch Profile
        logger.info("\n" + "-"*60)
        logger.info("TEST 1: Fetching User Profile")
        logger.info("-"*60)
        try:
            profile = kite.profile()
            logger.info("✓ Successfully fetched profile!")
            logger.info(f"  User Name: {profile.get('user_name', 'N/A')}")
            logger.info(f"  User ID: {profile.get('user_id', 'N/A')}")
            logger.info(f"  Email: {profile.get('email', 'N/A')}")
            logger.info(f"  User Type: {profile.get('user_type', 'N/A')}")
            logger.info(f"  Broker: {profile.get('broker', 'N/A')}")
        except Exception as e:
            logger.error(f"✗ Failed to fetch profile: {e}")
            return False
        
        # Test 2: Fetch Balance
        logger.info("\n" + "-"*60)
        logger.info("TEST 2: Fetching Account Balance")
        logger.info("-"*60)
        try:
            margins = kite.margins()
            
            # Equity margins
            if 'equity' in margins:
                equity = margins['equity']
                logger.info("✓ Successfully fetched equity margins!")
                logger.info(f"  Available: ₹{equity.get('available', {}).get('cash', 0):,.2f}")
                logger.info(f"  Used: ₹{equity.get('utilised', {}).get('debits', 0):,.2f}")
                logger.info(f"  Net: ₹{equity.get('net', 0):,.2f}")
            
            # Commodity margins
            if 'commodity' in margins:
                commodity = margins['commodity']
                logger.info("\n✓ Successfully fetched commodity margins!")
                logger.info(f"  Available: ₹{commodity.get('available', {}).get('cash', 0):,.2f}")
                logger.info(f"  Used: ₹{commodity.get('utilised', {}).get('debits', 0):,.2f}")
                logger.info(f"  Net: ₹{commodity.get('net', 0):,.2f}")
            
        except Exception as e:
            logger.error(f"✗ Failed to fetch balance: {e}")
            return False
        
        # Test 3: Fetch Holdings (if any)
        logger.info("\n" + "-"*60)
        logger.info("TEST 3: Fetching Holdings")
        logger.info("-"*60)
        try:
            holdings = kite.holdings()
            if holdings:
                logger.info(f"✓ Found {len(holdings)} holdings")
                for i, holding in enumerate(holdings[:5], 1):  # Show first 5
                    logger.info(f"  {i}. {holding.get('tradingsymbol', 'N/A')} - "
                              f"Qty: {holding.get('quantity', 0)}, "
                              f"P&L: ₹{holding.get('pnl', 0):,.2f}")
                if len(holdings) > 5:
                    logger.info(f"  ... and {len(holdings) - 5} more")
            else:
                logger.info("✓ No holdings found (empty portfolio)")
        except Exception as e:
            logger.warning(f"⚠ Could not fetch holdings: {e}")
        
        logger.info("\n" + "="*60)
        logger.info("✓ CONNECTION TEST SUCCESSFUL!")
        logger.info("="*60)
        logger.info("Your Zerodha API credentials are valid and working.")
        return True
        
    except Exception as e:
        logger.error("\n" + "="*60)
        logger.error("✗ CONNECTION TEST FAILED")
        logger.error("="*60)
        logger.error(f"Error: {e}")
        logger.error("\nPossible issues:")
        logger.error("  1. Access token has expired (regenerate from Zerodha Kite Connect)")
        logger.error("  2. Invalid API key or access token")
        logger.error("  3. Network connectivity issues")
        logger.error("  4. Zerodha API service temporarily unavailable")
        return False


if __name__ == '__main__':
    test_zerodha_connection()
