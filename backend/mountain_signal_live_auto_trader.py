"""
Mountain Signal Live Auto-Trader – tick-driven strategy that runs on the backend.
Places entry/exit orders when conditions are met. Continues running when user switches away.
"""

import datetime
import logging
from typing import Any, Callable, Dict, List, Optional

TOKEN_NIFTY = 256265
TOKEN_BANKNIFTY = 260105


def _time_str(dt: datetime.datetime) -> str:
    if isinstance(dt, str):
        return dt
    return dt.isoformat()


def _parse_time(t) -> datetime.datetime:
    if isinstance(t, datetime.datetime):
        return t
    if isinstance(t, str):
        return datetime.datetime.fromisoformat(t.replace("Z", "+00:00"))
    return datetime.datetime.fromtimestamp(t)


def _floor_to_interval(dt: datetime.datetime, minutes: int) -> datetime.datetime:
    m = (dt.minute // minutes) * minutes
    return dt.replace(minute=m, second=0, microsecond=0)


def _compute_ema(closes: List[float], period: int) -> List[Optional[float]]:
    if len(closes) < period:
        return [None] * len(closes)
    result: List[Optional[float]] = [None] * (period - 1)
    mult = 2.0 / (period + 1)
    ema = sum(closes[:period]) / period
    result.append(ema)
    for i in range(period, len(closes)):
        ema = (closes[i] - ema) * mult + ema
        result.append(ema)
    return result


def _compute_rsi(closes: List[float], period: int = 14) -> List[Optional[float]]:
    if len(closes) < period + 1:
        return [None] * len(closes)
    result: List[Optional[float]] = [None] * period
    gains: List[float] = []
    losses: List[float] = []
    for i in range(1, len(closes)):
        diff = closes[i] - closes[i - 1]
        gains.append(max(0, diff))
        losses.append(max(0, -diff))
    for i in range(period - 1, len(gains)):
        avg_gain = sum(gains[i - period + 1 : i + 1]) / period
        avg_loss = sum(losses[i - period + 1 : i + 1]) / period
        if avg_loss == 0:
            rsi = 100.0
        else:
            rs = avg_gain / avg_loss
            rsi = 100.0 - (100.0 / (1 + rs))
        result.append(rsi)
    return result


class MountainSignalLiveAutoTrader:
    """
    Tick-driven Mountain Signal strategy. Builds 5m candles from ticks,
    evaluates entry/exit, and calls place_order / square_off callbacks.
    """

    def __init__(
        self,
        user_id: int,
        instrument: str,
        lots: int,
        rsi_overbought: float = 70.0,
        rsi_oversold: float = 30.0,
        place_order_fn: Optional[Callable[[int, str, int, float], Optional[str]]] = None,
        square_off_fn: Optional[Callable[[int], bool]] = None,
    ):
        self.user_id = user_id
        self.instrument = (instrument or "BANKNIFTY").strip().upper()
        if self.instrument not in ("NIFTY", "BANKNIFTY"):
            self.instrument = "BANKNIFTY"
        self.lots = max(1, int(lots))
        self.rsi_overbought = float(rsi_overbought or 70)
        self.rsi_oversold = float(rsi_oversold or 30)
        self.place_order_fn = place_order_fn
        self.square_off_fn = square_off_fn

        self.instrument_token = TOKEN_NIFTY if self.instrument == "NIFTY" else TOKEN_BANKNIFTY

        # Candle buffer: list of {time, open, high, low, close}
        self._candles: List[Dict[str, Any]] = []
        self._current_candle: Optional[Dict[str, Any]] = None
        self._candle_minutes = 5

        # Strategy state (matches frontend runMountainBacktest)
        self._signal: Optional[Dict[str, Any]] = None
        self._trade: Optional[Dict[str, Any]] = None
        self._entered_indices: set = set()
        self._candles_since_exit: List[Dict[str, Any]] = []
        self._last_exit_time: Optional[datetime.datetime] = None
        self._prev_day: Optional[str] = None
        self._high_dropped_below_ema = False
        self._consecutive_close_above_ema = 0

        self.status = {
            "state": "running",
            "message": "Auto-trade active, monitoring for signals",
            "instrument": self.instrument,
            "lots": self.lots,
        }

    def load_initial_candles(self, candles: List[Dict[str, Any]]) -> None:
        """Bootstrap with historical candles (from warmup fetch)."""
        for row in candles:
            ts = row.get("timestamp") or row.get("time") or row.get("date")
            if not ts:
                continue
            if isinstance(ts, str):
                try:
                    dt = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
                except ValueError:
                    continue
            else:
                dt = ts
            self._candles.append({
                "time": dt,
                "open": float(row.get("open", 0) or 0),
                "high": float(row.get("high", 0) or 0),
                "low": float(row.get("low", 0) or 0),
                "close": float(row.get("close", 0) or 0),
            })
        if self._candles:
            logging.info("[MountainSignalLiveAutoTrader] Loaded %d initial candles for user %s", len(self._candles), self.user_id)

    def process_ticks(self, ticks: List[Dict[str, Any]]) -> None:
        if not ticks or not self.place_order_fn or not self.square_off_fn:
            return

        relevant = [t for t in ticks if t.get("instrument_token") == self.instrument_token]
        if not relevant:
            return

        latest = relevant[-1]
        price = latest.get("last_price")
        if price is None:
            return

        ts = latest.get("timestamp") or latest.get("last_trade_time") or latest.get("exchange_timestamp")
        if not ts:
            return

        if isinstance(ts, (int, float)):
            tick_dt = datetime.datetime.fromtimestamp(ts)
        elif isinstance(ts, str):
            try:
                tick_dt = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
            except ValueError:
                tick_dt = datetime.datetime.now()
        else:
            tick_dt = ts

        slot_start = _floor_to_interval(tick_dt, self._candle_minutes)
        day_key = f"{slot_start.year}-{slot_start.month}-{slot_start.day}"

        # New day reset
        if self._prev_day is not None and self._prev_day != day_key:
            if self._signal and not self._trade:
                self._signal = None
                self._entered_indices = set()
        self._prev_day = day_key

        # Market close (15:15)
        if tick_dt.hour > 15 or (tick_dt.hour == 15 and tick_dt.minute >= 15):
            if self._signal and not self._trade:
                self._signal = None
                self._entered_indices = set()
            if self._trade:
                try:
                    self.square_off_fn(self.user_id)
                    self._trade = None
                    self._signal = None
                    self._last_exit_time = tick_dt
                    self._candles_since_exit = []
                    self._entered_indices = set()
                except Exception as e:
                    logging.warning("[MountainSignalLiveAutoTrader] Square-off failed: %s", e)
            return

        # Update or create candle
        candle_just_completed = False
        if self._current_candle is None or self._current_candle.get("time") != slot_start:
            if self._current_candle is not None:
                self._candles.append(dict(self._current_candle))
                candle_just_completed = True
            self._current_candle = {
                "time": slot_start,
                "open": price,
                "high": price,
                "low": price,
                "close": price,
            }
        else:
            self._current_candle["high"] = max(self._current_candle["high"], price)
            self._current_candle["low"] = min(self._current_candle["low"], price)
            self._current_candle["close"] = price

        # Only evaluate strategy when a candle has just completed (avoid duplicate orders)
        if not candle_just_completed:
            return

        # Need enough candles for EMA/RSI
        all_candles = list(self._candles)
        if len(all_candles) < 15:
            return

        closes = [c["close"] for c in all_candles]
        ema5 = _compute_ema(closes, 5)
        rsi14 = _compute_rsi(closes, 14)

        if ema5[-1] is None or rsi14[-1] is None:
            return

        c = all_candles[-1]
        e5 = ema5[-1]
        r14 = rsi14[-1]
        candle_time = c["time"] if isinstance(c["time"], datetime.datetime) else _parse_time(c["time"])

        # Limit candle history to avoid unbounded growth
        if len(self._candles) > 500:
            self._candles = self._candles[-500:]

        # Exit evaluation
        if self._trade:
            at = self._trade
            sig = at["signal_snapshot"]

            if c["close"] > sig["high"]:
                try:
                    self.square_off_fn(self.user_id)
                except Exception as e:
                    logging.warning("[MountainSignalLiveAutoTrader] Exit (INDEX_STOP) failed: %s", e)
                self._trade = None
                self._signal = None
                self._last_exit_time = candle_time
                self._candles_since_exit = []
                self._entered_indices = set()
                self._high_dropped_below_ema = False
                self._consecutive_close_above_ema = 0
                return

            if c["high"] < e5:
                self._high_dropped_below_ema = True
                self._consecutive_close_above_ema = 0
            elif self._high_dropped_below_ema and c["close"] > e5:
                self._consecutive_close_above_ema += 1
                if self._consecutive_close_above_ema >= 2:
                    try:
                        self.square_off_fn(self.user_id)
                    except Exception as e:
                        logging.warning("[MountainSignalLiveAutoTrader] Exit (INDEX_TARGET) failed: %s", e)
                    self._trade = None
                    self._signal = None
                    self._last_exit_time = candle_time
                    self._candles_since_exit = []
                    self._entered_indices = set()
                    self._high_dropped_below_ema = False
                    self._consecutive_close_above_ema = 0
                return
            else:
                if self._high_dropped_below_ema:
                    self._consecutive_close_above_ema = 0
            return

        # Track candles since exit for re-entry
        if self._last_exit_time is not None:
            self._candles_since_exit.append(c)

        # Signal management
        low_above_ema = c["low"] > e5
        rsi_overbought = r14 > self.rsi_overbought

        sig_key = _time_str(candle_time)
        if self._signal is None:
            if low_above_ema and rsi_overbought:
                self._signal = {"high": c["high"], "low": c["low"], "time": sig_key, "candle_key": sig_key}
        else:
            if low_above_ema and rsi_overbought:
                self._signal = {"high": c["high"], "low": c["low"], "time": sig_key, "candle_key": sig_key}
            elif not low_above_ema and not rsi_overbought:
                self._try_entry(c, all_candles, e5, r14)
                if not self._trade:
                    self._signal = None

        # Entry evaluation
        if not self._trade and self._signal is not None:
            self._try_entry(c, all_candles, e5, r14)

    def _try_entry(self, c: Dict[str, Any], all_candles: List[Dict], e5: float, r14: float) -> None:
        if c["close"] >= self._signal["low"]:
            return

        sig_key = self._signal.get("candle_key", self._signal.get("time", ""))
        is_first = sig_key not in self._entered_indices

        if is_first:
            entry_allowed = True
        else:
            highest = max((cc["high"] for cc in self._candles_since_exit), default=-1)
            entry_allowed = highest > self._signal["low"]

        if not entry_allowed:
            return

        index_ltp = float(c["close"])
        try:
            order_id = self.place_order_fn(self.user_id, self.instrument, self.lots, index_ltp)
            if order_id:
                self._trade = {
                    "entry_price": index_ltp,
                    "entry_time": _time_str(c.get("time", datetime.datetime.now())),
                    "signal_snapshot": dict(self._signal),
                }
                self._entered_indices.add(sig_key)
                self._candles_since_exit = []
                self.status["message"] = f"Entry placed @ {index_ltp:.2f}"
                logging.info("[MountainSignalLiveAutoTrader] Entry placed for user %s: %s lots @ %.2f", self.user_id, self.lots, index_ltp)
        except Exception as e:
            logging.warning("[MountainSignalLiveAutoTrader] Entry failed: %s", e)
