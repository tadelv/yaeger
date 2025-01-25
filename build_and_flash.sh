#!/bin/bash

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
cd .. || exit

# Step 5: Erase the device memory (optional, but recommended)
echo "Erasing the device memory..."
pio run -t erase || { echo "Memory erase failed!"; exit 1; }

# Step 6: Build and upload the SPIFFS filesystem
echo "Building and uploading SPIFFS filesystem..."
pio run -t buildfs -t uploadfs || { echo "SPIFFS upload failed!"; exit 1; }

# Step 7: Build and upload the firmware
echo "Building and uploading the firmware..."
pio run -t upload || { echo "Firmware build or upload failed!"; exit 1; }

echo "All tasks completed successfully!"
