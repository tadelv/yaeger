
#include "logging.h"
#include "sensors.h"
#include <Preferences.h>
#include <ESPAsyncWebServer.h>

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
		prefs.begin("wifi", false);
		prefs.putString("ssid", ssid);
		prefs.putString("pass", pass);
		log("saving to prefs");
		logf("ss %s, p: %s", ssid, pass);

		prefs.end();
		request->send(200);
  });
}
