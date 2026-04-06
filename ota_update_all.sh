#!/bin/bash
set -euo pipefail

# Build web assets + upload LittleFS + upload firmware via ElegantOTA in one run.
# Usage:
#   ./ota_update_all.sh <s3|s3-mini>

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

echo "Using OTA PlatformIO environment: $PIO_ENV"

echo "Building miniweb assets..."
pushd miniweb >/dev/null
npm install
npm run build
popd >/dev/null

echo "Uploading filesystem + firmware via OTA (single run)..."
pio run -e "$PIO_ENV" -t buildfs -t uploadfs -t upload

echo "OTA update complete (web assets + firmware)."
