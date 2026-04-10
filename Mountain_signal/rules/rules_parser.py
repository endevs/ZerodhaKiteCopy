"""
Enhanced Rule Parser for .rules DSL files
Parses human-readable rule definitions into executable rule objects
"""
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
import re
import os


@dataclass
class Condition:
    """Represents a single condition in WHEN clause"""
    raw: str  # Original text: "candle.low is above ema(5)"
    type: str = "raw"  # "candle_property", "indicator", "state_check", "comparison"
    left_operand: str = ""  # "candle.low"
    operator: str = ""  # "is above", "is greater than", "falls below"
    right_operand: str = ""  # "ema(5)", "70", "signal.high"
    connector: Optional[str] = None  # "AND", "OR"


@dataclass
class Action:
    """Represents a single action in THEN clause"""
    raw: str  # Original text: "set signal.type to PE"
    type: str = "unknown"  # "set", "replace", "clear", "select", "trade_execution", "log"
    target: Optional[str] = None  # "signal.type"
    value: Optional[str] = None  # "PE", "candle.low"
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class Rule:
    """Represents a complete rule"""
    rule_name: str  # "Identify PE Signal"
    rule_type: str  # "RULE", "ENTRY", "EXIT"
    when_conditions: List[Condition] = field(default_factory=list)
    then_actions: List[Action] = field(default_factory=list)
    trigger: Optional[str] = None  # For ENTRY: "when candle.close falls below signal.low"
    for_condition: Optional[str] = None  # For ENTRY: "signal.type == PE"
    requirements: Dict[str, Any] = field(default_factory=dict)  # For ENTRY: first_entry, re_entry
    exit_reason: Optional[str] = None  # For EXIT: "OPTION_STOP_LOSS"
    priority: Optional[int] = None  # For EXIT priority ordering


class RulesParser:
    """Enhanced parser for .rules DSL files"""
    
    def __init__(self, rules_dir: Optional[str] = None):
        if rules_dir is None:
            rules_dir = os.path.dirname(__file__)
        self.rules_dir = rules_dir
    
    def parse_file(self, filename: str) -> List[Rule]:
        """Parse a .rules file and return list of Rule objects"""
        filepath = os.path.join(self.rules_dir, filename)
        if not os.path.exists(filepath):
            raise FileNotFoundError(f"Rules file not found: {filepath}")
        
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        return self.parse_content(content)
    
    def parse_content(self, content: str) -> List[Rule]:
        """Parse rules content string"""
        rules = []
        lines = [line.rstrip() for line in content.split('\n')]
        
        current_rule: Optional[Rule] = None
        in_when = False
        in_then = False
        in_requirements = False
        in_actions = False
        multi_line_condition = ""
        multi_line_action = ""
        
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            
            # Skip empty lines and comments
            if not line or line.startswith('#'):
                i += 1
                continue
            
            # Parse RULE declaration
            if line.startswith('RULE '):
                if current_rule:
                    rules.append(current_rule)
                rule_name = self._extract_quoted_string(line)
                current_rule = Rule(rule_name=rule_name, rule_type="RULE")
                in_when = False
                in_then = False
                in_requirements = False
                in_actions = False
                multi_line_condition = ""
                multi_line_action = ""
                i += 1
                continue
            
            # Parse ENTRY declaration
            if line.startswith('ENTRY '):
                if current_rule:
                    rules.append(current_rule)
                rule_name = self._extract_quoted_string(line)
                current_rule = Rule(rule_name=rule_name, rule_type="ENTRY")
                in_when = False
                in_then = False
                in_requirements = False
                in_actions = False
                multi_line_condition = ""
                multi_line_action = ""
                i += 1
                continue
            
            # Parse EXIT declaration
            if line.startswith('EXIT '):
                if current_rule:
                    rules.append(current_rule)
                rule_name = self._extract_quoted_string(line)
                current_rule = Rule(rule_name=rule_name, rule_type="EXIT")
                in_when = False
                in_then = False
                in_requirements = False
                in_actions = False
                multi_line_condition = ""
                multi_line_action = ""
                i += 1
                continue
            
            # Parse EXIT_PRIORITY
            if line.startswith('EXIT_PRIORITY'):
                if current_rule:
                    rules.append(current_rule)
                current_rule = Rule(rule_name="EXIT_PRIORITY", rule_type="EXIT_PRIORITY")
                current_rule.priority = []  # Will be list
                in_when = False
                in_then = False
                in_requirements = False
                in_actions = False
                i += 1
                continue
            
            # Parse WHEN clause
            if line.startswith('WHEN'):
                in_when = True
                in_then = False
                in_requirements = False
                in_actions = False
                if current_rule:
                    current_rule.when_conditions = []
                # Extract condition from WHEN line if it continues on same line
                condition_text = line.replace('WHEN', '').strip()
                if condition_text:
                    condition = self._parse_condition(condition_text)
                    if condition and current_rule:
                        current_rule.when_conditions.append(condition)
                    multi_line_condition = ""
                else:
                    # WHEN on separate line, condition will be on next lines
                    multi_line_condition = ""
                i += 1
                continue
            
            # Parse THEN clause
            if line.startswith('THEN'):
                # Process any remaining multi-line condition before switching to THEN
                if in_when and current_rule and multi_line_condition.strip():
                    condition = self._parse_condition(multi_line_condition.strip())
                    if condition:
                        current_rule.when_conditions.append(condition)
                    multi_line_condition = ""
                
                in_when = False
                in_then = True
                in_requirements = False
                in_actions = False
                if current_rule:
                    current_rule.then_actions = []
                multi_line_action = ""
                i += 1
                continue
            
            # Parse FOR clause (for ENTRY)
            if line.startswith('FOR'):
                if current_rule and current_rule.rule_type == "ENTRY":
                    current_rule.for_condition = line.replace('FOR', '').strip()
                i += 1
                continue
            
            # Parse TRIGGER clause (for ENTRY)
            if line.startswith('TRIGGER'):
                if current_rule and current_rule.rule_type == "ENTRY":
                    current_rule.trigger = line.replace('TRIGGER', '').strip()
                i += 1
                continue
            
            # Parse REQUIREMENTS (for ENTRY)
            if line.startswith('REQUIREMENTS'):
                in_requirements = True
                in_actions = False
                in_when = False
                in_then = False
                if current_rule:
                    current_rule.requirements = {"first_entry": None, "re_entry": []}
                i += 1
                continue
            
            # Parse ACTIONS (for ENTRY)
            if line.startswith('ACTIONS'):
                in_requirements = False
                in_actions = True
                in_when = False
                in_then = False
                i += 1
                continue
            
            # Parse conditions in WHEN block
            if in_when and current_rule and not line.startswith('THEN'):
                if line.startswith('AND') or line.startswith('OR'):
                    # Process accumulated multi-line condition if any (before this connector)
                    if multi_line_condition.strip():
                        condition = self._parse_condition(multi_line_condition.strip())
                        if condition:
                            current_rule.when_conditions.append(condition)
                    
                    connector = line.split()[0]
                    condition_text = line[len(connector):].strip()
                    if condition_text:
                        condition = self._parse_condition(condition_text)
                        if condition:
                            condition.connector = connector
                            current_rule.when_conditions.append(condition)
                    multi_line_condition = ""
                elif line.strip():
                    # Condition line (continuation or new)
                    if multi_line_condition:
                        multi_line_condition += " " + line.strip()
                    else:
                        multi_line_condition = line.strip()
            
            # Parse actions in THEN block
            if in_then and current_rule:
                # Check if line contains action keywords
                if any(line.startswith(kw) for kw in ['set', 'replace', 'clear', 'log', 'exit reason']):
                    # Process accumulated multi-line action if any
                    if multi_line_action.strip():
                        action = self._parse_action(multi_line_action.strip())
                        if action:
                            current_rule.then_actions.append(action)
                    
                    multi_line_action = line
                elif line.startswith('select') or line.startswith('trade_execution'):
                    # Multi-line action blocks
                    if multi_line_action.strip():
                        action = self._parse_action(multi_line_action.strip())
                        if action:
                            current_rule.then_actions.append(action)
                    multi_line_action = line
                elif multi_line_action and (line.startswith('  ') or not line.startswith(any(['set', 'replace', 'clear', 'log']))):
                    # Continuation of multi-line action
                    multi_line_action += " " + line
                else:
                    action = self._parse_action(line)
                    if action:
                        current_rule.then_actions.append(action)
            
            # Parse exit reason
            if line.startswith('exit reason'):
                if current_rule:
                    current_rule.exit_reason = line.replace('exit reason', '').strip()
                i += 1
                continue
            
            # Parse ENTRY requirements
            if in_requirements and current_rule:
                if line.startswith('first_entry:'):
                    current_rule.requirements["first_entry"] = line.split(':', 1)[1].strip()
                elif line.startswith('-'):
                    re_entry_req = line.lstrip('-').strip()
                    current_rule.requirements["re_entry"].append(re_entry_req)
                i += 1
                continue
            
            # Parse EXIT_PRIORITY list
            if current_rule and current_rule.rule_type == "EXIT_PRIORITY":
                if line.startswith('-'):
                    priority_item = line.lstrip('-').strip()
                    if isinstance(current_rule.priority, list):
                        current_rule.priority.append(priority_item)
                i += 1
                continue
            
            i += 1
        
        # Process any remaining multi-line content
        if current_rule:
            if multi_line_condition.strip() and in_when:
                condition = self._parse_condition(multi_line_condition.strip())
                if condition:
                    current_rule.when_conditions.append(condition)
            elif multi_line_action.strip() and in_then:
                action = self._parse_action(multi_line_action.strip())
                if action:
                    current_rule.then_actions.append(action)
            rules.append(current_rule)
        
        return rules
    
    def _parse_condition(self, condition_text: str) -> Optional[Condition]:
        """Parse a condition string into Condition object"""
        if not condition_text.strip():
            return None
        
        condition = Condition(raw=condition_text)
        
        # Parse different condition types
        if 'is above' in condition_text:
            condition.operator = "is above"
            parts = condition_text.split('is above')
            condition.left_operand = parts[0].strip()
            condition.right_operand = parts[1].strip()
            condition.type = "comparison"
        elif 'is greater than' in condition_text:
            condition.operator = "is greater than"
            parts = condition_text.split('is greater than')
            condition.left_operand = parts[0].strip()
            condition.right_operand = parts[1].strip()
            condition.type = "comparison"
        elif 'falls below' in condition_text:
            condition.operator = "falls below"
            parts = condition_text.split('falls below')
            condition.left_operand = parts[0].strip()
            condition.right_operand = parts[1].strip()
            condition.type = "comparison"
        elif 'rises above' in condition_text:
            condition.operator = "rises above"
            parts = condition_text.split('rises above')
            condition.left_operand = parts[0].strip()
            condition.right_operand = parts[1].strip()
            condition.type = "comparison"
        elif 'drops below' in condition_text:
            condition.operator = "drops below"
            parts = condition_text.split('drops below')
            condition.left_operand = parts[0].strip()
            condition.right_operand = parts[1].strip()
            condition.type = "comparison"
        elif 'is' in condition_text and 'or below' in condition_text:
            condition.operator = "is or below"
            parts = condition_text.split('is')
            condition.left_operand = parts[0].strip()
            condition.right_operand = parts[1].replace('or below', '').strip()
            condition.type = "comparison"
        elif 'is at or after' in condition_text:
            condition.operator = "is at or after"
            parts = condition_text.split('is at or after')
            condition.left_operand = parts[0].strip()
            condition.right_operand = parts[1].strip()
            condition.type = "time_check"
        elif 'exists' in condition_text:
            condition.type = "state_check"
            condition.operator = "exists"
            condition.left_operand = condition_text.replace('exists', '').strip()
            condition.right_operand = "true"
        elif 'is after' in condition_text:
            condition.operator = "is after"
            parts = condition_text.split('is after')
            condition.left_operand = parts[0].strip()
            condition.right_operand = parts[1].strip()
            condition.type = "time_comparison"
        elif '==' in condition_text:
            condition.operator = "equals"
            parts = condition_text.split('==')
            condition.left_operand = parts[0].strip()
            condition.right_operand = parts[1].strip()
            condition.type = "comparison"
        else:
            # Fallback: store as-is
            condition.type = "raw"
            condition.left_operand = condition_text
        
        return condition
    
    def _parse_action(self, action_text: str) -> Optional[Action]:
        """Parse an action string into Action object"""
        if not action_text.strip():
            return None
        
        action = Action(raw=action_text)
        
        if action_text.startswith('set'):
            action.type = "set"
            if 'to' in action_text:
                parts = action_text.replace('set', '').strip().split('to')
                if len(parts) == 2:
                    action.target = parts[0].strip()
                    action.value = parts[1].strip()
        elif action_text.startswith('replace'):
            action.type = "replace"
            if 'with' in action_text:
                parts = action_text.replace('replace', '').strip().split('with')
                if len(parts) == 2:
                    action.target = parts[0].strip()
                    action.value = parts[1].strip()
        elif action_text.startswith('clear'):
            action.type = "clear"
            action.target = action_text.replace('clear', '').strip()
        elif action_text.startswith('select'):
            action.type = "select"
            action.value = action_text.replace('select', '').strip()
        elif action_text.startswith('trade_execution'):
            action.type = "trade_execution"
            action.value = action_text.replace('trade_execution', '').strip()
        elif action_text.startswith('log'):
            action.type = "log"
            action.value = self._extract_quoted_string(action_text)
        elif 'exit reason' in action_text:
            action.type = "exit_reason"
            action.value = action_text.replace('exit reason', '').strip()
        else:
            # Unknown action type, return None
            return None
        
        return action
    
    def _extract_quoted_string(self, text: str) -> str:
        """Extract quoted string from text"""
        match = re.search(r'"([^"]+)"', text)
        return match.group(1) if match else ""
