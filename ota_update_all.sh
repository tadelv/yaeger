#!/bin/bash
set -euo pipefail

# Build web assets + upload LittleFS + upload firmware via ElegantOTA in one run.
# Usage:
#   ./ota_update_all.sh <s3|s3-mini>

VENV_DIR=".ota-venv"

if [[ -z "${1:-}" ]]; then
  echo "Usage: $0 <s3|s3-mini>"
  exit 1
fi

case "$1" in
  s3)
    PIO_ENV="esp32-s3-elegantota"
    ;;
  s3-mini)
    PIO_ENV="esp32-s3-mini-elegantota"
    ;;
  *)
    echo "Invalid argument: '$1'. Use 's3' or 's3-mini'."
    exit 1
    ;;
esac

ensure_ota_venv() {
  local python_cmd="${PYTHON_BIN:-python3}"

  if ! command -v "$python_cmd" >/dev/null 2>&1; then
    echo "Error: could not find Python executable '$python_cmd'."
    exit 1
  fi

  if [[ ! -d "$VENV_DIR" ]]; then
    echo "Creating OTA virtual environment in $VENV_DIR..."
    "$python_cmd" -m venv "$VENV_DIR"
  fi

  # shellcheck disable=SC1091
  source "$VENV_DIR/bin/activate"

  echo "Installing OTA toolchain dependencies in venv..."
  pip install --upgrade pip setuptools wheel >/dev/null
  pip install --upgrade platformio littlefs-python >/dev/null

  if ! command -v pio >/dev/null 2>&1; then
    echo "Error: 'pio' is not available in $VENV_DIR after install."
    exit 1
  fi
}

echo "Using OTA PlatformIO environment: $PIO_ENV"

ensure_ota_venv

echo "Building miniweb assets..."
pushd miniweb >/dev/null
npm install --no-audit --no-fund
npm run build
popd >/dev/null

echo "Uploading filesystem + firmware via OTA (single run)..."
pio run -e "$PIO_ENV" -t buildfs -t uploadfs -t upload

echo "OTA update complete (web assets + firmware)."
