#include "fan.h"
#include "heater.h"
#include "logging.h"
#include "sensors.h"
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>
#include <cmath>
#include <cstring>
#include <Preferences.h>

Preferences preferences;

namespace {
constexpr unsigned long WEB_CLIENT_GRACE_PERIOD_MS = 10000;
unsigned long lastWebClientDisconnectMs = 0;
bool webClientGraceActive = false;
}

void onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
               AwsEventType type, void *arg, uint8_t *data, size_t len) {

  switch (type) {
  case WS_EVT_CONNECT:
    logf("[%u] Connected!\n", client->id());
    webClientGraceActive = false;
    lastWebClientDisconnectMs = 0;
    // client->text("Connected");

    break;
  case WS_EVT_DISCONNECT: {
    logf("[%u] Disconnected!\n", client->id());
    webClientGraceActive = true;
    lastWebClientDisconnectMs = millis();
  } break;
  case WS_EVT_DATA: {

    AwsFrameInfo *info = (AwsFrameInfo *)arg;
#ifdef DEBUG
    logf("ws[%s][%u] %s-message[%llu]: ", server->url(), client->id(),
         (info->opcode == WS_TEXT) ? "text" : "binary", info->len);
    logf("final: %d\n", info->final);
#endif
    String msg = "";
    /*if (info->opcode != WS_TEXT || !info->final) {*/
    /*  break;*/
    /*}*/

    for (size_t i = 0; i < info->len; i++) {
      msg += (char)data[i];
    }
#ifdef DEBUG
    logf("msg: %s\n", msg.c_str());
#endif

    const size_t capacity = JSON_OBJECT_SIZE(3) + 60; // Memory pool
    DynamicJsonDocument doc(capacity);

    // DEBUG WEBSOCKET
    // logf("[%u] get Text: %s\n", num, payload);

    // Extract Values lt. https://arduinojson.org/v6/example/http-client/
    // Artisan Anleitung: https://artisan-scope.org/devices/websockets/

    deserializeJson(doc, msg);

    long ln_id = doc["id"].as<long>();
    // Get BurnerVal from Artisan over Websocket
    if (!doc["BurnerVal"].isNull()) {
      long val = doc["BurnerVal"].as<long>();
      logf("BurnerVal: %d\n", val);
      // DimmerVal = doc["BurnerVal"].as<long>();
      setHeaterPower(val);
    }
    if (!doc["FanVal"].isNull()) {
      long val = doc["FanVal"].as<long>();
      logf("FanVal: %d\n", val);
      setFanSpeed(val);
    }

    // Send Values to Artisan over Websocket
    const char *command = doc["command"].as<const char *>();
    if (command != NULL && strncmp(command, "setBurner", 9) == 0) {
      long val = doc["value"].as<long>();
      logf("BurnerVal: %d\n", val);
      setHeaterPower(val);
    }
    if (command != NULL && strncmp(command, "setFan", 6) == 0) {
      long val = doc["value"].as<long>();
      logf("FanVal: %d\n", val);
      setFanSpeed(val);
    }

    // Safeguard to prevent heater fuse blowout
    if (getHeaterPower() > 0  && getFanSpeed() <= 30) {
       setFanSpeed(30);
    }

    if (command != NULL && strncmp(command, "setPreferences", 14) == 0) {
      if (!doc["pidKp"].isNull()) {
        double pidKp = doc["pidKp"].as<double>();
        preferences.putDouble("pidKp", pidKp);
      }
      if (!doc["pidKi"].isNull()) {
        double pidKi = doc["pidKi"].as<double>();
        preferences.putDouble("pidKi", pidKi);
      }
      if (!doc["pidKd"].isNull()) {
        double pidKd = doc["pidKd"].as<double>();
        preferences.putDouble("pidKd", pidKd);
      }
      if (!doc["cooldownFanSpeed"].isNull()) {
        long cooldownFanSpeed = doc["cooldownFanSpeed"].as<long>();
        logf("cooldownFanSpeed: %d\n", cooldownFanSpeed);
        preferences.putLong("coolFanSpeed", cooldownFanSpeed);
      }
    }

    if (command != NULL && (strncmp(command, "setPreferences", 14) == 0 || strncmp(command, "getPreferences", 14) == 0)) {
      JsonObject root = doc.to<JsonObject>();
      JsonObject data = root.createNestedObject("data");
      root["id"] = ln_id;
      data["type"] = "preferences";
      data["pidKp"] = preferences.getDouble("pidKp", 1.0);
      data["pidKi"] = preferences.getDouble("pidKi", 0.1);
      data["pidKd"] = preferences.getDouble("pidKd", 0.01);
      data["cooldownFanSpeed"] = preferences.getLong("coolFanSpeed", 65);
    }

    if (command != NULL && strncmp(command, "getData", 7) == 0) {
      JsonObject root = doc.to<JsonObject>();
      JsonObject data = root.createNestedObject("data");
      root["id"] = ln_id;
      float etbt[3];
      getETBTReadings(etbt);
      data["type"] = "status";
      data["ET"] = etbt[0]; // Med_ExhaustTemp.getMedian()
      data["BT"] = etbt[1]; // Med_BeanTemp.getMedian();
      data["Amb"] = etbt[2];
      data["BurnerVal"] = getHeaterPower(); // float(DimmerVal);
      data["FanVal"] = getFanSpeed();
    }

    char buffer[200];                        // create temp buffer
    size_t len = serializeJson(doc, buffer); // serialize to buffer
    // DEBUG WEBSOCKET
    log(buffer);

    client->text(buffer);
    // send message to client
    // webSocket.sendTXT(num, "message here");

    // send data to all connected clients
    // webSocket.broadcastTXT("message here");
  } break;
  default: // send message to client
    logf("unhandled message type: %d\n", type);
    // webSocket.sendBIN(num, payload, length);
    break;
  }
}

void setupMainLoop(AsyncWebSocket *ws) {
  preferences.begin("preferences");
  ws->onEvent(onWsEvent);
}

void updateConnectionSafety(AsyncWebSocket *ws) {
  if (ws->count() > 0) {
    webClientGraceActive = false;
    return;
  }

  if (!webClientGraceActive) {
    return;
  }

  if (millis() - lastWebClientDisconnectMs < WEB_CLIENT_GRACE_PERIOD_MS) {
    return;
  }

  // turn off heater and set fan to configured cooldown only after grace period
  setHeaterPower(0);
  setFanSpeed(preferences.getLong("coolFanSpeed", 65));
  webClientGraceActive = false;
  log("No websocket clients after grace period, entering cooldown safety mode");
}
