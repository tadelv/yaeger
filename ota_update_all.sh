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

map_module_to_package() {
  case "$1" in
    littlefs)
      echo "littlefs-python"
      ;;
    fatfs)
      echo "fatfs-ng"
      ;;
    yaml)
      echo "pyyaml"
      ;;
    *)
      echo "$1"
      ;;
  esac
}

extract_missing_module() {
  local log_file="$1"
  local py_cmd="${PYTHON_BIN:-python3}"

  "$py_cmd" - "$log_file" <<'PY'
import re
import sys
from pathlib import Path

log_path = Path(sys.argv[1])
text = log_path.read_text(errors="ignore")
match = re.search(r"ModuleNotFoundError:\s+No module named ['\"]([^'\"]+)['\"]", text)
if match:
    print(match.group(1))
PY
}

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
  pip install --upgrade platformio littlefs-python fatfs-ng pyyaml >/dev/null

  if ! command -v pio >/dev/null 2>&1; then
    echo "Error: 'pio' is not available in $VENV_DIR after install."
    exit 1
  fi
}

run_pio_with_auto_deps() {
  local max_attempts=5
  local attempt=1
  local pio_args=("$@")

  while ((attempt <= max_attempts)); do
    local log_file
    log_file=$(mktemp)

    echo "PlatformIO attempt $attempt/$max_attempts: pio run ${pio_args[*]}"
    set +e
    pio run "${pio_args[@]}" 2>&1 | tee "$log_file"
    local status=${PIPESTATUS[0]}
    set -e

    if [[ $status -eq 0 ]]; then
      rm -f "$log_file"
      return 0
    fi

    local missing_module
    missing_module=$(extract_missing_module "$log_file")

    if [[ -z "$missing_module" ]]; then
      echo "PlatformIO failed, but no missing Python module could be detected."
      rm -f "$log_file"
      return "$status"
    fi

    local missing_package
    missing_package=$(map_module_to_package "$missing_module")

    echo "Detected missing Python module '$missing_module'. Installing package '$missing_package' and retrying..."
    pip install --upgrade "$missing_package" >/dev/null

    rm -f "$log_file"
    attempt=$((attempt + 1))
  done

  echo "Reached retry limit while trying to resolve PlatformIO Python dependencies."
  return 1
}

echo "Using OTA PlatformIO environment: $PIO_ENV"

ensure_ota_venv

echo "Building miniweb assets..."
pushd miniweb >/dev/null
npm install --no-audit --no-fund
npm run build
popd >/dev/null

echo "Step 1/2: Uploading LittleFS image via OTA..."
run_pio_with_auto_deps -e "$PIO_ENV" -t buildfs -t uploadfs

echo "Step 2/2: Uploading firmware via OTA..."
run_pio_with_auto_deps -e "$PIO_ENV" -t upload

echo "OTA update complete (web assets + firmware)."
