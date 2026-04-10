"""
Index constituent lists and token resolution for Moirai 2.0 constituent-based prediction.
NSE tradingsymbols for NIFTY 50 and Nifty Bank index constituents.
"""
import logging
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# Index tokens (Zerodha Kite)
INDEX_TOKENS = {"NIFTY": 256265, "BANKNIFTY": 260105}

# Nifty Bank: 14 constituents (SEBI expanded from 12 in 2025)
NIFTY_BANK_CONSTITUENTS = [
    "HDFCBANK",
    "ICICIBANK",
    "SBIN",
    "KOTAKBANK",
    "AXISBANK",
    "INDUSINDBK",
    "AUBANK",
    "BANKBARODA",
    "FEDERALBNK",
    "PNBBANK",
    "CANBK",
    "IDFCFIRSTB",
    "UNIONBANK",
    "YESBANK",
]

# NSE symbol aliases: our list symbol -> NSE tradingsymbol (Kite uses NSE symbols)
NSE_SYMBOL_ALIASES = {
    "ULTRATECHCEM": "ULTRACEMCO",   # UltraTech Cement
    "MAXHEALTHCARE": "MAXHEALTH",   # Max Healthcare Institute
    "TATAMOTORS": "TATAMTRS",       # Tata Motors (if NSE uses TATAMTRS)
}

# Approximate NSE free-float weights for BankNifty (update at rebalancing; Jan 2025)
BANKNIFTY_WEIGHTS: Dict[str, float] = {
    "HDFCBANK": 0.39,
    "ICICIBANK": 0.27,
    "AXISBANK": 0.09,
    "SBIN": 0.09,
    "KOTAKBANK": 0.08,
    "INDUSINDBK": 0.02,
    "FEDERALBNK": 0.015,
    "BANKBARODA": 0.013,
    "PNBBANK": 0.01,
    "AUBANK": 0.01,
    "CANBK": 0.008,
    "IDFCFIRSTB": 0.006,
    "UNIONBANK": 0.005,
    "YESBANK": 0.004,
}


# Nifty 50: 50 constituents (update semi-annually; as of early 2025)
NIFTY_50_CONSTITUENTS = [
    "ADANIENT",
    "ADANIPORTS",
    "APOLLOHOSP",
    "ASIANPAINT",
    "AXISBANK",
    "BAJAJ-AUTO",
    "BAJFINANCE",
    "BAJAJFINSV",
    "BEL",
    "BHARTIARTL",
    "CIPLA",
    "COALINDIA",
    "DIVISLAB",
    "DRREDDY",
    "EICHERMOT",
    "GRASIM",
    "HCLTECH",
    "HDFCBANK",
    "HDFCLIFE",
    "HEROMOTOCO",
    "HINDALCO",
    "HINDUNILVR",
    "ICICIBANK",
    "INDUSINDBK",
    "INFY",
    "ITC",
    "JSWSTEEL",
    "JIOFIN",
    "KOTAKBANK",
    "LT",
    "M&M",
    "MARUTI",
    "NESTLEIND",
    "NTPC",
    "ONGC",
    "POWERGRID",
    "RELIANCE",
    "SBILIFE",
    "SBIN",
    "SHRIRAMFIN",
    "SUNPHARMA",
    "TATAMOTORS",
    "TATASTEEL",
    "TCS",
    "TITAN",
    "ULTRATECHCEM",
    "WIPRO",
    "BRITANNIA",
    "INDIGO",
    "MAXHEALTHCARE",
]


def get_constituent_symbols(index: str) -> List[str]:
    """Return list of constituent tradingsymbols for the given index."""
    idx = (index or "").strip().upper()
    if idx == "BANKNIFTY":
        return NIFTY_BANK_CONSTITUENTS.copy()
    if idx == "NIFTY":
        return NIFTY_50_CONSTITUENTS.copy()
    return []


def get_constituent_weights(index: str) -> Dict[str, float]:
    """Return constituent weight (0-1) for the given index. BANKNIFTY only; NIFTY returns empty."""
    idx = (index or "").strip().upper()
    if idx == "BANKNIFTY":
        return dict(BANKNIFTY_WEIGHTS)
    return {}


def get_index_token(index: str) -> Optional[int]:
    """Return instrument token for the index."""
    return INDEX_TOKENS.get((index or "").strip().upper())


def get_constituent_tokens(kite, index: str) -> Dict[str, int]:
    """
    Resolve instrument tokens for index constituents from Kite.
    Returns {tradingsymbol: instrument_token} for NSE stocks.
    Uses NSE_SYMBOL_ALIASES for symbols that differ between NSE and our list.
    """
    symbols = get_constituent_symbols(index)
    if not symbols:
        return {}

    try:
        instruments = kite.instruments("NSE")
    except Exception as e:
        logger.warning("Failed to fetch NSE instruments for constituents: %s", e)
        return {}

    # Build lookup: NSE tradingsymbol -> our list symbol
    nse_to_ours = {s: s for s in symbols}
    for ours, nse in NSE_SYMBOL_ALIASES.items():
        if ours in symbols:
            nse_to_ours[nse] = ours

    result = {}
    for inst in instruments:
        ts = inst.get("tradingsymbol")
        if ts in nse_to_ours:
            token = inst.get("instrument_token")
            if token is not None:
                result[nse_to_ours[ts]] = token

    if len(result) < len(symbols):
        missing = set(symbols) - set(result.keys())
        logger.info("Constituent tokens: resolved %d/%d; missing: %s", len(result), len(symbols), missing)
    return result
