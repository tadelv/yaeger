#!/bin/bash

# The script will build and flash Yaeger to your ESP device.
# Ensure this script is executable (`chmod +x script.sh`) and has the correct permissions.

# Step 0: Check for required parameter (s3 or s3-mini)
if [[ -z "$1" ]]; then
    echo "Usage: $0 <s3 | s3-mini>"
    exit 1
fi

PIO_ENV="esp32-$1"

# Validate the provided environment
if [[ "$PIO_ENV" != "esp32-s3" && "$PIO_ENV" != "esp32-s3-mini" ]]; then
    echo "Invalid argument: '$1'. Use 's3' or 's3-mini'."
    exit 1
fi

echo "Using PlatformIO environment: $PIO_ENV"

# Step 1: Navigate to the miniweb directory
echo "Navigating to miniweb..."
cd miniweb || { echo "miniweb folder not found!"; exit 1; }

# Step 2: Install dependencies
echo "Installing dependencies with npm..."
npm install || { echo "npm install failed!"; exit 1; }

# Step 3: Build the web assets
echo "Building the web project..."
npm run build || { echo "npm build failed!"; exit 1; }

# Step 4: Return to the project root
echo "Returning to the project root..."
cd .. || exit 1

# Step 5: Erase the device memory (optional but recommended)
echo "Erasing the device memory..."
pio run -e "$PIO_ENV" -t erase || { echo "Memory erase failed!"; exit 1; }

# Step 6: Build and upload the SPIFFS filesystem
echo "Building and uploading SPIFFS filesystem..."
pio run -e "$PIO_ENV" -t buildfs -t uploadfs || { echo "SPIFFS upload failed!"; exit 1; }

# Step 7: Build and upload the firmware
echo "Building and uploading the firmware..."
pio run -e "$PIO_ENV" -t upload || { echo "Firmware build or upload failed!"; exit 1; }

echo "All tasks completed successfully!"
