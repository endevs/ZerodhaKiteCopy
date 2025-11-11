
from abc import ABC, abstractmethod

class BaseStrategy(ABC):
    def __init__(self, kite, instrument, candle_time, start_time, end_time, stop_loss, target_profit, total_lot, trailing_stop_loss, segment, trade_type, strike_price, expiry_type, strategy_name_input):
        self.kite = kite
        self.instrument = instrument
        self.candle_time = candle_time
        self.start_time = start_time
        self.end_time = end_time
        self.stop_loss = stop_loss
        self.target_profit = target_profit
        self.total_lot = total_lot
        self.trailing_stop_loss = trailing_stop_loss
        self.segment = segment
        self.trade_type = trade_type
        self.strike_price = strike_price
        self.expiry_type = expiry_type
        self.strategy_name_input = strategy_name_input

    @abstractmethod
    def run(self):
        pass
