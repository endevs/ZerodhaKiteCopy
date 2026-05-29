import argparse
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from database import get_db_connection


def _ensure_legacy_tables() -> None:
    conn = get_db_connection()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS legacy_kite_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                legacy_user_id TEXT NOT NULL UNIQUE,
                name TEXT,
                email TEXT,
                api_key TEXT,
                api_secret TEXT,
                request_token TEXT,
                access_token TEXT,
                public_token TEXT,
                totp_secret TEXT,
                kite_password TEXT,
                strategy TEXT,
                allowed_exchanges TEXT,
                paper_trade_strategies TEXT,
                nfo_buy_and_sell TEXT,
                account_status TEXT,
                metadata_json TEXT,
                imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


def _read_properties_file(path: Path) -> Dict[str, str]:
    data: Dict[str, str] = {}
    if not path.exists():
        return data
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip()
    return data


def _read_list_of_user_accounts_raw(credentials_path: Path) -> str:
    if not credentials_path.exists():
        return ""
    lines = credentials_path.read_text(encoding="utf-8", errors="ignore").splitlines()
    collecting = False
    chunks: List[str] = []
    for raw_line in lines:
        line = raw_line.rstrip()
        stripped = line.strip()
        if not collecting:
            if stripped.startswith("listOfUserAccounts"):
                collecting = True
                if "=" in line:
                    _, right = line.split("=", 1)
                    right = right.strip()
                    if right and right != "\\":
                        chunks.append(right.rstrip("\\").strip())
                    if not line.endswith("\\"):
                        break
            continue
        if not stripped:
            break
        if stripped.startswith("#"):
            continue
        chunks.append(stripped.rstrip("\\").strip())
        if not line.endswith("\\"):
            break
    return ",".join(chunks)


def _parse_list_of_user_accounts(raw: str) -> List[Dict[str, Any]]:
    if not raw:
        return []
    items = [item.strip().rstrip(",") for item in raw.split(",") if item.strip()]
    accounts: List[Dict[str, Any]] = []
    for item in items:
        parts = item.split("-")
        if len(parts) < 13:
            continue
        accounts.append(
            {
                "legacy_user_id": parts[0].strip(),
                "api_key": parts[1].strip(),
                "api_secret": parts[2].strip(),
                "name": parts[3].strip(),
                "request_token": parts[5].strip() if len(parts) > 5 else None,
                "access_token": parts[6].strip() if len(parts) > 6 else None,
                "public_token": parts[7].strip() if len(parts) > 7 else None,
                "strategy": parts[8].strip() if len(parts) > 8 else None,
                "allowed_exchanges": parts[10].strip() if len(parts) > 10 else None,
                "paper_trade_strategies": parts[11].strip() if len(parts) > 11 else None,
                "nfo_buy_and_sell": parts[12].strip() if len(parts) > 12 else None,
            }
        )
    return accounts


def _read_user_property_data(trade9_root: Path, user_id: str) -> Dict[str, Any]:
    props_file = trade9_root / "Properties" / f"{user_id}.txt"
    props = _read_properties_file(props_file)
    return {
        "email": props.get("eMail"),
        "totp_secret": props.get("TOTP"),
        "kite_password": props.get("kitePassWord"),
        "account_status": props.get("tradable"),
        "metadata": props,
    }


def _read_token_file(trade9_root: Path, user_id: str) -> Tuple[Optional[str], Optional[str]]:
    token_file = trade9_root / "Token" / f"{user_id}.txt"
    if not token_file.exists():
        return None, None
    lines = [
        line.strip()
        for line in token_file.read_text(encoding="utf-8", errors="ignore").splitlines()
        if line.strip()
    ]
    access_token = lines[0] if len(lines) > 0 else None
    public_token = lines[1] if len(lines) > 1 else None
    return access_token, public_token


def _upsert_account(account: Dict[str, Any]) -> None:
    conn = get_db_connection()
    try:
        conn.execute(
            """
            INSERT INTO legacy_kite_accounts (
                legacy_user_id, name, email, api_key, api_secret, request_token,
                access_token, public_token, totp_secret, kite_password, strategy,
                allowed_exchanges, paper_trade_strategies, nfo_buy_and_sell, account_status, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(legacy_user_id) DO UPDATE SET
                name = excluded.name,
                email = excluded.email,
                api_key = excluded.api_key,
                api_secret = excluded.api_secret,
                request_token = excluded.request_token,
                access_token = excluded.access_token,
                public_token = excluded.public_token,
                totp_secret = excluded.totp_secret,
                kite_password = excluded.kite_password,
                strategy = excluded.strategy,
                allowed_exchanges = excluded.allowed_exchanges,
                paper_trade_strategies = excluded.paper_trade_strategies,
                nfo_buy_and_sell = excluded.nfo_buy_and_sell,
                account_status = excluded.account_status,
                metadata_json = excluded.metadata_json,
                imported_at = CURRENT_TIMESTAMP
            """,
            (
                account.get("legacy_user_id"),
                account.get("name"),
                account.get("email"),
                account.get("api_key"),
                account.get("api_secret"),
                account.get("request_token"),
                account.get("access_token"),
                account.get("public_token"),
                account.get("totp_secret"),
                account.get("kite_password"),
                account.get("strategy"),
                account.get("allowed_exchanges"),
                account.get("paper_trade_strategies"),
                account.get("nfo_buy_and_sell"),
                account.get("account_status"),
                json.dumps(account.get("metadata", {}), ensure_ascii=True),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def import_trade9_accounts(trade9_root: Path, dry_run: bool) -> int:
    credentials_file = trade9_root / "credentials.properties"
    accounts_raw = _read_list_of_user_accounts_raw(credentials_file)
    accounts = _parse_list_of_user_accounts(accounts_raw)

    imported = 0
    for account in accounts:
        user_id = account["legacy_user_id"]
        user_data = _read_user_property_data(trade9_root, user_id)
        token_access, token_public = _read_token_file(trade9_root, user_id)

        account["email"] = user_data.get("email")
        account["totp_secret"] = user_data.get("totp_secret")
        account["kite_password"] = user_data.get("kite_password")
        account["account_status"] = user_data.get("account_status")
        account["metadata"] = user_data.get("metadata", {})

        if token_access:
            account["access_token"] = token_access
        if token_public:
            account["public_token"] = token_public

        if dry_run:
            print(
                json.dumps(
                    {
                        "legacy_user_id": account["legacy_user_id"],
                        "name": account.get("name"),
                        "email": account.get("email"),
                        "api_key": account.get("api_key"),
                        "api_secret": account.get("api_secret"),
                        "request_token": account.get("request_token"),
                        "access_token": account.get("access_token"),
                        "public_token": account.get("public_token"),
                        "totp_secret": account.get("totp_secret"),
                        "kite_password": account.get("kite_password"),
                        "account_status": account.get("account_status"),
                    },
                    ensure_ascii=True,
                )
            )
        else:
            _upsert_account(account)
        imported += 1
    return imported


def main() -> None:
    # Ensure config.DATABASE_PATH relative paths resolve the same way as backend app startup.
    os.chdir(Path(__file__).resolve().parent)

    parser = argparse.ArgumentParser(description="Import Trade9 Zerodha credentials into legacy_kite_accounts")
    parser.add_argument(
        "--trade9-root",
        default=r"D:\Others\SVN\trade9\Trade9_Web_Dev",
        help="Path to Trade9_Web_Dev root",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print parsed accounts without writing DB")
    args = parser.parse_args()

    root = Path(args.trade9_root)
    if not root.exists():
        raise SystemExit(f"Trade9 root not found: {root}")

    _ensure_legacy_tables()
    imported = import_trade9_accounts(root, args.dry_run)
    mode = "dry-run parsed" if args.dry_run else "imported/upserted"
    print(f"{mode}: {imported} accounts")


if __name__ == "__main__":
    main()

