from __future__ import annotations

import datetime
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Callable, Dict, Optional, TypedDict

from .playwright_worker import PlaywrightAuthCredentials, authenticate_and_get_request_token

logger = logging.getLogger(__name__)


class AuthState(TypedDict):
    status: str
    reason: Optional[str]
    attempts: int
    started_at: Optional[str]
    updated_at: str
    finished_at: Optional[str]


@dataclass(frozen=True)
class AuthJobInput:
    app_user_id: int
    app_key: str
    api_secret: str
    kite_user_id: str
    kite_password: str
    kite_totp_secret: str
    redirect_uri: str


def _utc_now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


class ZerodhaPlaywrightAuthOrchestrator:
    def __init__(
        self,
        exchange_request_token: Callable[[int, str, str], Dict[str, object]],
        validate_login_state: Callable[[int], bool],
        max_attempts: int = 2,
        on_finished: Optional[Callable[[int, str, Optional[str]], None]] = None,
    ) -> None:
        self._exchange_request_token = exchange_request_token
        self._validate_login_state = validate_login_state
        self._max_attempts = max_attempts
        self._on_finished = on_finished
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="kite-auth")
        self._attempt_timeout_seconds = int(os.getenv("KITE_AUTOMATION_ATTEMPT_TIMEOUT_SECONDS", "120"))
        self._state: Dict[int, AuthState] = {}
        self._lock = threading.Lock()

    def get_state(self, app_user_id: int) -> AuthState:
        with self._lock:
            return self._state.get(
                app_user_id,
                {
                    "status": "idle",
                    "reason": None,
                    "attempts": 0,
                    "started_at": None,
                    "updated_at": _utc_now(),
                    "finished_at": None,
                },
            )

    def start(self, payload: AuthJobInput) -> bool:
        with self._lock:
            current = self._state.get(payload.app_user_id)
            if current and current.get("status") == "running":
                return False
            self._state[payload.app_user_id] = {
                "status": "running",
                "reason": None,
                "attempts": 0,
                "started_at": _utc_now(),
                "updated_at": _utc_now(),
                "finished_at": None,
            }
        self._executor.submit(self._run, payload)
        return True

    def reset_terminal_state(self, app_user_id: int) -> None:
        """Clear succeeded/failed state so stale auto-auth status cannot re-trigger redirects."""
        with self._lock:
            current = self._state.get(app_user_id)
            if not current or current.get("status") not in {"succeeded", "failed", "needs_manual"}:
                return
            self._state[app_user_id] = {
                "status": "idle",
                "reason": None,
                "attempts": 0,
                "started_at": None,
                "updated_at": _utc_now(),
                "finished_at": None,
            }

    def _set_state(
        self,
        app_user_id: int,
        *,
        status: str,
        reason: Optional[str] = None,
        attempts: Optional[int] = None,
    ) -> None:
        with self._lock:
            current = self._state.get(
                app_user_id,
                {
                    "status": "idle",
                    "reason": None,
                    "attempts": 0,
                    "started_at": None,
                    "updated_at": _utc_now(),
                    "finished_at": None,
                },
            )
            current["status"] = status
            current["reason"] = reason
            if attempts is not None:
                current["attempts"] = attempts
            now = _utc_now()
            current["updated_at"] = now
            if status in {"succeeded", "failed", "needs_manual"}:
                current["finished_at"] = now
            self._state[app_user_id] = current
        if status in {"succeeded", "failed", "needs_manual"} and self._on_finished:
            try:
                self._on_finished(app_user_id, status, reason)
            except Exception as exc:
                logger.warning("Auto-auth on_finished hook failed for user %s: %s", app_user_id, exc)

    def _run(self, payload: AuthJobInput) -> None:
        logger.info("Automated Zerodha auth run started for app_user_id=%s", payload.app_user_id)
        # #region agent log
        try:
            from debug_agent_log import agent_log

            agent_log(
                "orchestrator.py:_run:start",
                "Auth orchestrator run started",
                {"app_user_id": payload.app_user_id, "max_attempts": self._max_attempts},
                "B,C",
            )
        except Exception:
            pass
        # #endregion
        last_reason: Optional[str] = None
        for attempt in range(1, self._max_attempts + 1):
            self._set_state(payload.app_user_id, status="running", attempts=attempt)
            if not self._validate_login_state(payload.app_user_id):
                self._set_state(payload.app_user_id, status="failed", reason="user_not_logged_in", attempts=attempt)
                return
            try:
                creds = PlaywrightAuthCredentials(
                    app_key=payload.app_key,
                    user_id=payload.kite_user_id,
                    password=payload.kite_password,
                    totp_secret=payload.kite_totp_secret,
                    redirect_uri=payload.redirect_uri,
                )
                logger.info(
                    "Automated Zerodha auth attempt started for app_user_id=%s attempt=%s timeout=%ss",
                    payload.app_user_id,
                    attempt,
                    self._attempt_timeout_seconds,
                )
                with ThreadPoolExecutor(max_workers=1, thread_name_prefix="kite-auth-attempt") as per_attempt_executor:
                    attempt_timeout_ms = self._attempt_timeout_seconds * 1000
                    future = per_attempt_executor.submit(
                        authenticate_and_get_request_token,
                        creds,
                        attempt_timeout_ms,
                    )
                    request_token = future.result(timeout=self._attempt_timeout_seconds)
                self._exchange_request_token(payload.app_user_id, request_token, "auto_playwright")
                self._set_state(payload.app_user_id, status="succeeded", reason=None, attempts=attempt)
                logger.info("Automated Zerodha auth succeeded for app_user_id=%s", payload.app_user_id)
                return
            except TimeoutError:
                last_reason = "timeout"
                logger.warning(
                    "Automated Zerodha auth timed out for app_user_id=%s attempt=%s timeout=%ss",
                    payload.app_user_id,
                    attempt,
                    self._attempt_timeout_seconds,
                )
            except Exception as exc:  # pragma: no cover - runtime dependent
                text = str(exc).lower()
                if "request_token" in text:
                    last_reason = "request_token_missing"
                elif "external_2fa" in text:
                    last_reason = "external_2fa_required"
                elif "otp" in text or "totp" in text:
                    last_reason = "otp_rejected"
                elif "selector" in text:
                    last_reason = "selector_mismatch"
                else:
                    last_reason = "exchange_failed"
                logger.warning(
                    "Automated Zerodha auth failed for app_user_id=%s attempt=%s reason=%s err=%s",
                    payload.app_user_id,
                    attempt,
                    last_reason,
                    exc,
                )
                # #region agent log
                try:
                    from debug_agent_log import agent_log

                    agent_log(
                        "orchestrator.py:_run:auth_failed",
                        "Zerodha auth failed",
                        {
                            "app_user_id": payload.app_user_id,
                            "attempt": attempt,
                            "reason": last_reason,
                            "error_type": type(exc).__name__,
                            "error_msg": str(exc)[:300],
                        },
                        "B",
                    )
                except Exception:
                    pass
                # #endregion

        final_status = (
            "needs_manual"
            if last_reason in {"otp_rejected", "selector_mismatch", "external_2fa_required"}
            else "failed"
        )
        self._set_state(
            payload.app_user_id,
            status=final_status,
            reason=last_reason or "unknown",
            attempts=self._max_attempts,
        )
        logger.info("Automated Zerodha auth ended with status=%s for app_user_id=%s", final_status, payload.app_user_id)

