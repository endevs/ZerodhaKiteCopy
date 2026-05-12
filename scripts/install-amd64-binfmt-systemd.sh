#!/usr/bin/env bash
# Install boot-time amd64 binfmt for aarch64 hosts (Graviton + Hub amd64-only images).
# Run on the EC2 host once (requires sudo):
#   sudo bash scripts/install-amd64-binfmt-systemd.sh
#
# From repo clone root, or pass REPO_ROOT=/path/to/ZerodhaKiteGit
set -euo pipefail
REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
UNIT_SRC="${REPO_ROOT}/scripts/systemd/docker-amd64-binfmt.service"
UNIT_DST="/etc/systemd/system/docker-amd64-binfmt.service"

if [[ "$(uname -m)" != "aarch64" && "$(uname -m)" != "arm64" ]]; then
  echo "This host is $(uname -m); binfmt install is only needed on aarch64/arm64. Skipping."
  exit 0
fi

if [[ ! -f "$UNIT_SRC" ]]; then
  echo "error: missing $UNIT_SRC" >&2
  exit 1
fi

if [[ ${EUID:-0} -ne 0 ]]; then
  echo "error: run with sudo" >&2
  exit 1
fi

install -m 0644 "$UNIT_SRC" "$UNIT_DST"
systemctl daemon-reload
systemctl enable docker-amd64-binfmt.service
systemctl start docker-amd64-binfmt.service
echo "Installed $UNIT_DST — enabled for boot. Status:"
systemctl status docker-amd64-binfmt.service --no-pager || true
