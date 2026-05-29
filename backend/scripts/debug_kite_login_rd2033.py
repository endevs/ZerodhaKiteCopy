#!/usr/bin/env python3
"""
Headed Playwright login test for RD2033 — run locally in PyCharm to see Kite UI.

Setup:
  - Working directory: .../ZerodhaKiteGit/backend
  - Set KITE_AUTOMATION_HEADED=1 (this script sets it automatically)
  - Credentials from DB user 13 / backend/.env (same as verify_kite_totp.py --rd2033)

Usage:
  python scripts/debug_kite_login_rd2033.py

On failure, check data/playwright_debug_*.png and data/debug-c3dc96.log
"""
from __future__ import annotations

import importlib.util
import os
import sys

_BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

os.environ.setdefault("KITE_AUTOMATION_HEADED", "1")
os.environ.setdefault("PYTHONUNBUFFERED", "1")

try:
    from dotenv import load_dotenv

    load_dotenv(os.path.join(_BACKEND_ROOT, ".env"))
except ImportError:
    pass


def _load_verify_module():
    path = os.path.join(_BACKEND_ROOT, "scripts", "verify_kite_totp.py")
    spec = importlib.util.spec_from_file_location("verify_kite_totp", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    verify = _load_verify_module()
    profile = verify._resolve_rd2033_profile()

    from kite_auth.playwright_worker import (
        PlaywrightAuthCredentials,
        authenticate_and_get_request_token,
    )

    missing = [
        key
        for key in ("kite_password", "kite_totp_secret", "app_key", "app_secret")
        if not (profile.get(key) or "").strip()
    ]
    if missing:
        raise SystemExit(
            f"Missing RD2033 credentials: {', '.join(missing)}. "
            "Save them in Welcome/Profile or backend/.env."
        )

    creds = PlaywrightAuthCredentials(
        app_key=profile["app_key"],
        user_id=profile["kite_user_id"],
        password=profile["kite_password"],
        totp_secret=profile["kite_totp_secret"],
        redirect_uri=profile["redirect_uri"],
    )

    timeout_ms = int(os.getenv("KITE_AUTOMATION_ATTEMPT_TIMEOUT_SECONDS", "120")) * 1000
    print(f"Starting headed Kite login for {profile['kite_user_id']} (timeout={timeout_ms}ms)...")
    print(f"Redirect URI: {profile['redirect_uri']}")
    print("A Chromium window should open. Watch the login flow.\n")

    token = authenticate_and_get_request_token(creds, timeout_ms=timeout_ms)
    print(f"\nSuccess: request_token captured ({token[:8]}...)")


if __name__ == "__main__":
    main()
