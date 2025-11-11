import os
import re
from typing import Dict, Any, Optional


RULES_DIR = os.path.join(os.path.dirname(__file__), "")


def _parse_mapping(line: str) -> Dict[str, float]:
    """Parse mapping strings like 'BANKNIFTY -> 35, NIFTY -> 75'."""
    mapping: Dict[str, float] = {}
    parts = [part.strip() for part in line.split(',')]
    for part in parts:
        if '->' not in part:
            continue
        key, value = [segment.strip() for segment in part.split('->', 1)]
        try:
            mapping[key.upper()] = float(value)
        except ValueError:
            continue
    return mapping


def _parse_percent(value: str) -> Optional[float]:
    match = re.search(r'(-?\d+(?:\.\d+)?)%\s*', value)
    if not match:
        return None
    return float(match.group(1)) / 100.0


def load_mountain_signal_pe_rules(rules_path: Optional[str] = None) -> Dict[str, Any]:
    """Load PE-specific Mountain Signal rules from the DSL file.

    Returns a dictionary containing the core parameters needed by the
    strategy and visualization layers. The parser is intentionally focused on
    the constructs currently defined in the DSL.
    """

    if rules_path is None:
        rules_path = os.path.join(RULES_DIR, "mountain_signal_pe.rules")

    if not os.path.exists(rules_path):
        raise FileNotFoundError(f"Rules file not found: {rules_path}")

    with open(rules_path, "r", encoding="utf-8") as handle:
        lines = [line.rstrip() for line in handle]

    data: Dict[str, Any] = {
        "strategy": {},
        "evaluation": {},
        "signal": {},
        "entry": {
            "re_entry": []
        },
        "option_trade": {},
        "lot_sizes": {},
        "strike_rounding": {},
        "expiry_policy": {},
        "exit_priority": [],
        "exits": {}
    }

    current_section = None
    current_exit_name = None

    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith('#'):
            continue

        if line.startswith('STRATEGY'):
            data["strategy"]["name"] = re.search(r'"([^"]+)"', line).group(1)
            version_match = re.search(r'VERSION\s+([\d\.]+)', line)
            if version_match:
                data["strategy"]["version"] = version_match.group(1)
            continue

        if line.startswith('DESCRIPTION'):
            data["strategy"]["description"] = line.split('"', 1)[1].rsplit('"', 1)[0]
            continue

        if line.startswith('EVALUATION'):
            current_section = 'evaluation'
            continue

        if line.startswith('RULE "Identify PE Signal"'):
            current_section = 'signal'
            continue

        if line.startswith('RULE "Reset PE Signal"'):
            current_section = 'signal_reset'
            continue

        if line.startswith('RULE "Clear PE Signal"'):
            current_section = 'signal_clear'
            continue

        if line.startswith('ENTRY'):
            current_section = 'entry'
            continue

        if line.startswith('EXIT_PRIORITY'):
            current_section = 'exit_priority'
            continue

        if line.startswith('EXIT "'):
            current_section = 'exit'
            current_exit_name = re.search(r'"([^"]+)"', line).group(1)
            data["exits"][current_exit_name] = {"conditions": [], "actions": []}
            continue

        if current_section == 'evaluation':
            if line.startswith('SCHEDULE'):
                schedule_match = re.search(r'every\s+(\d+)m', line)
                if schedule_match:
                    data["evaluation"]["interval_minutes"] = int(schedule_match.group(1))
            elif line.startswith('TIMING'):
                timing_match = re.search(r'(\d+)\s*seconds', line)
                if timing_match:
                    data["evaluation"]["seconds_before_close"] = int(timing_match.group(1))
            continue

        if current_section == 'entry':
            if line.startswith('FOR'):
                data["entry"]["for"] = line.split('FOR', 1)[1].strip()
            elif line.startswith('TRIGGER'):
                data["entry"]["trigger"] = line.split('TRIGGER', 1)[1].strip()
            elif line.startswith('first_entry'):
                data["entry"]["first_entry"] = line.split(':', 1)[1].strip()
            elif line.startswith('-'):
                data["entry"]["re_entry"].append(line.lstrip('-').strip())
            elif line.startswith('instrument:'):
                data["option_trade"]["instrument"] = line.split(':', 1)[1].strip()
            elif line.startswith('strike_rounding:'):
                mapping = _parse_mapping(line.split(':', 1)[1])
                data["strike_rounding"].update(mapping)
            elif line.startswith('expiry_policy:'):
                mapping = _parse_mapping(line.split(':', 1)[1])
                data["expiry_policy"].update(mapping)
            elif line.startswith('stop_loss:'):
                percent = _parse_percent(line)
                if percent is not None:
                    data["option_trade"]["stop_loss_percent"] = percent
            elif line.startswith('target:'):
                percent = _parse_percent(line)
                if percent is not None:
                    data["option_trade"]["target_percent"] = percent
            elif line.startswith('lot_size:'):
                mapping = _parse_mapping(line.split(':', 1)[1])
                data["lot_sizes"].update(mapping)
            continue

        if current_section == 'exit_priority':
            if line.startswith('-'):
                data["exit_priority"].append(line.lstrip('-').strip())
            continue

        if current_section == 'exit' and current_exit_name:
            if line.startswith('WHEN'):
                condition = line.split('WHEN', 1)[1].strip()
                data["exits"][current_exit_name]["conditions"].append(condition)
            elif line.startswith('AND'):
                condition = line.split('AND', 1)[1].strip()
                data["exits"][current_exit_name]["conditions"].append(condition)
            elif line.startswith('THEN'):
                # actions may span multiple lines until blank or new section
                continue
            elif line.startswith('exit reason'):
                data["exits"][current_exit_name]["exit_reason"] = line.split('exit reason', 1)[1].strip()
            elif line.startswith('log'):
                data["exits"][current_exit_name].setdefault("actions", []).append(line)
            continue

    return data


