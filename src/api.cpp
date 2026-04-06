#include "api.h"

#include "logging.h"
#include "security.h"
#include "version.h"
#include "wifi_setup.h"
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>
#include <Preferences.h>

void setupApi(AsyncWebServer *server) {
  log("setting up api");

  server->on(
      "/api/wifi", HTTP_POST,
      [](AsyncWebServerRequest *request) {
        // handled in body parser
      },
      NULL,
      [](AsyncWebServerRequest *request, uint8_t *data, size_t len,
         size_t index, size_t total) {
        if (index != 0 || len != total) {
          request->send(400, "application/json",
                        "{\"error\":\"chunked body not supported\"}");
          return;
        }

        if (!isAuthorizedRequest(request)) {
          return;
        }

        DynamicJsonDocument doc(256);
        DeserializationError err = deserializeJson(doc, data, len);
        if (err) {
          request->send(400, "application/json",
                        "{\"error\":\"invalid json\"}");
          return;
        }

        const char *ssid = doc["ssid"] | "";
        const char *pass = doc["pass"] | "";

        if (strlen(ssid) == 0 || strlen(pass) < 8) {
          request->send(
              400, "application/json",
              "{\"error\":\"ssid required and pass must be >=8 chars\"}");
          return;
        }

        Preferences prefs;
        prefs.begin(wifiPrefsKey, false);
        prefs.putString(wifiSSIDKey, ssid);
        prefs.putString(wifiPassKey, pass);
        prefs.end();

        logf("saved wifi ssid to prefs: %s", ssid);
        request->send(200, "application/json", "{\"ok\":true}");
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
