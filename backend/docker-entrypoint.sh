#!/bin/bash
set -e

# Virtual display for headed Chromium inside Docker (Kite 2FA renders more reliably).
if command -v Xvfb >/dev/null 2>&1; then
  export DISPLAY="${DISPLAY:-:99}"
  Xvfb "${DISPLAY}" -screen 0 1280x720x24 -ac +extension GLX +render -noreset &
  sleep 1
fi

exec "$@"
