"""
Rule Handler - Orchestrates rule evaluation and execution
"""
from typing import List, Dict, Any, Optional
import logging
from ..rules.rules_parser import RulesParser, Rule
from .rule_context import RuleContext
from .rule_evaluator import RuleEvaluator
from .rule_executor import RuleExecutor

logger = logging.getLogger(__name__)


class RuleHandler:
    """Handles rule evaluation and execution"""
    
    def __init__(self, rules_dir: Optional[str] = None):
        self.parser = RulesParser(rules_dir)
        self.evaluator = RuleEvaluator()
        self.executor = RuleExecutor()
        self.signal_rules: List[Rule] = []
        self.entry_rules: List[Rule] = []
        self.exit_rules: List[Rule] = []
        self.exit_priority: List[str] = []
        self._load_rules()
    
    def _load_rules(self):
        """Load all rule files"""
        try:
            self.signal_rules = self.parser.parse_file("signal_rules.rules")
            logger.info(f"Loaded {len(self.signal_rules)} signal rules")
        except Exception as e:
            logger.error(f"Error loading signal_rules.rules: {e}")
            self.signal_rules = []
        
        try:
            self.entry_rules = self.parser.parse_file("entry_rules.rules")
            logger.info(f"Loaded {len(self.entry_rules)} entry rules")
        except Exception as e:
            logger.error(f"Error loading entry_rules.rules: {e}")
            self.entry_rules = []
        
        try:
            exit_rules_all = self.parser.parse_file("exit_rules.rules")
            # Separate EXIT_PRIORITY from exit rules
            for rule in exit_rules_all:
                if rule.rule_type == "EXIT_PRIORITY":
                    self.exit_priority = rule.priority or []
                elif rule.rule_type == "EXIT":
                    self.exit_rules.append(rule)
            logger.info(f"Loaded {len(self.exit_rules)} exit rules with priority order: {self.exit_priority}")
        except Exception as e:
            logger.error(f"Error loading exit_rules.rules: {e}")
            self.exit_rules = []
    
    def evaluate_and_execute_signal_rules(self, context: RuleContext) -> Dict[str, Any]:
        """Evaluate and execute signal rules (identify, reset, clear)"""
        # #region agent log - DISABLED for performance
        # DEBUG_LOGGING = False  # Set to True only when debugging
        # if DEBUG_LOGGING:
        #     import json
        #     import os
        #     from datetime import datetime
        #     try:
        #         log_dir = r'd:\WorkSpace\ZerodhaKiteGit\.cursor'
        #         os.makedirs(log_dir, exist_ok=True)
        #         log_file = os.path.join(log_dir, 'debug.log')
        #         with open(log_file, 'a', encoding='utf-8') as f:
        #             f.write(json.dumps({'location': 'rule_handler.py:56', 'message': 'evaluating signal rules', 'data': {'num_signal_rules': len(self.signal_rules), 'candle_index': context.candle.get('index'), 'has_active_trade': context.active_trade is not None, 'has_signal': context.signal is not None}, 'timestamp': int(datetime.now().timestamp() * 1000), 'sessionId': 'debug-session', 'runId': 'run1', 'hypothesisId': 'H4'}) + '\n')
        #     except Exception as e:
        #         pass
        # #endregion
        
        results = {}
        
        for rule in self.signal_rules:
            # Skip "Identify PE Signal" if signal already exists
            # This prevents overwriting existing signals and ensures proper signal lifecycle
            if rule.rule_name == "Identify PE Signal" and context.signal is not None:
                continue  # Skip identifying new signal when one already exists
            
            rule_matched = self.evaluator.evaluate_rule(rule, context)
            
            # #region agent log - DISABLED for performance
            # if DEBUG_LOGGING:
            #     try:
            #         log_file = os.path.join(r'd:\WorkSpace\ZerodhaKiteGit\.cursor', 'debug.log')
            #         with open(log_file, 'a', encoding='utf-8') as f:
            #             f.write(json.dumps({'location': 'rule_handler.py:61', 'message': 'signal rule evaluated', 'data': {'rule_name': rule.rule_name, 'rule_matched': rule_matched}, 'timestamp': int(datetime.now().timestamp() * 1000), 'sessionId': 'debug-session', 'runId': 'run1', 'hypothesisId': 'H4'}) + '\n')
            #     except Exception as e:
            #         pass
            # #endregion
            
            if rule_matched:
                logger.info(f"Signal rule '{rule.rule_name}' conditions met")
                action_results = self.executor.execute_rule(rule, context)
                results.update(action_results)
                
                # #region agent log - DISABLED for performance
                # if DEBUG_LOGGING:
                #     try:
                #         log_file = os.path.join(r'd:\WorkSpace\ZerodhaKiteGit\.cursor', 'debug.log')
                #         with open(log_file, 'a', encoding='utf-8') as f:
                #             f.write(json.dumps({'location': 'rule_handler.py:66', 'message': 'signal rule actions executed', 'data': {'rule_name': rule.rule_name, 'action_results': action_results}, 'timestamp': int(datetime.now().timestamp() * 1000), 'sessionId': 'debug-session', 'runId': 'run1', 'hypothesisId': 'H4'}) + '\n')
                #     except Exception as e:
                #         pass
                # #endregion
                
                # Only execute first matching rule for signal management
                break
        
        return results
    
    def evaluate_entry_trigger(self, context: RuleContext) -> bool:
        """Evaluate if entry trigger condition is met"""
        if not self.entry_rules:
            return False
        
        entry_rule = self.entry_rules[0]  # Assuming single entry rule
        
        # Check FOR condition
        if entry_rule.for_condition:
            if not self._evaluate_for_condition(entry_rule.for_condition, context):
                return False
        
        # Check TRIGGER condition
        if entry_rule.trigger:
            return self._evaluate_trigger_condition(entry_rule.trigger, context)
        
        return False
    
    def _evaluate_for_condition(self, for_condition: str, context: RuleContext) -> bool:
        """Evaluate FOR condition (e.g., 'signal.type == PE')"""
        if 'signal.type == PE' in for_condition:
            return context.signal is not None and context.signal.get('type') == 'PE'
        return False
    
    def _evaluate_trigger_condition(self, trigger: str, context: RuleContext) -> bool:
        """Evaluate TRIGGER condition (e.g., 'when candle.close falls below signal.low')"""
        # #region agent log - DISABLED for performance
        # DEBUG_LOGGING = False  # Set to True only when debugging
        # if DEBUG_LOGGING:
        #     import json
        #     import os
        #     from datetime import datetime
        #     try:
        #         log_file = os.path.join(r'd:\WorkSpace\ZerodhaKiteGit\.cursor', 'debug.log')
        #         with open(log_file, 'a', encoding='utf-8') as f:
        #             f.write(json.dumps({'location': 'rule_handler.py:94', 'message': 'evaluating entry trigger', 'data': {'trigger': trigger, 'candle_close': context.candle.get('close'), 'has_signal': context.signal is not None, 'signal_low': context.signal.get('low') if context.signal else None}, 'timestamp': int(datetime.now().timestamp() * 1000), 'sessionId': 'debug-session', 'runId': 'run1', 'hypothesisId': 'H5'}) + '\n')
        #     except Exception as e:
        #         pass
        # #endregion
        
        # Parse trigger condition similar to WHEN conditions
        if 'candle.close falls below signal.low' in trigger:
            candle_close = context.candle.get('close')
            signal_low = context.signal.get('low') if context.signal else None
            if candle_close is not None and signal_low is not None:
                result = candle_close < signal_low
                
                # #region agent log - DISABLED for performance
                # if DEBUG_LOGGING:
                #     try:
                #         log_file = os.path.join(r'd:\WorkSpace\ZerodhaKiteGit\.cursor', 'debug.log')
                #         with open(log_file, 'a', encoding='utf-8') as f:
                #             f.write(json.dumps({'location': 'rule_handler.py:101', 'message': 'entry trigger result', 'data': {'trigger_met': result, 'candle_close': candle_close, 'signal_low': signal_low, 'comparison': f'{candle_close} < {signal_low}'}, 'timestamp': int(datetime.now().timestamp() * 1000), 'sessionId': 'debug-session', 'runId': 'run1', 'hypothesisId': 'H5'}) + '\n')
                #     except Exception as e:
                #         pass
                # #endregion
                
                return result
        return False
    
    def evaluate_entry_requirements(self, context: RuleContext, is_first_entry: bool) -> bool:
        """Evaluate entry requirements (first_entry or re_entry)"""
        if not self.entry_rules:
            return False
        
        entry_rule = self.entry_rules[0]
        
        if is_first_entry:
            # First entry: check if requirements are 'none'
            first_entry_req = entry_rule.requirements.get('first_entry', 'none')
            return first_entry_req == 'none'
        else:
            # Re-entry: check re_entry requirements
            re_entry_reqs = entry_rule.requirements.get('re_entry', [])
            
            # Check if highest high since exit is above signal.low
            for req in re_entry_reqs:
                if 'highest candle.high since last exit is above signal.low' in req:
                    if context.candles_since_exit:
                        highest_high = max(c.get('high') for c in context.candles_since_exit)
                        signal_low = context.signal.get('low') if context.signal else None
                        if highest_high is not None and signal_low is not None:
                            return highest_high > signal_low
                elif 'permitted while the current signal remains active' in req:
                    # Signal must exist
                    if context.signal is None:
                        return False
                elif 'permitted again if a new signal candle replaces the prior one' in req:
                    # This is handled by signal reset logic
                    return True
            
            return True
    
    def execute_entry_actions(self, context: RuleContext) -> Dict[str, Any]:
        """Execute entry actions (option selection, trade execution)"""
        if not self.entry_rules:
            return {}
        
        entry_rule = self.entry_rules[0]
        results = {}
        
        for action in entry_rule.then_actions:
            if action.type == "select" or action.type == "trade_execution":
                # These will be handled by entry_manager
                results[action.type] = action.value
        
        return results
    
    def evaluate_and_execute_exit_rules(self, context: RuleContext) -> Optional[Dict[str, Any]]:
        """Evaluate exit rules in priority order and return exit result if any rule matches"""
        # Evaluate exit rules in priority order
        for exit_type in self.exit_priority:
            for rule in self.exit_rules:
                # Case-insensitive comparison to handle "market_close" vs "MARKET_CLOSE"
                if rule.exit_reason and rule.exit_reason.upper() == exit_type.upper():
                    if self.evaluator.evaluate_rule(rule, context):
                        logger.info(f"Exit rule '{rule.rule_name}' conditions met - Exit reason: {rule.exit_reason}")
                        action_results = self.executor.execute_rule(rule, context)
                        return {
                            "exit_reason": rule.exit_reason,
                            "exit_type": exit_type,
                            "actions": action_results
                        }
        
        return None
