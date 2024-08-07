#include "Credentials.h"
#include <Arduino.h>
// lib for wifi
#include <WiFi.h>

// lib for Over the Air (ota) programming
#include <ESPAsyncWebServer.h>
#include <ElegantOTA.h> //https://github.com/ayushsharma82/AsyncElegantOTA

#include <ArduinoJson.h>
// for ota
const char *host = "esp32 Roaster";
// Create AsyncWebServer object on port 80
/*WebServer server(80);*/
// Create a WebSocket object
AsyncWebSocket ws("/ws");
AsyncWebServer server(80);

void onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
               AwsEventType type, void *arg, uint8_t *data, size_t len) {

  switch (type) {
  case WS_EVT_CONNECT:
    Serial.printf("[%u] Connected!\n", client->id());
    // client->text("Connected");
    
			break;
  case WS_EVT_DISCONNECT: {
    Serial.printf("[%u] Disconnected!\n", client->id());
  } break;
  case WS_EVT_DATA: {

    AwsFrameInfo *info = (AwsFrameInfo *)arg;
    Serial.printf("ws[%s][%u] %s-message[%llu]: ", server->url(), client->id(),
                  (info->opcode == WS_TEXT) ? "text" : "binary", info->len);
    Serial.printf("final: %d\n", info->final);
    String msg = "";
    /*if (info->opcode != WS_TEXT || !info->final) {*/
    /*  break;*/
    /*}*/

    for (size_t i = 0; i < info->len; i++) {
      msg += (char)data[i];
    }
    Serial.printf("msg: %s\n", msg.c_str());
    const size_t capacity = JSON_OBJECT_SIZE(3) + 60; // Memory pool
    DynamicJsonDocument doc(capacity);

    // DEBUG WEBSOCKET
    // Serial.printf("[%u] get Text: %s\n", num, payload);

    // Extract Values lt. https://arduinojson.org/v6/example/http-client/
    // Artisan Anleitung: https://artisan-scope.org/devices/websockets/

    deserializeJson(
        doc,
        msg); // 2 Nodes einzeln (Feld: "command"): "getBT" und "getDimmerVal"
    // oder
    //  alle Nodes auf einmal (Feld: "command"): "getData"
    // char* entspricht String
    String command = doc["command"].as<const char *>();
    long ln_id = doc["id"].as<long>();
    // Get BurnerVal from Artisan over Websocket
    if (!doc["BurnerVal"].isNull()) {
      Serial.print("BurnerVal: ");
      Serial.println(doc["BurnerVal"].as<long>());
      // DimmerVal = doc["BurnerVal"].as<long>();
    }

    // Send Values to Artisan over Websocket
    JsonObject root = doc.to<JsonObject>();
    JsonObject data = root.createNestedObject("data");
    if (command == "getBT") {
      root["id"] = ln_id;
      data["BT"] = 22.2f; // Med_BeanTemp.getMedian();
    } else if (command == "getDimmerVal") {
      root["id"] = ln_id;
      data["DimmerVal"] = 0.2f; // float(DimmerVal);
    } else if (command == "getData") {
      root["id"] = ln_id;
      data["BT"] = 22.2; // Med_BeanTemp.getMedian();
      data["ET"] = 22.2;
      data["DimmerVal"] = 0.2; // float(DimmerVal);
    }

    //====================================
    // DEBUG
    /*
    if(!doc["command"].isNull())
    {
      Serial.print("Command: ");
      Serial.println(doc["command"].as<char*>());
    }
    if(!doc["BurnerVal"].isNull())
    {
      Serial.print("BurnerVal: ");
      Serial.println(doc["BurnerVal"].as<long>());
      DimmerVal = doc["BurnerVal"].as<long>();
    }

    Serial.print("ID: ");
    Serial.println(doc["id"].as<long>());
    Serial.print("RoasterID: ");
    Serial.println(doc["roasterID"].as<long>());

    //==========================
    //JETZT JSON-Payload generieren und senden!!!
    //==========================

    ln_id = doc["id"].as<long>();
    JsonObject root = doc.to<JsonObject>();
    JsonObject data = root.createNestedObject("data");
    root["id"] = ln_id;
    data["BT"] = BeanTemp;
    data["Dimmer"] = float(DimmerVal);

    */
    // DEBUG
    //====================================

    char buffer[200];                        // create temp buffer
    size_t len = serializeJson(doc, buffer); // serialize to buffer

    // DEBUG WEBSOCKET
    Serial.println(buffer);

    client->text(buffer);
    // send message to client
    // webSocket.sendTXT(num, "message here");

    // send data to all connected clients
    // webSocket.broadcastTXT("message here");
  } break;
  default: // send message to client
    Serial.printf("msg: tp: %d, data: %s\n", type, data);
    // webSocket.sendBIN(num, payload, length);
    break;
  }
}

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
  ws.onEvent(onWsEvent);
  server.addHandler(&ws);

  server.begin();
  Serial.println("HTTP server started");
}

void loop(void) {
  ElegantOTA.loop();
  ws.cleanupClients();
}
