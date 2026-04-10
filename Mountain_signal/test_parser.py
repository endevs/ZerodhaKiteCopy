"""
Test script to verify rule parser works correctly
"""
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from Mountain_signal.rules.rules_parser import RulesParser

def test_parser():
    """Test the rules parser"""
    parser = RulesParser()
    
    print("Testing signal_rules.rules parsing...")
    try:
        rules = parser.parse_file("signal_rules.rules")
        print(f"SUCCESS: Successfully parsed {len(rules)} rules from signal_rules.rules")
        
        for rule in rules:
            print(f"  - Rule: {rule.rule_name} (Type: {rule.rule_type})")
            print(f"    Conditions: {len(rule.when_conditions)}")
            print(f"    Actions: {len(rule.then_actions)}")
            if rule.when_conditions:
                for i, cond in enumerate(rule.when_conditions):
                    print(f"      Condition {i+1}: {cond.raw[:60]}...")
    except Exception as e:
        print(f"ERROR: Error parsing signal_rules.rules: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    print("\nTesting entry_rules.rules parsing...")
    try:
        rules = parser.parse_file("entry_rules.rules")
        print(f"SUCCESS: Successfully parsed {len(rules)} rules from entry_rules.rules")
        
        for rule in rules:
            print(f"  - Rule: {rule.rule_name} (Type: {rule.rule_type})")
            if rule.rule_type == "ENTRY":
                print(f"    For condition: {rule.for_condition}")
                print(f"    Trigger: {rule.trigger}")
                print(f"    Requirements: {rule.requirements}")
    except Exception as e:
        print(f"ERROR: Error parsing entry_rules.rules: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    print("\nTesting exit_rules.rules parsing...")
    try:
        rules = parser.parse_file("exit_rules.rules")
        print(f"SUCCESS: Successfully parsed {len(rules)} rules from exit_rules.rules")
        
        for rule in rules:
            print(f"  - Rule: {rule.rule_name} (Type: {rule.rule_type})")
            if rule.rule_type == "EXIT_PRIORITY":
                print(f"    Priority order: {rule.priority}")
            elif rule.rule_type == "EXIT":
                print(f"    Exit reason: {rule.exit_reason}")
                print(f"    Conditions: {len(rule.when_conditions)}")
    except Exception as e:
        print(f"ERROR: Error parsing exit_rules.rules: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    print("\nSUCCESS: All parsing tests passed!")
    return True

if __name__ == "__main__":
    success = test_parser()
    sys.exit(0 if success else 1)
