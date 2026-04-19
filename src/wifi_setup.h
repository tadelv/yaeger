#ifndef WIFI_SETUP
#define WIFI_SETUP

#include <Arduino.h>

// can take a while - check nvs for stored ssid and pass
// check if can connect
// if not, start AP mode
void setupWifi();
void maintainWifiConnection();

extern const char *wifiPrefsKey;
extern const char *wifiSSIDKey;
extern const char *wifiPassKey;

const char *getWifiModeString();
String getActiveSSID();
String getActiveIP();
String getConfiguredHostname();

#endif
