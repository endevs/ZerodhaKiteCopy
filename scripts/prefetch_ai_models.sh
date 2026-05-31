#!/usr/bin/env bash
# One-time HuggingFace model prefetch for Ubuntu prod (run on host before or after first deploy).
# Requires: pip install huggingface_hub (or run inside backend container).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${DATA_DIR:-$ROOT_DIR/data}"
TIMESFM_DIR="${TIMESFM_DIR:-$DATA_DIR/timesfm_model}"
MOIRAI_DIR="${MOIRAI_DIR:-$DATA_DIR/moirai_model}"

mkdir -p "$TIMESFM_DIR" "$MOIRAI_DIR" "$DATA_DIR/models"

download() {
  if command -v huggingface-cli >/dev/null 2>&1; then
    huggingface-cli download "$1" --local-dir "$2"
  else
    python - <<PY
from huggingface_hub import snapshot_download
snapshot_download(repo_id="${1}", local_dir="${2}")
PY
  fi
}

echo "==> Prefetch TimesFM weights to $TIMESFM_DIR"
download "google/timesfm-2.5-200m-pytorch" "$TIMESFM_DIR"

if [[ "${PREFETCH_MOIRAI:-0}" == "1" ]]; then
  echo "==> Prefetch Moirai weights to $MOIRAI_DIR"
  download "Salesforce/moirai-2.0-R-small" "$MOIRAI_DIR"
fi

echo "Done. Model dirs:"
ls -la "$TIMESFM_DIR" | head -20
echo "Mount these paths in docker-compose (timesfm_model, moirai_model, models under ./data)."
