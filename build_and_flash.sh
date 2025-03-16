#!/bin/bash

# The script will build and flash Yaeger to your ESP device.
# Make sure the file is executable (`chmod +x script.sh`) and that you have read/write permissions on the folder.
# If cloned from GitHub and not downloaded, ensure all folders have the correct permissions (`chmod -R u+rwX .`), 
# as the SPIFFS filesystem will probably fail otherwise.

# Step 1: Navigate to the miniweb directory
echo "Navigating to miniweb..."
cd miniweb || { echo "miniweb folder not found!"; exit 1; }

# Step 2: Install dependencies
echo "Installing dependencies with npm..."
npm install || { echo "npm install failed!"; exit 1; }
# If npm is not installed, you may need to install it first (`sudo apt install npm` or `brew install npm` on macOS).

# Step 3: Build the web assets
echo "Building the web project..."
npm run build || { echo "npm build failed!"; exit 1; }

# Step 4: Return to the project root
echo "Returning to the project root..."
cd .. || exit 1

# Step 5: Erase the device memory (optional, but recommended)
echo "Erasing the device memory..."
pio run -t erase || { echo "Memory erase failed!"; exit 1; }
# Ensure PlatformIO is installed before running this script (`pip install platformio`).

# Step 6: Build and upload the SPIFFS filesystem
echo "Building and uploading SPIFFS filesystem..."
pio run -t buildfs -t uploadfs || { echo "SPIFFS upload failed!"; exit 1; }
# If the filesystem upload fails, you may need to check permissions or run `pio run -t menuconfig` to configure flash settings.

# Step 7: Build and upload the firmware
echo "Building and uploading the firmware..."
pio run -t upload || { echo "Firmware build or upload failed!"; exit 1; }
# If the upload fails, ensure your device is properly connected and in flashing mode.

echo "All tasks completed successfully!"

