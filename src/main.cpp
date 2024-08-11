#include "Credentials.h"
#include <Arduino.h>
// lib for wifi
#include <WiFi.h>

// lib for Over the Air (ota) programming
#include <Adafruit_NeoPixel.h>
#include <ESPAsyncWebServer.h>
#include <ElegantOTA.h> //https://github.com/ayushsharma82/AsyncElegantOTA

#include "CommandLoop.h"
#include "sensors.h"
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
  Serial.println("OTA update started!");
  // <Add your own code here>
}

void onOTAProgress(size_t current, size_t final) {
  // Log every 1 second
  if (millis() - ota_progress_millis > 1000) {
    ota_progress_millis = millis();
    Serial.printf("OTA Progress Current: %u bytes, Final: %u bytes\n", current,
                  final);
  }
}

void onOTAEnd(bool success) {
  // Log when OTA has finished
  if (success) {
    Serial.println("OTA update finished successfully!");
  } else {
    Serial.println("There was an error during OTA update!");
  }
  // <Add your own code here>
}

void setup(void) {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
  Serial.println("");
	startSensors();
  pixels.begin();
  pixels.clear();
  pixels.setPixelColor(0, pixels.Color(5, 0, 0));
  pixels.show();

  // Wait for connection
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("");
  Serial.print("Connected to ");
  Serial.println(ssid);
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());

  server.on("/", HTTP_GET, [](AsyncWebServerRequest *request) {
    request->send(200, "text/plain", "Hi! This is ElegantOTA AsyncDemo.");
  });

  ElegantOTA.begin(&server); // Start ElegantOTA
  // ElegantOTA callbacks
  ElegantOTA.onStart(onOTAStart);
  ElegantOTA.onProgress(onOTAProgress);
  ElegantOTA.onEnd(onOTAEnd);

  // WebSocket handler
  setupMainLoop(&ws);
  server.addHandler(&ws);

  server.begin();
  Serial.println("HTTP server started");
  pixels.clear();
  pixels.setPixelColor(0, pixels.Color(0, 5, 0));
  pixels.show();
}

void loop(void) {
  ElegantOTA.loop();
  ws.cleanupClients();
	delay(1000);
	takeReadings();
}
