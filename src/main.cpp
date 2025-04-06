
#include <Adafruit_NeoPixel.h>
#include <ESPAsyncWebServer.h>
#include <ElegantOTA.h> //https://github.com/ayushsharma82/AsyncElegantOTA
#include <SPIFFS.h>

#include "CommandLoop.h"
#include "HardwareSerial.h"
#include "IPAddress.h"
#include "WiFiType.h"
#include "config.h"
#include "display.h"
#include "fan.h"
#include "heater.h"
#include "logging.h"
#include "sensors.h"
#include "api.h"
#include "wifi_setup.h"

#define PIN 48
Adafruit_NeoPixel pixels(1, PIN);
// for ota
const char *host = "esp32 Roaster";
// Create AsyncWebServer object on port 80
/*WebServer server(80);*/
// Create a WebSocket object
AsyncWebSocket ws("/ws");
AsyncWebServer server(80);

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

void setup(void) {
  Serial.begin(115200);
  delay(1000); // Take some time to open up the Serial Monitor
  startSensors();
  pixels.begin();
  pixels.clear();
  pixels.setPixelColor(0, pixels.Color(5, 0, 0));
  pixels.show();

  // Wait for connection
  setupWifi();
  initDisplay();
  setWifiIP();

  if (!SPIFFS.begin()) {
    Serial.println("SPIFFS failed");
  }
  server.serveStatic("/", SPIFFS, "/").setDefaultFile("index.html");

  ElegantOTA.begin(&server); // Start ElegantOTA
  // ElegantOTA callbacks
  ElegantOTA.onStart(onOTAStart);
  ElegantOTA.onProgress(onOTAProgress);
  ElegantOTA.onEnd(onOTAEnd);

  setupLogging(&server);

  // WebSocket handler
  setupMainLoop(&ws);
  server.addHandler(&ws);


	// API
	setupApi(&server);

  server.begin();
  log("HTTP server started");
  pixels.clear();
  pixels.setPixelColor(0, pixels.Color(0, 5, 0));
  pixels.show();

  initFan();
  initHeater();
}

void loop(void) {
  ElegantOTA.loop();
  ws.cleanupClients();
  delay(10);
  takeReadings();
  updateHeater();
}
