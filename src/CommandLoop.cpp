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
constexpr long ACTUATOR_MIN_VALUE = 0;
constexpr long ACTUATOR_MAX_VALUE = 100;
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

long clampActuatorValue(long value) {
  if (value < ACTUATOR_MIN_VALUE) {
    return ACTUATOR_MIN_VALUE;
  }
  if (value > ACTUATOR_MAX_VALUE) {
    return ACTUATOR_MAX_VALUE;
  }
  return value;
}

bool isActuatorValueInRange(long value) {
  return value >= ACTUATOR_MIN_VALUE && value <= ACTUATOR_MAX_VALUE;
}

bool parseActuatorValue(JsonDocument &doc, const char *fieldName, long &valueOut) {
  JsonVariant field = doc[fieldName];
  if (field.isNull()) {
    return false;
  }
  if (!field.is<long>()) {
    return false;
  }
  valueOut = field.as<long>();
  return true;
}

bool validateCommandSchema(AsyncWebSocketClient *client, JsonDocument &doc,
                           const char *command) {
  if (command == NULL) {
    return true;
  }

  if (strncmp(command, "setBurner", 9) == 0 || strncmp(command, "setFan", 6) == 0) {
    JsonVariant valueField = doc["value"];
    if (valueField.isNull() || !valueField.is<long>()) {
      client->text("{\"error\":\"invalid schema: numeric value required\"}");
      return false;
    }
  }

  if (strncmp(command, "setPreferences", 14) == 0) {
    if (!doc["pidKp"].isNull() && !doc["pidKp"].is<double>()) {
      client->text("{\"error\":\"invalid schema: pidKp must be numeric\"}");
      return false;
    }
    if (!doc["pidKi"].isNull() && !doc["pidKi"].is<double>()) {
      client->text("{\"error\":\"invalid schema: pidKi must be numeric\"}");
      return false;
    }
    if (!doc["pidKd"].isNull() && !doc["pidKd"].is<double>()) {
      client->text("{\"error\":\"invalid schema: pidKd must be numeric\"}");
      return false;
    }
    if (!doc["cooldownFanSpeed"].isNull() && !doc["cooldownFanSpeed"].is<long>()) {
      client->text("{\"error\":\"invalid schema: cooldownFanSpeed must be numeric\"}");
      return false;
    }
  }

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
    if (info->opcode != WS_TEXT || !info->final || info->index != 0 || info->len != len) {
      client->text("{\"error\":\"unsupported websocket frame\"}");
      return;
    }
#ifdef DEBUG
    logf("msg bytes: %d\n", len);
#endif

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, data, len);
    if (err) {
      client->text("{\"error\":\"invalid json\"}");
      return;
    }

    long ln_id = doc["id"].as<long>();
    const char *command = doc["command"].as<const char *>();
    bool hasDirectMutatingFields = !doc["BurnerVal"].isNull() || !doc["FanVal"].isNull();

    if (!validateCommandSchema(client, doc, command)) {
      return;
    }

    if (hasDirectMutatingFields || isMutatingCommand(command)) {
      if (!enforceMutatingCommandAuth(client, doc)) {
        return;
      }
    }

    // Get BurnerVal from Artisan over Websocket
    long burnerVal = 0;
    if (parseActuatorValue(doc, "BurnerVal", burnerVal)) {
      if (!isActuatorValueInRange(burnerVal)) {
        logf("BurnerVal out of range, clamped from %d\n", burnerVal);
      }
      long clampedBurnerVal = clampActuatorValue(burnerVal);
      logf("BurnerVal: %d\n", clampedBurnerVal);
      setHeaterPower(clampedBurnerVal);
    } else if (!doc["BurnerVal"].isNull()) {
      client->text("{\"error\":\"invalid BurnerVal\"}");
      return;
    }

    long fanVal = 0;
    if (parseActuatorValue(doc, "FanVal", fanVal)) {
      if (!isActuatorValueInRange(fanVal)) {
        logf("FanVal out of range, clamped from %d\n", fanVal);
      }
      long clampedFanVal = clampActuatorValue(fanVal);
      logf("FanVal: %d\n", clampedFanVal);
      setFanSpeed(clampedFanVal);
    } else if (!doc["FanVal"].isNull()) {
      client->text("{\"error\":\"invalid FanVal\"}");
      return;
    }

    if (command != NULL && strncmp(command, "setBurner", 9) == 0) {
      long val = doc["value"].as<long>();
      if (!isActuatorValueInRange(val)) {
        logf("setBurner value out of range, clamped from %d\n", val);
      }
      long clampedVal = clampActuatorValue(val);
      logf("BurnerVal: %d\n", clampedVal);
      setHeaterPower(clampedVal);
    }
    if (command != NULL && strncmp(command, "setFan", 6) == 0) {
      long val = doc["value"].as<long>();
      if (!isActuatorValueInRange(val)) {
        logf("setFan value out of range, clamped from %d\n", val);
      }
      long clampedVal = clampActuatorValue(val);
      logf("FanVal: %d\n", clampedVal);
      setFanSpeed(clampedVal);
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
        if (!isActuatorValueInRange(cooldownFanSpeed)) {
          logf("cooldownFanSpeed out of range, clamped from %d\n", cooldownFanSpeed);
        }
        long clampedCooldownFanSpeed = clampActuatorValue(cooldownFanSpeed);
        logf("cooldownFanSpeed: %d\n", clampedCooldownFanSpeed);
        preferences.putLong("coolFanSpeed", clampedCooldownFanSpeed);
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
      bool gotReading = getETBTReadings(etbt);
      dataObj["type"] = "status";
      dataObj["ET"] = gotReading ? etbt[0] : NAN;
      dataObj["BT"] = gotReading ? etbt[1] : NAN;
      dataObj["Amb"] = gotReading ? etbt[2] : NAN;
      dataObj["sampleAgeMs"] = millis() - getLastSensorUpdateMs();
      dataObj["sensorOk"] = gotReading;
      dataObj["BurnerVal"] = getHeaterPower();
      dataObj["FanVal"] = getFanSpeed();
    }

    String response;
    response.reserve(measureJson(doc) + 1);
    serializeJson(doc, response);
#ifdef DEBUG
    log(response.c_str());
#endif
    client->text(response);
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
