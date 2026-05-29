class TotpProvider:
    """Generate TOTP codes from a base32 secret."""

    def generate(self, secret: str) -> str:
        try:
            import pyotp
        except Exception as exc:  # pragma: no cover - environment dependent
            raise RuntimeError("pyotp is not installed/configured") from exc
        cleaned = (secret or "").strip().replace(" ", "")
        if not cleaned:
            raise ValueError("Missing TOTP secret")
        return pyotp.TOTP(cleaned).now()

