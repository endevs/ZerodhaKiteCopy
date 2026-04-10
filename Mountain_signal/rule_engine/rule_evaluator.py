"""
Rule Evaluator - Evaluates rule conditions against context
"""
from typing import Dict, Any, Optional
from ..rules.rules_parser import Rule, Condition
from .rule_context import RuleContext
from datetime import datetime


class RuleEvaluator:
    """Evaluates rule conditions against context"""
    
    def evaluate_rule(self, rule: Rule, context: RuleContext) -> bool:
        """Evaluate if all WHEN conditions are met"""
        # #region agent log - DISABLED for performance
        # DEBUG_LOGGING = False  # Set to True only when debugging
        # if DEBUG_LOGGING:
        #     import json
        #     import os
        #     try:
        #         log_dir = r'd:\WorkSpace\ZerodhaKiteGit\.cursor'
        #         os.makedirs(log_dir, exist_ok=True)
        #         log_file = os.path.join(log_dir, 'debug.log')
        #         with open(log_file, 'a', encoding='utf-8') as f:
        #             f.write(json.dumps({'location': 'rule_evaluator.py:13', 'message': 'evaluate_rule entry', 'data': {'rule_name': rule.rule_name, 'rule_type': rule.rule_type, 'num_when_conditions': len(rule.when_conditions) if rule.when_conditions else 0}, 'timestamp': int(datetime.now().timestamp() * 1000), 'sessionId': 'debug-session', 'runId': 'run1', 'hypothesisId': 'H3'}) + '\n')
        #     except Exception as e:
        #         pass
        # #endregion
        
        if not rule.when_conditions:
            return True  # No conditions = always true
        
        result = None
        last_connector = None
        
        for i, condition in enumerate(rule.when_conditions):
            condition_result = self._evaluate_condition(condition, context)
            
            # #region agent log - DISABLED for performance
            # if DEBUG_LOGGING:
            #     try:
            #         log_file = os.path.join(r'd:\WorkSpace\ZerodhaKiteGit\.cursor', 'debug.log')
            #         with open(log_file, 'a', encoding='utf-8') as f:
            #             f.write(json.dumps({'location': 'rule_evaluator.py:24', 'message': 'condition evaluated', 'data': {'rule_name': rule.rule_name, 'condition_idx': i, 'condition_raw': condition.raw[:80] if condition.raw else '', 'condition_type': condition.type, 'result': condition_result, 'connector': last_connector}, 'timestamp': int(datetime.now().timestamp() * 1000), 'sessionId': 'debug-session', 'runId': 'run1', 'hypothesisId': 'H3'}) + '\n')
            #     except Exception as e:
            #         pass
            # #endregion
            
            # First condition
            if result is None:
                result = condition_result
            # Subsequent conditions with connector
            elif last_connector == "AND":
                result = result and condition_result
            elif last_connector == "OR":
                result = result or condition_result
            else:
                # Default to AND if no connector
                result = result and condition_result
            
            # Store connector for next iteration
            last_connector = condition.connector
        
        final_result = result if result is not None else True
        
        # #region agent log - DISABLED for performance
        # if DEBUG_LOGGING:
        #     try:
        #         log_file = os.path.join(r'd:\WorkSpace\ZerodhaKiteGit\.cursor', 'debug.log')
        #         with open(log_file, 'a', encoding='utf-8') as f:
        #             f.write(json.dumps({'location': 'rule_evaluator.py:39', 'message': 'evaluate_rule exit', 'data': {'rule_name': rule.rule_name, 'final_result': final_result}, 'timestamp': int(datetime.now().timestamp() * 1000), 'sessionId': 'debug-session', 'runId': 'run1', 'hypothesisId': 'H3'}) + '\n')
        #     except Exception as e:
        #         pass
        # #endregion
        
        return final_result
    
    def _evaluate_condition(self, condition: Condition, context: RuleContext) -> bool:
        """Evaluate a single condition"""
        if condition.type == "comparison":
            return self._evaluate_comparison(condition, context)
        elif condition.type == "state_check":
            return self._evaluate_state_check(condition, context)
        elif condition.type == "time_check":
            return self._evaluate_time_check(condition, context)
        elif condition.type == "time_comparison":
            return self._evaluate_time_comparison(condition, context)
        else:
            # Fallback evaluation
            return self._evaluate_raw(condition, context)
    
    def _evaluate_comparison(self, condition: Condition, context: RuleContext) -> bool:
        """Evaluate comparison condition"""
        left = self._resolve_value(condition.left_operand, context)
        right = self._resolve_value(condition.right_operand, context)
        
        # #region agent log - DISABLED for performance
        # DEBUG_LOGGING = False  # Set to True only when debugging
        # if DEBUG_LOGGING:
        #     import json
        #     import os
        #     try:
        #         log_file = os.path.join(r'd:\WorkSpace\ZerodhaKiteGit\.cursor', 'debug.log')
        #         with open(log_file, 'a', encoding='utf-8') as f:
        #             f.write(json.dumps({'location': 'rule_evaluator.py:55', 'message': 'evaluating comparison', 'data': {'left_operand': condition.left_operand, 'right_operand': condition.right_operand, 'operator': condition.operator, 'left_value': left, 'right_value': right, 'left_is_none': left is None, 'right_is_none': right is None}, 'timestamp': int(datetime.now().timestamp() * 1000), 'sessionId': 'debug-session', 'runId': 'run1', 'hypothesisId': 'H2'}) + '\n')
        #     except Exception as e:
        #         pass
        # #endregion
        
        if left is None or right is None:
            return False
        
        # Convert to float if both are numeric (handle string representations of numbers)
        # This fixes TypeError when comparing strings to floats (e.g., "50.0" < 41.5)
        # Skip datetime and other non-numeric types - they have separate comparison methods
        from datetime import datetime, date, time
        
        # If either is a datetime/date/time, don't convert to float
        is_datetime_comparison = isinstance(left, (datetime, date, time)) or isinstance(right, (datetime, date, time))
        
        if not is_datetime_comparison:
            # Try to convert both to float for numeric comparison
            # This handles cases where one is a string representation of a number
            try:
                # Always try to convert both to float - this handles strings, ints, floats, etc.
                left = float(left)
                right = float(right)
                
                # Verify both are actually floats after conversion
                if not isinstance(left, (int, float)) or not isinstance(right, (int, float)):
                    # Conversion succeeded but result is not numeric - shouldn't happen, but handle it
                    return False
            except (ValueError, TypeError, AttributeError):
                # If conversion fails for either value, we can't do numeric comparison
                # Return False for invalid comparisons rather than raising an error
                return False
        
        # Now perform the comparison - both values should be compatible types (floats)
        try:
            if condition.operator in ["is above", "is greater than", "rises above"]:
                return float(left) > float(right)
            elif condition.operator in ["falls below", "drops below"]:
                return float(left) < float(right)
            elif condition.operator == "is or below":
                return float(left) <= float(right)
            elif condition.operator == "equals" or condition.operator == "is":
                return float(left) == float(right)
        except (TypeError, ValueError):
            # If types are still incompatible, return False (invalid comparison)
            # This should not happen after our conversion, but we handle it gracefully
            return False
        
        return False
    
    def _evaluate_state_check(self, condition: Condition, context: RuleContext) -> bool:
        """Evaluate state check condition"""
        operand = condition.left_operand.strip()
        
        if operand == "no_active_trade":
            return context.active_trade is None
        elif operand == "existing signal.type":
            # Special check for "existing signal.type is PE"
            return context.signal is not None and context.signal.get('type') == 'PE'
        elif operand == "signal.type":
            return context.signal is not None and context.signal.get('type') == 'PE'
        else:
            # Check state dictionary
            state_value = context.get_state(operand)
            expected_value = self._resolve_value(condition.right_operand, context) if condition.right_operand else True
            return state_value == expected_value
        
        return False
    
    def _evaluate_time_check(self, condition: Condition, context: RuleContext) -> bool:
        """Evaluate time check condition"""
        if condition.operator == "is at or after":
            # Parse time like "15:15"
            try:
                target_time = datetime.strptime(condition.right_operand, "%H:%M").time()
                candle_time_obj = context.candle.get('time')
                
                if isinstance(candle_time_obj, datetime):
                    candle_time = candle_time_obj.time()
                elif hasattr(candle_time_obj, 'time'):
                    candle_time = candle_time_obj.time()
                else:
                    # Try to parse string
                    candle_time = datetime.strptime(str(candle_time_obj), "%H:%M:%S").time()
                
                return candle_time >= target_time
            except (ValueError, AttributeError):
                return False
        
        return False
    
    def _evaluate_time_comparison(self, condition: Condition, context: RuleContext) -> bool:
        """Evaluate time comparison"""
        if "is after" in condition.raw:
            left = self._resolve_value(condition.left_operand, context)
            right = self._resolve_value(condition.right_operand, context)
            
            # If right is None (e.g., last_exit_time is None), treat as "no constraint" = True
            # This means we can start fresh when there's no previous exit time
            if right is None:
                return True  # No previous exit time means we can start fresh
            
            if left and right:
                if isinstance(left, datetime) and isinstance(right, datetime):
                    return left > right
                elif isinstance(left, datetime) and isinstance(right, str):
                    # Try to parse right as datetime
                    try:
                        right_dt = datetime.strptime(right, "%Y-%m-%d %H:%M:%S")
                        return left > right_dt
                    except ValueError:
                        pass
                # Try string comparison
                return str(left) > str(right)
        
        return False
    
    def _resolve_value(self, operand: str, context: RuleContext) -> Any:
        """Resolve operand to actual value"""
        if not operand:
            return None
        
        operand = operand.strip()
        
        # Handle "clock.time" as alias for candle.time
        if operand == "clock.time" or operand == "clock_time":
            return context.candle.get('time') or context.candle.get('start_time')
        
        # Handle "candle.low", "candle.close", "candle.start_time", etc.
        if operand.startswith("candle."):
            property_name = operand.split(".")[1]
            candle_value = context.candle.get(property_name)
            # Handle special cases like "candle.index"
            if property_name == "index":
                return candle_value
            return candle_value
        
        # Handle "signal.high", "signal.low", "signal.time", etc.
        elif operand.startswith("signal."):
            if not context.signal:
                return None
            property_name = operand.split(".")[1]
            return context.signal.get(property_name)
        
        # Handle "ema(5)"
        elif operand.startswith("ema("):
            return context.ema5
        
        # Handle "rsi(14)" or "rsi(14) is greater than 70"
        elif operand.startswith("rsi("):
            return context.rsi14
        
        # Handle "entry_premium * 0.83"
        elif "entry_premium" in operand:
            if "*" in operand:
                parts = operand.split("*")
                base = self._resolve_value(parts[0].strip(), context)
                multiplier = float(parts[1].strip())
                # Ensure base is a float before multiplication
                if base is not None:
                    try:
                        base_float = float(base) if not isinstance(base, (int, float)) else base
                        return base_float * multiplier
                    except (ValueError, TypeError):
                        return None
                return None
            elif context.active_trade:
                entry_price = context.active_trade.get("option_entry_price")
                # Ensure it's a float (handle None or string cases)
                if entry_price is not None:
                    try:
                        return float(entry_price)
                    except (ValueError, TypeError):
                        return None
                return None
            return None
        
        # Handle "option_premium"
        elif operand.startswith("option_premium"):
            if context.active_trade:
                premium = context.active_trade.get("current_option_premium")
                # Ensure it's a float (handle None or string cases)
                if premium is not None:
                    try:
                        return float(premium)
                    except (ValueError, TypeError):
                        return None
                return None
            return None
        
        # Handle "last_exit_time"
        elif operand == "last_exit_time":
            return context.last_exit_time
        
        # Handle numeric values
        else:
            # Try to parse as number
            try:
                # Check for percentages like "70" (for RSI)
                if operand.replace('.', '').replace('-', '').isdigit():
                    return float(operand)
            except ValueError:
                pass
        
        # Return as string if all else fails
        return operand
    
    def _evaluate_raw(self, condition: Condition, context: RuleContext) -> bool:
        """Fallback evaluation for raw conditions"""
        # Custom logic for specific raw conditions
        raw_text = condition.raw.lower()
        
        # Handle special conditions that weren't parsed correctly
        if "existing signal.type is pe" in raw_text:
            return context.signal is not None and context.signal.get('type') == 'PE'
        
        return False
