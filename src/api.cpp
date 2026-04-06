#include "api.h"

#include "logging.h"
#include "version.h"
#include "wifi_setup.h"
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>
#include <Preferences.h>

void setupApi(AsyncWebServer *server) {
  log("setting up api");
  server->on("/api/wifi", HTTP_GET, [](AsyncWebServerRequest *request) {
    if (!request->hasParam("ssid") || !request->hasParam("pass")) {
      AsyncWebServerResponse *response = request->beginResponse(400);
      request->send(response);
      return;
    }

    const char *ssid = request->getParam("ssid")->value().c_str();
    const char *pass = request->getParam("pass")->value().c_str();

    Preferences prefs;
    prefs.begin(wifiPrefsKey, false);
    prefs.putString(wifiSSIDKey, ssid);
    prefs.putString(wifiPassKey, pass);
    logf("saving to prefs, ssid: %s", ssid);

    prefs.end();
    request->send(200);
  });

  server->on("/api/info", HTTP_GET, [](AsyncWebServerRequest *request) {
    StaticJsonDocument<256> doc;
    doc["firmwareVersion"] = YAEGER_FW_VERSION;
    doc["networkMode"] = getWifiModeString();
    doc["ssid"] = getActiveSSID();
    doc["ip"] = getActiveIP();
    doc["hostname"] = getConfiguredHostname();

    String body;
    serializeJson(doc, body);
    request->send(200, "application/json", body);
  });
}
