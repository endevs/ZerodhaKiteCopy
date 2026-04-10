"""
Rule Context - Data structure for rule evaluation
"""
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List, Set
from datetime import datetime


@dataclass
class RuleContext:
    """Context data passed to rule evaluators"""
    
    # Candle data
    candle: Dict[str, Any]  # open, high, low, close, time, index, start_time
    
    # Indicators
    ema5: float
    rsi14: float
    
    # Signal state
    signal: Optional[Dict[str, Any]] = None  # type, low, high, time, candle_index
    
    # Trade state
    active_trade: Optional[Dict[str, Any]] = None  # entry_price, entry_time, option_entry_price, etc.
    
    # Strategy state
    state: Dict[str, Any] = field(default_factory=dict)  # pe_signal_price_above_low, entry_history, etc.
    
    # Historical data (for validation)
    last_exit_time: Optional[datetime] = None
    candles_since_exit: List[Dict[str, Any]] = field(default_factory=list)  # For highest high check
    
    # Configuration
    config: Dict[str, Any] = field(default_factory=dict)  # instrument_config, etc.
    
    def get_state(self, key: str, default: Any = None) -> Any:
        """Get state value"""
        return self.state.get(key, default) if self.state else default
    
    def set_state(self, key: str, value: Any):
        """Set state value"""
        if self.state is None:
            self.state = {}
        self.state[key] = value
    
    def update_state(self, updates: Dict[str, Any]):
        """Update multiple state values"""
        if self.state is None:
            self.state = {}
        self.state.update(updates)
