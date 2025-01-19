#include <Arduino.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <WiFi.h>
#include "logging.h"

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


void setupAP() {
  WiFi.softAP("Yaeger");
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
}

void connectToWifi() {
  WiFi.mode(WIFI_STA);

  WiFi.begin(params.getSSID(), params.getPass());
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
  int wifiCounter = 0;
  while (WiFi.status() != WL_CONNECTED) {
		if (WiFi.status() == WL_CONNECT_FAILED) {
		  log("Connect failed, restoring AP");
			setupAP();
			break;
		}
    wifiCounter++;
    delay(1000);
    log(".");
    if (wifiCounter > 10) {
			setupAP();
      break;
    }
  }
  log("");
  log("Connected to ");
  log(WiFi.SSID().c_str());
  log("IP address: ");
  log(WiFi.localIP().toString().c_str());
}

void setupWifi() {
  // TODO: blink led
  //
	
	params.init();

  const char *hostname = "yaeger.local";
  WiFi.config(INADDR_NONE, INADDR_NONE, INADDR_NONE, INADDR_NONE);
  WiFi.setHostname(hostname);

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
  if (this->ssid == ssid && this->pass == pass) return;

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
