"""
Rule Executor - Executes rule actions
"""
from typing import Dict, Any, Optional
import logging
from ..rules.rules_parser import Rule, Action
from .rule_context import RuleContext

logger = logging.getLogger(__name__)


class RuleExecutor:
    """Executes rule actions"""
    
    def __init__(self):
        self.action_handlers = {
            "set": self._execute_set,
            "replace": self._execute_replace,
            "clear": self._execute_clear,
            "log": self._execute_log,
            "select": self._execute_select,
            "trade_execution": self._execute_trade_execution,
            "exit_reason": self._execute_exit_reason,
        }
    
    def execute_rule(self, rule: Rule, context: RuleContext) -> Dict[str, Any]:
        """Execute all THEN actions"""
        results = {}
        
        if not rule.then_actions:
            return results
        
        for action in rule.then_actions:
            action_result = self._execute_action(action, context)
            if action_result:
                results.update(action_result)
        
        return results
    
    def _execute_action(self, action: Action, context: RuleContext) -> Optional[Dict[str, Any]]:
        """Execute a single action"""
        handler = self.action_handlers.get(action.type)
        if handler:
            return handler(action, context)
        
        logger.warning(f"Unknown action type: {action.type}")
        return None
    
    def _execute_set(self, action: Action, context: RuleContext) -> Dict[str, Any]:
        """Execute set action"""
        if not action.target or not action.value:
            return {}
        
        target = action.target.strip()
        value = self._resolve_value(action.value, context)
        
        if target.startswith("signal."):
            property_name = target.split(".")[1]
            if context.signal is None:
                context.signal = {}
            context.signal[property_name] = value
            return {"signal": context.signal.copy()}
        
        elif target.startswith("state."):
            property_name = target.split(".")[1]
            context.set_state(property_name, value)
            return {"state": {property_name: value}}
        
        elif target == "pe_signal_price_above_low":
            context.set_state("pe_signal_price_above_low", value)
            return {"state": {"pe_signal_price_above_low": value}}
        
        return {}
    
    def _execute_replace(self, action: Action, context: RuleContext) -> Dict[str, Any]:
        """Execute replace action (similar to set)"""
        return self._execute_set(action, context)
    
    def _execute_clear(self, action: Action, context: RuleContext) -> Dict[str, Any]:
        """Execute clear action"""
        if action.target == "signal":
            context.signal = None
            return {"signal": None}
        
        # Clear state variable
        if action.target.startswith("state."):
            property_name = action.target.split(".")[1]
            context.set_state(property_name, None)
            return {"state": {property_name: None}}
        
        return {}
    
    def _execute_log(self, action: Action, context: RuleContext) -> Dict[str, Any]:
        """Execute log action"""
        if not action.value:
            return {}
        
        log_message = self._resolve_template(action.value, context)
        logger.info(log_message)
        return {"log": log_message}
    
    def _execute_select(self, action: Action, context: RuleContext) -> Dict[str, Any]:
        """Execute select action (option contract selection)"""
        # This will be handled by entry_manager
        # Just log that option selection is needed
        logger.info(f"Option contract selection required: {action.value}")
        return {"action": "select_option", "details": action.value}
    
    def _execute_trade_execution(self, action: Action, context: RuleContext) -> Dict[str, Any]:
        """Execute trade_execution action"""
        # This will be handled by entry_manager
        # Just log that trade execution is needed
        logger.info(f"Trade execution required: {action.value}")
        return {"action": "execute_trade", "details": action.value}
    
    def _execute_exit_reason(self, action: Action, context: RuleContext) -> Dict[str, Any]:
        """Execute exit_reason action"""
        return {"exit_reason": action.value}
    
    def _resolve_value(self, value_str: str, context: RuleContext) -> Any:
        """Resolve value string to actual value (similar to evaluator)"""
        if not value_str:
            return None
        
        value_str = value_str.strip()
        
        # Handle "candle.low", "candle.close", etc.
        if value_str.startswith("candle."):
            property_name = value_str.split(".")[1]
            return context.candle.get(property_name)
        
        # Handle "signal.high", "signal.low", etc.
        elif value_str.startswith("signal."):
            if not context.signal:
                return None
            property_name = value_str.split(".")[1]
            return context.signal.get(property_name)
        
        # Handle "ema(5)"
        elif value_str.startswith("ema("):
            return context.ema5
        
        # Handle "rsi(14)"
        elif value_str.startswith("rsi("):
            return context.rsi14
        
        # Handle boolean strings
        elif value_str.lower() == "true":
            return True
        elif value_str.lower() == "false":
            return False
        
        # Handle "PE", etc.
        elif value_str == "PE":
            return "PE"
        
        # Try to parse as number
        try:
            if value_str.replace('.', '').replace('-', '').isdigit():
                return float(value_str) if '.' in value_str else int(value_str)
        except ValueError:
            pass
        
        # Return as string
        return value_str
    
    def _resolve_template(self, template: str, context: RuleContext) -> str:
        """Resolve template string with context variables"""
        if not template:
            return ""
        
        # Replace {signal.time}, {signal.high}, {signal.low}, etc.
        result = template
        
        # Replace signal variables
        if context.signal:
            for key, value in context.signal.items():
                result = result.replace(f"{{{key}}}", str(value))
                result = result.replace(f"{{signal.{key}}}", str(value))
        
        # Replace entry variables
        if context.active_trade:
            for key, value in context.active_trade.items():
                result = result.replace(f"{{{key}}}", str(value))
        
        # Replace common variables
        result = result.replace("{entry_price}", str(context.active_trade.get("entry_price", "")) if context.active_trade else "")
        result = result.replace("{option_symbol}", str(context.active_trade.get("option_symbol", "")) if context.active_trade else "")
        result = result.replace("{option_exit_price}", str(context.active_trade.get("option_exit_price", "")) if context.active_trade else "")
        result = result.replace("{exit_price}", str(context.candle.get("close", "")))
        
        return result
