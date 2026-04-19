#include "WiFiType.h"
#include "esp32-hal.h"
#include "logging.h"
#include "security.h"
#include <Arduino.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <WiFi.h>

const char *wifiPrefsKey = "wifi";
const char *wifiSSIDKey = "ssid";
const char *wifiPassKey = "pass";

class WiFiParams {
private:
  String ssid = "";
  String pass = "";
  Preferences preferences;

public:
  String getSSID() { return ssid; }
  String getPass() { return pass; }
  bool hasCredentials() { return ssid != ""; };
  void saveCredentials(String ssid, String pass);
  void init();
  void reset();
};

WiFiParams params;
const char *yaegerHostname = "yaeger.local";
unsigned long lastReconnectAttemptMs = 0;
constexpr unsigned long WIFI_RECONNECT_INTERVAL_MS = 5000;
constexpr unsigned long WIFI_CONNECT_TIMEOUT_MS = 10000;
constexpr unsigned long WIFI_CONNECT_STATUS_LOG_INTERVAL_MS = 1000;
constexpr unsigned long AP_SETUP_TIMEOUT_MS = 15UL * 60UL * 1000UL;
unsigned long apModeStartMs = 0;
unsigned long wifiConnectAttemptStartMs = 0;
unsigned long lastWifiConnectLogMs = 0;
bool wifiConnectInProgress = false;
bool wifiConnectionAnnounced = false;

void setupAP() {
  WiFi.mode(WIFI_AP);
  delay(100);
  String apPassphrase = getApPassphrase();
  WiFi.softAP("Yaeger", apPassphrase.c_str());
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
  apModeStartMs = millis();
  log("AP setup mode enabled with WPA2 passphrase");
}

void connectToWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(params.getSSID(), params.getPass());
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
  wifiConnectAttemptStartMs = millis();
  lastWifiConnectLogMs = 0;
  wifiConnectInProgress = true;
  wifiConnectionAnnounced = false;
  log("Starting non-blocking WiFi connect attempt");
}

void setupWifi() {
  // TODO: blink led
  //

  params.init();

  WiFi.config(INADDR_NONE, INADDR_NONE, INADDR_NONE, INADDR_NONE);
  WiFi.setHostname(yaegerHostname);

  if (params.hasCredentials()) {
    log("trying to connect to wifi");
    connectToWifi();
  } else {
    log("no wifi data found, setting up AP");
    setupAP();
  }

  if (!MDNS.begin("yaeger")) {
    log("could not set up MDNS responder");
  }
}

// ----------------------------------------------------
// ------------------ WiFiParams ----------------------
// ----------------------------------------------------

// TODO: use this
void WiFiParams::saveCredentials(String ssid, String pass) {
  if (this->ssid == ssid && this->pass == pass)
    return;

  this->ssid = ssid;
  this->pass = pass;
  preferences.putString("ssid", ssid.c_str());
  preferences.putString("pass", pass.c_str());
  /*LOG_INFO("Saved wifi credentials [%s, %s]", ssid.c_str(), "*****");*/
}

void WiFiParams::init() {
  preferences.begin(wifiPrefsKey);
  if (!hasCredentials()) {
    this->ssid = preferences.getString(wifiSSIDKey, "");
    this->pass = preferences.getString(wifiPassKey, "");
  }
}

void WiFiParams::reset() {
  ssid = "";
  pass = "";
  preferences.clear();
}


const char *getWifiModeString() {
  wifi_mode_t mode = WiFi.getMode();
  if (mode == WIFI_MODE_AP)
    return "AP";
  if (mode == WIFI_MODE_STA)
    return "STA";
  if (mode == WIFI_MODE_APSTA)
    return "AP+STA";

  return "UNKNOWN";
}

String getActiveSSID() {
  if (WiFi.getMode() == WIFI_MODE_AP)
    return WiFi.softAPSSID();

  return WiFi.SSID();
}

String getActiveIP() {
  if (WiFi.getMode() == WIFI_MODE_AP)
    return WiFi.softAPIP().toString();

  return WiFi.localIP().toString();
}

String getConfiguredHostname() { return String(yaegerHostname); }

void maintainWifiConnection() {
  wifi_mode_t mode = WiFi.getMode();
  if (mode == WIFI_MODE_AP && apModeStartMs > 0 && millis() - apModeStartMs > AP_SETUP_TIMEOUT_MS) {
    log("AP setup window expired, restarting device");
    ESP.restart();
    return;
  }

  if (mode != WIFI_MODE_STA && mode != WIFI_MODE_APSTA) {
    return;
  }

  wl_status_t status = WiFi.status();
  unsigned long now = millis();

  if (status == WL_CONNECTED) {
    if (!wifiConnectionAnnounced) {
      log("");
      log("Connected to ");
      log(WiFi.SSID().c_str());
      log("IP address: ");
      log(WiFi.localIP().toString().c_str());
      wifiConnectionAnnounced = true;
    }
    wifiConnectInProgress = false;
    return;
  }

  if (wifiConnectInProgress) {
    if (status == WL_CONNECT_FAILED) {
      log("Connect failed, restoring AP");
      WiFi.disconnect(true);
      setupAP();
      wifiConnectInProgress = false;
      wifiConnectionAnnounced = false;
      return;
    }

    if (now - wifiConnectAttemptStartMs >= WIFI_CONNECT_TIMEOUT_MS) {
      log("WiFi connect timed out, restoring AP");
      WiFi.disconnect(true);
      setupAP();
      wifiConnectInProgress = false;
      wifiConnectionAnnounced = false;
      return;
    }

    if (lastWifiConnectLogMs == 0 ||
        now - lastWifiConnectLogMs >= WIFI_CONNECT_STATUS_LOG_INTERVAL_MS) {
      log(".");
      lastWifiConnectLogMs = now;
    }
    return;
  }

  if (status == WL_IDLE_STATUS) {
    return;
  }

  if (now - lastReconnectAttemptMs < WIFI_RECONNECT_INTERVAL_MS) {
    return;
  }

  lastReconnectAttemptMs = now;
  logf("WiFi not connected (status=%d), starting reconnect", status);
  connectToWifi();
}
