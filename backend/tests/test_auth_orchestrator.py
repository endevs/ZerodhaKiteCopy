import unittest
from unittest.mock import patch

from kite_auth.orchestrator import AuthJobInput, ZerodhaPlaywrightAuthOrchestrator


class AuthOrchestratorTests(unittest.TestCase):
    def test_reports_succeeded_when_exchange_passes(self) -> None:
        exchanges = []

        def _exchange(user_id: int, request_token: str, source: str):
            exchanges.append((user_id, request_token, source))
            return {"ok": True}

        orch = ZerodhaPlaywrightAuthOrchestrator(
            exchange_request_token=_exchange,
            validate_login_state=lambda _: True,
            max_attempts=1,
        )
        payload = AuthJobInput(
            app_user_id=1,
            app_key="key",
            api_secret="secret",
            kite_user_id="RD2033",
            kite_password="pass",
            kite_totp_secret="totp",
            redirect_uri="http://localhost:8003/callback",
        )

        with patch("kite_auth.orchestrator.authenticate_and_get_request_token", return_value="req-token"):
            orch._run(payload)  # direct call keeps unit test deterministic

        state = orch.get_state(1)
        self.assertEqual(state["status"], "succeeded")
        self.assertEqual(len(exchanges), 1)

    def test_moves_to_needs_manual_on_repeated_otp_failure(self) -> None:
        orch = ZerodhaPlaywrightAuthOrchestrator(
            exchange_request_token=lambda *_: {"ok": True},
            validate_login_state=lambda _: True,
            max_attempts=2,
        )
        payload = AuthJobInput(
            app_user_id=2,
            app_key="key",
            api_secret="secret",
            kite_user_id="RD2033",
            kite_password="pass",
            kite_totp_secret="totp",
            redirect_uri="http://localhost:8003/callback",
        )

        with patch(
            "kite_auth.orchestrator.authenticate_and_get_request_token",
            side_effect=RuntimeError("otp rejected"),
        ):
            orch._run(payload)

        state = orch.get_state(2)
        self.assertEqual(state["status"], "needs_manual")
        self.assertEqual(state["reason"], "otp_rejected")
        self.assertEqual(state["attempts"], 2)


if __name__ == "__main__":
    unittest.main()

