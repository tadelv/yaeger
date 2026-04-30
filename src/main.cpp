
#include <Adafruit_NeoPixel.h>
#include <ESPAsyncWebServer.h>
#include <ElegantOTA.h> //https://github.com/ayushsharma82/AsyncElegantOTA
#include <LittleFS.h>
#include <Preferences.h>

#include "AsyncWebSocket.h"
#include "CommandLoop.h"
#include "HardwareSerial.h"
#include "WiFiType.h"
#include "api.h"
#include "display.h"
#include "logging.h"
#include "wifi_setup.h"
#include "Control.h"
#include "preferenceKeys.h"

#define PIN 48
Adafruit_NeoPixel pixels(1, PIN);
Control *control;
Preferences preferences;
WSRequestHandler *wsHandler;
// for ota
const char *host = "esp32 Roaster";
// Create AsyncWebServer object on port 80
/*WebServer server(80);*/
// Create a WebSocket object
AsyncWebSocket ws("/ws");
AsyncWebServer server(80);

void setupSimulation(AsyncWebSocket *ws);
void updateSimulation();

unsigned long ota_progress_millis = 0;
void onOTAStart() {
  // Log when OTA has started
  log("OTA update started!");
  // <Add your own code here>
  /*pixels.setPixelColor(0, pixels.Color(5,5,0));*/
  /*pixels.show();*/
}

void onOTAProgress(size_t current, size_t final) {
  // Log every 1 second
  if (millis() - ota_progress_millis > 1000) {
    ota_progress_millis = millis();
    logf("OTA Progress Current: %u bytes, Final: %u bytes\n", current, final);
  }
}

void onOTAEnd(bool success) {
  // Log when OTA has finished
  if (success) {
    log("OTA update finished successfully!");
  } else {
    log("There was an error during OTA update!");
  }
  // <Add your own code here>
  /*pixels.setPixelColor(0, pixels.Color(0,0,0));*/
  /*pixels.show();*/
}

void setup() {
  setupLogging(&server);
  log("Starting Setup");
  pixels.begin();
  pixels.clear();
  pixels.setPixelColor(0, Adafruit_NeoPixel::Color(5, 0, 0));
  pixels.show();

  log("Setting up Wifi");
  preferences.begin("preferences-v1");
  setupWifi(&preferences);
  initDisplay();
  setWifiIP();

  log("Init LittleFS");
  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS failed");
  }
  server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");
  server.serveStatic("/settings", LittleFS, "/").setDefaultFile("index.html");
  server.serveStatic("/editor", LittleFS, "/").setDefaultFile("index.html");

  log("Init OTA");
  ElegantOTA.begin(&server); // Start ElegantOTA
  // ElegantOTA callbacks
  ElegantOTA.onStart(onOTAStart);
  ElegantOTA.onProgress(onOTAProgress);
  ElegantOTA.onEnd(onOTAEnd);



  control = new Control(
    preferences.getFloat(pidPKey,1),
    preferences.getFloat(pidIKey,0.1),
    preferences.getFloat(pidDKey,0.01),
    StringToTarget(preferences.getString(temperatureTargetKey,"ET"))
  );

  // WebSocket handler
  wsHandler = new WSRequestHandler(&ws, control, &preferences);

  server.addHandler(&ws);

  // API
  setupApi(&server, &preferences);

  server.begin();
  log("HTTP server started");
  pixels.clear();
  pixels.setPixelColor(0, Adafruit_NeoPixel::Color(0, 5, 0));
  pixels.show();
}

void loop() {
  ElegantOTA.loop();
  ws.cleanupClients();
  delay(10);
  control->loop();
  wsHandler->loop();
  if (control->hasAutotuneResults()) {
    preferences.putFloat(pidPKey, control->getKp());
    preferences.putFloat(pidIKey, control->getKi());
    preferences.putFloat(pidDKey, control->getKd());
    control->resetAutotune();
  }
}
