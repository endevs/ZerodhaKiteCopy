"""NDJSON debug logging for agent debug sessions (session c3dc96)."""
import json
import os
import time
from typing import Any, Dict, Optional

SESSION_ID = "c3dc96"


def agent_log(
    location: str,
    message: str,
    data: Dict[str, Any],
    hypothesis_id: str,
    run_id: str = "pre-fix",
) -> None:
    payload = {
        "sessionId": SESSION_ID,
        "timestamp": int(time.time() * 1000),
        "location": location,
        "message": message,
        "data": data,
        "runId": run_id,
        "hypothesisId": hypothesis_id,
    }
    line = json.dumps(payload, default=str) + "\n"
    base = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.environ.get("DEBUG_LOG_PATH"),
        os.path.join(base, "..", "debug-c3dc96.log"),
        os.path.join(base, "debug-c3dc96.log"),
        "/app/data/debug-c3dc96.log",
    ]
    for path in candidates:
        if not path:
            continue
        try:
            parent = os.path.dirname(os.path.abspath(path))
            if parent:
                os.makedirs(parent, exist_ok=True)
            with open(path, "a", encoding="utf-8") as f:
                f.write(line)
            return
        except OSError:
            continue
