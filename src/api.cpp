#include "logging.h"
#include "sensors.h"
#include "wifi_setup.h"
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
    log("saving to prefs");
    logf("ss %s, p: %s", ssid, pass);

    prefs.end();
    request->send(200);
  });
}
