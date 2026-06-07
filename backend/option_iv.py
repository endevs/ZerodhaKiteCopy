"""
Implied volatility from option LTP via Black-Scholes (European approximation).
"""
from __future__ import annotations

import math
from typing import Literal, Optional

OptionType = Literal["CE", "PE"]


def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def black_scholes_price(
    spot: float,
    strike: float,
    time_years: float,
    vol: float,
    option_type: OptionType,
    rate: float = 0.07,
) -> float:
    if spot <= 0 or strike <= 0 or time_years <= 0 or vol <= 0:
        return 0.0
    sqrt_t = math.sqrt(time_years)
    d1 = (math.log(spot / strike) + (rate + 0.5 * vol * vol) * time_years) / (vol * sqrt_t)
    d2 = d1 - vol * sqrt_t
    if option_type == "CE":
        return spot * _norm_cdf(d1) - strike * math.exp(-rate * time_years) * _norm_cdf(d2)
    return strike * math.exp(-rate * time_years) * _norm_cdf(-d2) - spot * _norm_cdf(-d1)


def implied_volatility(
    price: float,
    spot: float,
    strike: float,
    expiry_days: float,
    option_type: OptionType,
    rate: float = 0.07,
) -> Optional[float]:
    if price <= 0 or spot <= 0 or strike <= 0 or expiry_days <= 0:
        return None
    time_years = max(expiry_days / 365.0, 1.0 / (365.0 * 24.0))
    intrinsic = max(0.0, spot - strike) if option_type == "CE" else max(0.0, strike - spot)
    if price <= intrinsic + 0.01:
        return None

    low, high = 0.01, 3.0
    for _ in range(60):
        mid = (low + high) / 2.0
        model = black_scholes_price(spot, strike, time_years, mid, option_type, rate)
        if model > price:
            high = mid
        else:
            low = mid
    vol = (low + high) / 2.0
    if vol < 0.02 or vol > 2.5:
        return None
    return round(vol * 100.0, 2)
