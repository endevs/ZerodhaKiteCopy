"""
Helper Functions
"""
from typing import Optional
from datetime import datetime, date
import math


def round_to_strike(price: float, instrument_key: str) -> int:
    """
    Round price to nearest strike based on instrument
    
    Args:
        price: Current index price
        instrument_key: Instrument key (BANKNIFTY or NIFTY)
    
    Returns:
        Rounded strike price
    """
    from .config import INSTRUMENT_CONFIG
    
    strike_step = INSTRUMENT_CONFIG.get(instrument_key, {}).get('strike_step', 50)
    
    if strike_step <= 0:
        return int(round(price))
    
    return int(round(price / strike_step) * strike_step)


def get_option_symbol(index_price: float, strike: int, option_type: str, 
                      expiry_date: date, instrument_key: str = "BANKNIFTY") -> str:
    """
    Generate option symbol string
    
    Args:
        index_price: Current index price
        strike: Strike price
        option_type: Option type ('PE' or 'CE')
        expiry_date: Expiry date
        instrument_key: Instrument key (BANKNIFTY or NIFTY)
    
    Returns:
        Option symbol string
    """
    # Format: BANKNIFTY YYMMDD STRIKE PE/CE
    # Example: BANKNIFTY 260130 50000 PE
    
    expiry_str = expiry_date.strftime("%y%m%d")
    symbol = f"{instrument_key} {expiry_str} {strike} {option_type}"
    
    return symbol


def simulate_option_premium(index_price: float, strike: int, option_type: str) -> float:
    """
    Simulate option premium (simplified model for backtesting)
    
    Args:
        index_price: Current index price
        strike: Strike price
        option_type: Option type ('PE' or 'CE')
    
    Returns:
        Simulated option premium
    """
    # Simplified Black-Scholes-like calculation for backtesting
    # This is a placeholder - in production, use actual option pricing
    
    intrinsic_value = abs(index_price - strike)
    time_value = intrinsic_value * 0.02  # Simplified time value
    
    # Minimum premium
    min_premium = 50.0
    
    premium = max(intrinsic_value + time_value, min_premium)
    
    # Round to 2 decimal places
    return round(premium, 2)


def calculate_pnl(entry_price: float, exit_price: float, lot_size: int, position_type: int) -> tuple:
    """
    Calculate P&L for a trade
    
    Args:
        entry_price: Entry price
        exit_price: Exit price
        lot_size: Lot size
        position_type: Position type (-1 for PE/short, 1 for CE/long)
    
    Returns:
        Tuple of (pnl, pnl_percent)
    """
    if position_type == -1:  # PE (short)
        pnl = (entry_price - exit_price) * lot_size
        # For SHORT: profit when price goes down (entry > exit)
        # P&L % = (entry - exit) / entry * 100
        pnl_percent = ((entry_price - exit_price) / entry_price) * 100 if entry_price > 0 else 0
    else:  # CE (long)
        pnl = (exit_price - entry_price) * lot_size
        # For LONG: profit when price goes up (exit > entry)
        # P&L % = (exit - entry) / entry * 100
        pnl_percent = ((exit_price - entry_price) / entry_price) * 100 if entry_price > 0 else 0
    
    return pnl, pnl_percent


def format_datetime(dt: datetime) -> str:
    """Format datetime to string"""
    if isinstance(dt, datetime):
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    return str(dt)
