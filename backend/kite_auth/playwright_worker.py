from __future__ import annotations

import logging
import os
import re
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, quote_plus, urlparse

from debug_agent_log import agent_log
from .totp_provider import TotpProvider

logger = logging.getLogger(__name__)

_EXTERNAL_2FA_MARKERS = (
    "approve on",
    "kite app",
    "open kite",
    "scan qr",
    "verify on your",
)

# Kite reuses #userid for the 6-digit TOTP field after password submit (type=number, maxLength=6).
_IS_OTP_INPUT_JS = """(i) => {
    if (i.id === 'password') return false;
    if (i.id === 'userid') {
        const t = (i.type || '').toLowerCase();
        if (t === 'number' || i.maxLength === 6) return true;
        return false;
    }
    const t = (i.type || '').toLowerCase();
    if (t === 'tel' || t === 'number') return true;
    if (i.inputMode === 'numeric') return true;
    if (i.autocomplete === 'one-time-code') return true;
    if (i.maxLength === 1 && t === 'text') return true;
    if (i.maxLength === 6 && (t === 'text' || t === 'password')) return true;
    if (t === 'text' && i.getAttribute('pattern') === '[0-9]*') return true;
    return false;
}"""


@dataclass(frozen=True)
class PlaywrightAuthCredentials:
    app_key: str
    user_id: str
    password: str
    totp_secret: str
    redirect_uri: str


def _is_headed_env() -> bool:
    return os.getenv("KITE_AUTOMATION_HEADED", "").lower() in ("1", "true", "yes")


def _is_headless_forced() -> bool:
    return os.getenv("KITE_AUTOMATION_HEADLESS", "").lower() in ("1", "true", "yes")


def _should_run_headed() -> bool:
    if _is_headless_forced():
        return False
    if _is_headed_env():
        return True
    in_docker = os.getenv("PLAYWRIGHT_IN_DOCKER", "").lower() in ("1", "true", "yes")
    if in_docker and os.getenv("DISPLAY", "").strip():
        return True
    return False


def _debug_artifacts_dir() -> str:
    candidates: list[str] = []
    db_path = (os.environ.get("DATABASE_PATH") or "").strip()
    if db_path:
        candidates.append(os.path.dirname(os.path.abspath(db_path)))
    debug_dir = (os.environ.get("PLAYWRIGHT_DEBUG_DIR") or "").strip()
    if debug_dir:
        candidates.append(debug_dir)
    candidates.append("/app/data")
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    candidates.append(os.path.join(base, "data"))

    seen: set[str] = set()
    for candidate in candidates:
        if not candidate:
            continue
        path = os.path.abspath(candidate)
        if path in seen:
            continue
        seen.add(path)
        try:
            os.makedirs(path, exist_ok=True)
            return path
        except OSError:
            continue
    return base


def _save_debug_artifact(page, step: str) -> Optional[str]:
    snapshot = _page_input_snapshot(page)
    agent_log(
        f"playwright_worker.py:{step}",
        "Playwright debug snapshot",
        snapshot,
        "H1",
    )
    screenshot_path: Optional[str] = None
    try:
        screenshot_path = os.path.join(_debug_artifacts_dir(), f"playwright_debug_{step}.png")
        page.screenshot(path=screenshot_path, full_page=True)
        logger.info("Playwright debug screenshot saved: %s", screenshot_path)
    except Exception as exc:
        logger.warning("Could not save Playwright screenshot for step=%s: %s", step, exc)
    return screenshot_path


def _build_login_url(app_key: str, redirect_uri: str) -> str:
    return (
        "https://kite.zerodha.com/connect/login"
        f"?api_key={quote_plus(app_key)}&redirect_uri={quote_plus(redirect_uri)}&v=3"
    )


def _chromium_launch_args() -> list[str]:
    """Docker/Linux containers need no-sandbox; reduce automation fingerprint."""
    args = ["--disable-blink-features=AutomationControlled"]
    if os.getenv("PLAYWRIGHT_IN_DOCKER", "").lower() in ("1", "true", "yes"):
        args.extend(
            [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
            ]
        )
    return args


def _apply_stealth(page) -> None:
    page.add_init_script(
        "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"
    )


def _extract_request_token(url: str) -> Optional[str]:
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    values = params.get("request_token")
    if not values:
        return None
    return values[0]


def _capture_request_token(url: str, captured: List[str]) -> None:
    token = _extract_request_token(url)
    if token and not captured:
        captured.append(token)
        logger.info(
            "Playwright auth captured request_token (path=%s)",
            urlparse(url).path or "/",
        )


def _page_input_snapshot(page) -> Dict[str, Any]:
    try:
        return page.evaluate(
            """() => {
                const visible = (el) => !!(el.offsetParent || el.getClientRects().length);
                const inputs = Array.from(document.querySelectorAll('input'))
                  .filter(visible)
                  .map((i) => ({
                    type: i.type || '',
                    id: i.id || '',
                    name: i.name || '',
                    maxLength: i.maxLength >= 0 ? i.maxLength : null,
                    inputMode: i.inputMode || '',
                    autoComplete: i.autocomplete || '',
                    placeholder: (i.placeholder || '').slice(0, 40),
                  }));
                const bodyText = (document.body && document.body.innerText || '')
                  .replace(/\\s+/g, ' ')
                  .trim()
                  .slice(0, 300);
                return { url: location.href, title: document.title || '', inputs, bodyText };
            }"""
        )
    except Exception as exc:
        return {"url": page.url, "error": str(exc)}


def _visible_login_error(page) -> Optional[str]:
    try:
        return page.evaluate(
            """() => {
                const visible = (el) => !!(el.offsetParent || el.getClientRects().length);
                const nodes = Array.from(document.querySelectorAll(
                    '.error, .alert, [role="alert"], .message, .su-input-error'
                ));
                for (const node of nodes) {
                    if (!visible(node)) continue;
                    const text = (node.textContent || '').replace(/\\s+/g, ' ').trim();
                    if (text.length > 3) return text.slice(0, 200);
                }
                return null;
            }"""
        )
    except Exception:
        return None


def _body_text_lower(page) -> str:
    try:
        return (page.evaluate("() => (document.body && document.body.innerText) || '')") or "").lower()
    except Exception:
        return ""


def _detect_external_2fa(page) -> bool:
    text = _body_text_lower(page)
    if not text:
        return False
    if not any(marker in text for marker in _EXTERNAL_2FA_MARKERS):
        return False
    return _count_otp_like_inputs(page) == 0


def _count_otp_like_inputs_on_root(page_or_frame) -> int:
    return int(
        page_or_frame.evaluate(
            f"""() => {{
                const visible = (el) => !!(el.offsetParent || el.getClientRects().length);
                const isOtpInput = {_IS_OTP_INPUT_JS};
                const inputs = Array.from(document.querySelectorAll('input')).filter(visible);
                return inputs.filter(isOtpInput).length;
            }}"""
        )
    )


def _count_otp_like_inputs(page) -> int:
    total = _count_otp_like_inputs_on_root(page)
    for frame in page.frames:
        if frame == page.main_frame:
            continue
        try:
            total += _count_otp_like_inputs_on_root(frame)
        except Exception:
            continue
    return total


def _otp_selector() -> str:
    return (
        "#userid[type='number'], "
        "#userid[maxlength='6'], "
        "input[autocomplete='one-time-code'], "
        "input[type='tel']:not(#password), "
        "input[type='number']:not(#password), "
        "input[inputmode='numeric']:not(#password), "
        "input[type='text'][maxlength='1'], "
        "input[type='text'][maxlength='6']:not(#userid), "
        "input[type='text'][pattern*='0-9']:not(#password)"
    )


def _otp_locator(page):
    """Prefer main frame; fall back to child frames (Kite sometimes embeds 2FA)."""
    selector = _otp_selector()
    main = page.locator(selector)
    if main.count() > 0:
        return main
    for frame in page.frames:
        if frame == page.main_frame:
            continue
        try:
            loc = frame.locator(selector)
            if loc.count() > 0:
                return loc
        except Exception:
            continue
    return main


def _wait_after_password_submit(page, timeout_ms: int) -> None:
    page.wait_for_load_state("domcontentloaded", timeout=min(timeout_ms, 20_000))
    deadline = time.monotonic() + (timeout_ms / 1000.0)
    while time.monotonic() < deadline:
        if _detect_external_2fa(page):
            raise RuntimeError(
                "external_2fa_required: Kite is asking for app approval, not a TOTP field. "
                "Use manual Authenticate with Zerodha."
            )
        if _count_otp_like_inputs(page) > 0:
            return
        login_error = _visible_login_error(page)
        if login_error:
            raise RuntimeError(f"otp rejected: {login_error}")
        page.wait_for_timeout(250)
    raise TimeoutError(
        f"Timed out waiting for OTP inputs after password submit; last_url={page.url}"
    )


def _wait_for_otp_inputs(page, timeout_ms: int) -> None:
    deadline = time.monotonic() + (timeout_ms / 1000.0)
    last_error: Optional[Exception] = None
    while time.monotonic() < deadline:
        remaining_ms = max(500, int((deadline - time.monotonic()) * 1000))
        try:
            if _count_otp_like_inputs(page) > 0:
                return
            page.wait_for_function(
                f"""() => {{
                    const visible = (el) => !!(el.offsetParent || el.getClientRects().length);
                    const isOtpInput = {_IS_OTP_INPUT_JS};
                    const inputs = Array.from(document.querySelectorAll('input')).filter(visible);
                    return inputs.some(isOtpInput);
                }}""",
                timeout=min(remaining_ms, 5000),
            )
            return
        except Exception as exc:
            last_error = exc
            if _detect_external_2fa(page):
                raise RuntimeError(
                    "external_2fa_required: Kite is asking for app approval, not a TOTP field."
                ) from exc
    if last_error:
        raise last_error
    raise TimeoutError("Timed out waiting for OTP inputs")


def _fill_otp_fields(page, otp: str) -> bool:
    otp_inputs = _otp_locator(page)
    count = otp_inputs.count()
    if count >= 6:
        logger.info("Playwright auth step=otp_fill_segmented count=%s", count)
        for idx, digit in enumerate(otp[:6]):
            otp_inputs.nth(idx).fill(digit)
        return True
    if count >= 1:
        logger.info("Playwright auth step=otp_fill_single count=%s", count)
        otp_inputs.first.fill(otp)
        return True
    return False


def _submit_otp(page) -> None:
    submit = page.locator("button[type='submit']")
    if submit.count() > 0:
        try:
            submit.first.click(timeout=5000)
            return
        except Exception:
            pass
    page.keyboard.press("Enter")


def _url_has_request_token(page) -> bool:
    return _extract_request_token(page.url) is not None


def _fill_otp(page, totp_secret: str, timeout_ms: int) -> None:
    agent_log(
        "playwright_worker.py:_fill_otp:entry",
        "OTP fill starting",
        {"url": page.url, "timeout_ms": timeout_ms, "otp_like": _count_otp_like_inputs(page)},
        "H4",
    )

    if _count_otp_like_inputs(page) == 0:
        _wait_for_otp_inputs(page, min(timeout_ms, 30_000))

    snapshot = _page_input_snapshot(page)
    otp_like_count = _count_otp_like_inputs(page)
    agent_log(
        "playwright_worker.py:_fill_otp:detected",
        "OTP-like inputs detected",
        {"otp_like_count": otp_like_count, **snapshot},
        "H1",
    )

    login_error = _visible_login_error(page)
    if login_error:
        raise RuntimeError(f"otp rejected: {login_error}")

    otp = TotpProvider().generate(totp_secret)
    if not _fill_otp_fields(page, otp):
        raise RuntimeError("selector_mismatch: OTP inputs not fillable")


def _fill_and_submit_otp(page, totp_secret: str, timeout_ms: int) -> None:
    _fill_otp(page, totp_secret, timeout_ms)
    logger.info("Playwright auth step=submit_otp")
    _submit_otp(page)

    if _url_has_request_token(page):
        return

    try:
        page.wait_for_url(re.compile(r".*request_token=.*"), timeout=5000)
        return
    except Exception:
        pass

    logger.info("Playwright auth step=otp_retry fresh TOTP")
    otp = TotpProvider().generate(totp_secret)
    if _fill_otp_fields(page, otp):
        _submit_otp(page)


def _wait_for_request_token(page, timeout_ms: int) -> str:
    captured: List[str] = []

    def on_frame(frame) -> None:
        if frame == page.main_frame:
            _capture_request_token(frame.url, captured)

    def on_request(request) -> None:
        _capture_request_token(request.url, captured)

    page.on("framenavigated", on_frame)
    page.on("request", on_request)

    _capture_request_token(page.url, captured)
    if captured:
        return captured[0]

    token_url_pattern = re.compile(r".*request_token=.*")
    deadline = time.monotonic() + (timeout_ms / 1000.0)
    last_error: Optional[Exception] = None

    while time.monotonic() < deadline and not captured:
        remaining_ms = max(500, int((deadline - time.monotonic()) * 1000))
        try:
            page.wait_for_url(token_url_pattern, timeout=min(remaining_ms, 5000))
        except Exception as exc:
            last_error = exc
        _capture_request_token(page.url, captured)
        if captured:
            return captured[0]
        page.wait_for_timeout(250)

    if captured:
        return captured[0]

    logger.warning(
        "Playwright auth could not capture request_token; last_url=%s",
        page.url,
    )
    agent_log(
        "playwright_worker.py:_wait_for_request_token:timeout",
        "request_token not captured",
        _page_input_snapshot(page),
        "H5",
    )
    if last_error:
        raise TimeoutError(
            f"Timed out waiting for Kite request_token; last_url={page.url}"
        ) from last_error
    raise TimeoutError(f"Timed out waiting for Kite request_token; last_url={page.url}")


def authenticate_and_get_request_token(
    creds: PlaywrightAuthCredentials,
    timeout_ms: int = 45_000,
) -> str:
    """
    Login to Kite with Playwright and return request_token from redirect URL.
    """
    try:
        from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
        from playwright.sync_api import sync_playwright
    except Exception as exc:  # pragma: no cover - runtime environment dependent
        raise RuntimeError("Playwright is not installed/configured") from exc

    login_url = _build_login_url(creds.app_key, creds.redirect_uri)
    headed = _should_run_headed()

    logger.info(
        "Playwright auth started for user_id=%s headed=%s display=%s",
        creds.user_id,
        headed,
        os.getenv("DISPLAY", ""),
    )
    agent_log(
        "playwright_worker.py:authenticate:entry",
        "Playwright auth run",
        {
            "redirect_host": urlparse(creds.redirect_uri).netloc,
            "redirect_path": urlparse(creds.redirect_uri).path,
            "timeout_ms": timeout_ms,
            "headed": headed,
            "display": os.getenv("DISPLAY", ""),
            "in_docker": os.getenv("PLAYWRIGHT_IN_DOCKER", ""),
            "headed_env": os.getenv("KITE_AUTOMATION_HEADED", ""),
            "headless_forced": os.getenv("KITE_AUTOMATION_HEADLESS", ""),
        },
        "A",
    )

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(
                headless=not headed,
                args=_chromium_launch_args(),
                ignore_default_args=["--enable-automation"],
            )
        except Exception as launch_exc:
            # #region agent log
            agent_log(
                "playwright_worker.py:authenticate:launch_failed",
                "Chromium launch failed",
                {
                    "headed": headed,
                    "display": os.getenv("DISPLAY", ""),
                    "error_type": type(launch_exc).__name__,
                    "error_msg": str(launch_exc)[:300],
                },
                "A,C",
            )
            # #endregion
            raise
        # #region agent log
        agent_log(
            "playwright_worker.py:authenticate:launch_ok",
            "Chromium launched",
            {"headed": headed, "display": os.getenv("DISPLAY", "")},
            "A",
        )
        # #endregion
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 720},
        )
        page = context.new_page()
        _apply_stealth(page)
        current_step = "unknown"
        try:
            current_step = "goto_login"
            logger.info("Playwright auth step=goto_login")
            page.goto(login_url, wait_until="domcontentloaded", timeout=timeout_ms)

            current_step = "fill_user_password"
            logger.info("Playwright auth step=fill_user_password")
            page.locator("#userid").first.fill(creds.user_id)
            page.locator("#password").first.fill(creds.password)
            logger.info("Playwright auth step=submit_user_password")
            page.locator("button[type='submit']").first.click()

            current_step = "post_password_wait"
            logger.info("Playwright auth step=post_password_wait")
            _wait_after_password_submit(page, timeout_ms)
            agent_log(
                "playwright_worker.py:authenticate:post_password",
                "Page state after password submit",
                _page_input_snapshot(page),
                "H2",
            )

            current_step = "otp_input_detect"
            logger.info("Playwright auth step=otp_input_detect")
            _fill_and_submit_otp(page, creds.totp_secret, timeout_ms)

            current_step = "wait_callback"
            logger.info("Playwright auth step=wait_callback")
            return _wait_for_request_token(page, timeout_ms)
        except PlaywrightTimeoutError as exc:
            _save_debug_artifact(page, current_step)
            logger.warning("Playwright auth timeout last_url=%s step=%s", page.url, current_step)
            if _detect_external_2fa(page):
                raise RuntimeError(
                    "external_2fa_required: Kite requires app approval instead of TOTP input"
                ) from exc
            if _count_otp_like_inputs(page) == 0:
                raise RuntimeError(
                    f"selector_mismatch: OTP inputs not found; last_url={page.url}"
                ) from exc
            raise TimeoutError(
                f"Timed out while performing Playwright Kite login flow; last_url={page.url}"
            ) from exc
        except Exception:
            _save_debug_artifact(page, current_step)
            raise
        finally:
            context.close()
            browser.close()
