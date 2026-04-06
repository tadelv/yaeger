#include "fan.h"
#include "heater.h"
#include "logging.h"
#include "security.h"
#include "sensors.h"
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>
#include <Preferences.h>
#include <cmath>
#include <cstring>

Preferences preferences;

namespace {
constexpr unsigned long WEB_CLIENT_GRACE_PERIOD_MS = 10000;
constexpr unsigned long MUTATING_CMD_MIN_INTERVAL_MS = 100;
unsigned long lastWebClientDisconnectMs = 0;
unsigned long lastMutatingCommandMs = 0;
bool webClientGraceActive = false;

bool isMutatingCommand(const char *command) {
  if (command == NULL) {
    return false;
  }

  return strncmp(command, "setBurner", 9) == 0 ||
         strncmp(command, "setFan", 6) == 0 ||
         strncmp(command, "setPreferences", 14) == 0;
}

bool enforceMutatingCommandAuth(AsyncWebSocketClient *client,
                                JsonDocument &doc) {
  const char *authToken = doc["authToken"] | "";
  if (!isValidAdminToken(authToken)) {
    client->text("{\"error\":\"unauthorized mutating command\"}");
    return false;
  }

  unsigned long now = millis();
  if (now - lastMutatingCommandMs < MUTATING_CMD_MIN_INTERVAL_MS) {
    client->text("{\"error\":\"rate limit exceeded\"}");
    return false;
  }

  lastMutatingCommandMs = now;
  return true;
}
} // namespace

void onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
               AwsEventType type, void *arg, uint8_t *data, size_t len) {

  switch (type) {
  case WS_EVT_CONNECT:
    logf("[%u] Connected!\n", client->id());
    webClientGraceActive = false;
    lastWebClientDisconnectMs = 0;
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

    for (size_t i = 0; i < info->len; i++) {
      msg += (char)data[i];
    }
#ifdef DEBUG
    logf("msg: %s\n", msg.c_str());
#endif

    JsonDocument doc;

    DeserializationError err = deserializeJson(doc, msg);
    if (err) {
      client->text("{\"error\":\"invalid json\"}");
      return;
    }

    long ln_id = doc["id"].as<long>();
    const char *command = doc["command"].as<const char *>();
    bool hasDirectMutatingFields = !doc["BurnerVal"].isNull() || !doc["FanVal"].isNull();

    if (hasDirectMutatingFields || isMutatingCommand(command)) {
      if (!enforceMutatingCommandAuth(client, doc)) {
        return;
      }
    }

    // Get BurnerVal from Artisan over Websocket
    if (!doc["BurnerVal"].isNull()) {
      long val = doc["BurnerVal"].as<long>();
      logf("BurnerVal: %d\n", val);
      setHeaterPower(val);
    }
    if (!doc["FanVal"].isNull()) {
      long val = doc["FanVal"].as<long>();
      logf("FanVal: %d\n", val);
      setFanSpeed(val);
    }

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
    if (getHeaterPower() > 0 && getFanSpeed() <= 30) {
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

    if (command != NULL &&
        (strncmp(command, "setPreferences", 14) == 0 ||
         strncmp(command, "getPreferences", 14) == 0)) {
      JsonObject root = doc.to<JsonObject>();
      JsonObject dataObj = root["data"].to<JsonObject>();
      root["id"] = ln_id;
      dataObj["type"] = "preferences";
      dataObj["pidKp"] = preferences.getDouble("pidKp", 1.0);
      dataObj["pidKi"] = preferences.getDouble("pidKi", 0.1);
      dataObj["pidKd"] = preferences.getDouble("pidKd", 0.01);
      dataObj["cooldownFanSpeed"] = preferences.getLong("coolFanSpeed", 65);
    }

    if (command != NULL && strncmp(command, "getData", 7) == 0) {
      JsonObject root = doc.to<JsonObject>();
      JsonObject dataObj = root["data"].to<JsonObject>();
      root["id"] = ln_id;
      float etbt[3];
      getETBTReadings(etbt);
      dataObj["type"] = "status";
      dataObj["ET"] = etbt[0];
      dataObj["BT"] = etbt[1];
      dataObj["Amb"] = etbt[2];
      dataObj["BurnerVal"] = getHeaterPower();
      dataObj["FanVal"] = getFanSpeed();
    }

    char buffer[240];
    serializeJson(doc, buffer);
    log(buffer);
    client->text(buffer);
  } break;
  default:
    logf("unhandled message type: %d\n", type);
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

  setHeaterPower(0);
  setFanSpeed(preferences.getLong("coolFanSpeed", 65));
  webClientGraceActive = false;
  log("No websocket clients after grace period, entering cooldown safety mode");
}
