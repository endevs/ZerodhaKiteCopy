import unittest
from unittest.mock import patch

from kite_auth.playwright_worker import _capture_request_token, _extract_request_token
from kite_auth.totp_provider import TotpProvider


class KiteAuthHelpersTests(unittest.TestCase):
    def test_extract_request_token_from_callback_url(self) -> None:
        url = "https://example.com/callback?request_token=abc123&action=login"
        self.assertEqual(_extract_request_token(url), "abc123")

    def test_extract_request_token_returns_none_when_missing(self) -> None:
        url = "https://example.com/callback?action=login"
        self.assertIsNone(_extract_request_token(url))

    def test_capture_request_token_stores_first_token_only(self) -> None:
        captured: list[str] = []
        _capture_request_token("http://localhost:8003/callback?request_token=first", captured)
        _capture_request_token("http://localhost:8003/callback?request_token=second", captured)
        self.assertEqual(captured, ["first"])

    @patch("pyotp.TOTP.now", return_value="123456")
    def test_totp_provider_generates_code(self, _now) -> None:
        provider = TotpProvider()
        code = provider.generate("JBSWY3DPEHPK3PXP")
        self.assertEqual(code, "123456")


if __name__ == "__main__":
    unittest.main()

