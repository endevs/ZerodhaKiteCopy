#!/usr/bin/env python3
"""
Standalone Kite TOTP verifier — run in PyCharm (no Docker / frontend).

PyCharm setup:
  - Working directory: .../ZerodhaKiteGit/backend
  - Interpreter: venv with pyotp (pip install pyotp python-dotenv)
  - Script parameters (optional): --rd2033   or   --rd2033 --watch
  - If you click Run with no parameters, --rd2033 is assumed automatically.

Usage:
  python scripts/verify_kite_totp.py
  python scripts/verify_kite_totp.py --rd2033
  python scripts/verify_kite_totp.py --rd2033 --watch
  python scripts/verify_kite_totp.py
  python scripts/verify_kite_totp.py YOUR_BASE32_SECRET

RD2033 secrets (not committed) — set in backend/.env:
  KITE_AUTOMATION_USER_13_USER_ID, KITE_AUTOMATION_USER_13_PASSWORD,
  KITE_AUTOMATION_USER_13_TOTP_SECRET
  or global KITE_AUTOMATION_USER_ID, KITE_AUTOMATION_PASSWORD, KITE_AUTOMATION_TOTP_SECRET
  or KITE_TOTP_SECRET
  API key/secret: loaded from DB user id 13 if DATABASE_PATH / data/database.db exists.

Compare the printed 6-digit code with your phone authenticator (same secret).
Uses the same TotpProvider as automated Zerodha login.
"""
from __future__ import annotations

import argparse
import copy
import getpass
import os
import sqlite3
import sys
import time
from typing import Any, Dict, Optional

# Allow imports when run as scripts/verify_kite_totp.py with cwd=backend
_BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

try:
    from dotenv import load_dotenv

    load_dotenv(os.path.join(_BACKEND_ROOT, ".env"))
except ImportError:
    pass

def _ensure_pyotp() -> None:
    try:
        import pyotp  # noqa: F401
    except ImportError:
        raise SystemExit(
            f"pyotp is not installed for this Python interpreter:\n  {sys.executable}\n\n"
            "Fix (pick one):\n"
            "  1) PyCharm: File → Settings → Project → Python Interpreter → "
            "select ZerodhaKiteGit\\.venv\n"
            f"  2) Terminal: \"{sys.executable}\" -m pip install pyotp python-dotenv\n"
            "  3) Use run config: Verify Kite TOTP (RD2033)"
        ) from None


_ensure_pyotp()
from kite_auth.totp_provider import TotpProvider

# --- RD2033 local test profile (public fields only; secrets via .env / DB / local overrides) ---
RD2033_TEST_PROFILE: Dict[str, Any] = {
    "label": "RD2033 (local test)",
    "app_user_id": 13,
    "kite_user_id": "RD2033",
    "email_hint": "raj.bapa@gmail.com",
    "redirect_uri": "http://localhost:8003/callback",
    "kite_password": "",
    "kite_totp_secret": "",
    "app_key": "",
    "app_secret": "",
}

# Optional: fill locally in PyCharm only — do NOT commit real values.
RD2033_LOCAL_SECRET_OVERRIDES: Dict[str, str] = {
    "kite_password": "",
    "kite_totp_secret": "",
    "app_key": "",
    "app_secret": "",
}


def _first_non_empty(*values: Optional[str]) -> str:
    for value in values:
        if value and str(value).strip():
            return str(value).strip()
    return ""


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def _database_paths() -> list[str]:
    candidates = [
        _env("DATABASE_PATH"),
        os.path.join(_BACKEND_ROOT, "..", "data", "database.db"),
        os.path.join(_BACKEND_ROOT, "database.db"),
    ]
    paths: list[str] = []
    for path in candidates:
        if path and os.path.isfile(path) and path not in paths:
            paths.append(os.path.abspath(path))
    return paths


def _load_rd2033_from_db(app_user_id: int) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for db_path in _database_paths():
        try:
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT kite_user_id, kite_password, kite_totp_secret, app_key, app_secret, email
                FROM users
                WHERE id = ?
                """,
                (app_user_id,),
            ).fetchone()
            conn.close()
            if not row:
                continue
            for key in ("kite_user_id", "kite_password", "kite_totp_secret", "app_key", "app_secret", "email"):
                val = row[key]
                if val:
                    out[key] = str(val).strip()
            return out
        except (sqlite3.Error, OSError):
            continue
    return out


def _resolve_rd2033_profile() -> Dict[str, Any]:
    profile: Dict[str, Any] = copy.deepcopy(RD2033_TEST_PROFILE)
    app_user_id = int(profile["app_user_id"])

    db_row = _load_rd2033_from_db(app_user_id)

    profile["kite_user_id"] = _first_non_empty(
        db_row.get("kite_user_id"),
        _env(f"KITE_AUTOMATION_USER_{app_user_id}_USER_ID"),
        _env("KITE_AUTOMATION_USER_ID"),
        profile["kite_user_id"],
    )
    profile["kite_password"] = _first_non_empty(
        RD2033_LOCAL_SECRET_OVERRIDES.get("kite_password"),
        db_row.get("kite_password"),
        _env(f"KITE_AUTOMATION_USER_{app_user_id}_PASSWORD"),
        _env("KITE_AUTOMATION_PASSWORD"),
        profile.get("kite_password"),
    )
    profile["kite_totp_secret"] = _first_non_empty(
        RD2033_LOCAL_SECRET_OVERRIDES.get("kite_totp_secret"),
        db_row.get("kite_totp_secret"),
        _env(f"KITE_AUTOMATION_USER_{app_user_id}_TOTP_SECRET"),
        _env("KITE_AUTOMATION_TOTP_SECRET"),
        _env("KITE_TOTP_SECRET"),
        profile.get("kite_totp_secret"),
    )
    profile["app_key"] = _first_non_empty(
        RD2033_LOCAL_SECRET_OVERRIDES.get("app_key"),
        db_row.get("app_key"),
        profile.get("app_key"),
    )
    profile["app_secret"] = _first_non_empty(
        RD2033_LOCAL_SECRET_OVERRIDES.get("app_secret"),
        db_row.get("app_secret"),
        profile.get("app_secret"),
    )
    if db_row.get("email"):
        profile["email_hint"] = db_row["email"]
    return profile


def _mask_secret(value: str, show_tail: int = 4) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        return "(missing)"
    if len(cleaned) <= show_tail:
        return "****"
    return f"{'*' * max(4, len(cleaned) - show_tail)}{cleaned[-show_tail:]}"


def _presence(value: str) -> str:
    return "present" if (value or "").strip() else "missing"


def _seconds_remaining(interval: int = 30) -> int:
    now = time.time()
    return int(interval - (now % interval))


def _print_totp(secret: str) -> None:
    provider = TotpProvider()
    code = provider.generate(secret)
    remaining = _seconds_remaining()
    print(f"TOTP code: {code}")
    print(f"Seconds left in window: {remaining}")
    print("Compare with your phone app now (same base32 secret as Zerodha / Profile).")


def _print_rd2033_banner(profile: Dict[str, Any]) -> str:
    totp_secret = (profile.get("kite_totp_secret") or "").strip()
    if not totp_secret:
        raise SystemExit(
            "RD2033 TOTP secret is missing. Set KITE_AUTOMATION_USER_13_TOTP_SECRET in "
            "backend/.env, save credentials in the app (user id 13), or fill "
            "RD2033_LOCAL_SECRET_OVERRIDES in this script locally (do not commit)."
        )

    print(f"=== {profile.get('label', 'RD2033')} ===")
    print(f"Kite user id: {profile.get('kite_user_id')}")
    print(f"App user id: {profile.get('app_user_id')}")
    print(f"Email hint: {profile.get('email_hint')}")
    print(f"Redirect URI: {profile.get('redirect_uri')}")
    print(f"API key: {_mask_secret(profile.get('app_key', ''))} ({_presence(profile.get('app_key', ''))})")
    print(f"API secret: {_mask_secret(profile.get('app_secret', ''))} ({_presence(profile.get('app_secret', ''))})")
    print(f"Password: {_mask_secret(profile.get('kite_password', ''))} ({_presence(profile.get('kite_password', ''))})")
    print(f"TOTP secret: {_mask_secret(totp_secret)} ({_presence(totp_secret)})")
    return totp_secret


def _resolve_secret(cli_secret: str | None) -> str:
    if cli_secret:
        return cli_secret.strip()
    env_secret = (os.environ.get("KITE_TOTP_SECRET") or "").strip()
    if env_secret:
        return env_secret
    print(
        "No TOTP secret in CLI or KITE_TOTP_SECRET. "
        "Type your base32 secret in the Run console (input is hidden), then press Enter.",
        flush=True,
    )
    entered = getpass.getpass("Base32 TOTP secret: ").strip()
    if not entered:
        raise SystemExit("No secret provided.")
    return entered


def _run_rd2033(watch: bool) -> None:
    profile = _resolve_rd2033_profile()
    totp_secret = _print_rd2033_banner(profile)
    print()

    if watch:
        print("Watching TOTP for RD2033 — prints when code changes (Ctrl+C to stop)...", flush=True)
        provider = TotpProvider()
        last_code: Optional[str] = None
        try:
            while True:
                code = provider.generate(totp_secret)
                if code != last_code:
                    remaining = _seconds_remaining()
                    print("-" * 40, flush=True)
                    print(f"TOTP code: {code}", flush=True)
                    print(f"Seconds left in window: {remaining}", flush=True)
                    print("Compare with your phone app now.", flush=True)
                    last_code = code
                time.sleep(1)
        except KeyboardInterrupt:
            print("\nStopped.", flush=True)
        return

    _print_totp(totp_secret)


def main() -> None:
    # PyCharm "Run" often has no script parameters — default to RD2033 profile.
    if len(sys.argv) == 1:
        sys.argv.append("--rd2033")

    print("verify_kite_totp.py starting...", flush=True)
    print(f"Python: {sys.executable}", flush=True)

    parser = argparse.ArgumentParser(
        description="Print Kite TOTP codes using the app's TotpProvider (compare with phone)."
    )
    parser.add_argument(
        "secret",
        nargs="?",
        help="Base32 TOTP secret (optional; else KITE_TOTP_SECRET or prompt)",
    )
    parser.add_argument(
        "--rd2033",
        action="store_true",
        help="Use built-in RD2033 test profile (env + DB user 13)",
    )
    parser.add_argument(
        "--watch",
        action="store_true",
        help="Refresh code every second until Ctrl+C",
    )
    args = parser.parse_args()

    if args.rd2033:
        _run_rd2033(args.watch)
        return

    secret = _resolve_secret(args.secret)

    if args.watch:
        print("Watching TOTP (Ctrl+C to stop)...")
        try:
            while True:
                print("-" * 40)
                _print_totp(secret)
                time.sleep(1)
        except KeyboardInterrupt:
            print("\nStopped.")
        return

    _print_totp(secret)


if __name__ == "__main__":
    main()
