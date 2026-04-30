#include "CommandLoop.h"
#include "logging.h"
#include "Control.h"
#include <ArduinoJson.h>
#include <cmath>
#include <cstring>
#include <Preferences.h>

#include "config.h"
#include "preferenceKeys.h"

WSRequestHandler::WSRequestHandler(AsyncWebSocket *ws, Control *control, Preferences *preferences) {
  using namespace std::placeholders;
  this->control = control;
  this->preferences = preferences;
  this->_lastUpdate = 0;
  this->ws = ws;
  this->ws->onEvent(std::bind(&WSRequestHandler::onWsEvent, this, _1, _2, _3, _4, _5, _6));
}

void WSRequestHandler::onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
                                 AwsEventType type, void *arg, uint8_t *data, size_t len) {
  switch (type) {
    case WS_EVT_CONNECT:
      logf("[%u] Connected!\n", client->id());
      // client->text("Connected");

      break;
    case WS_EVT_DISCONNECT: {
      logf("[%u] Disconnected!\n", client->id());
      // turn off heater and set fan to 100% when not under PID control
      if (this->control->getMode() == OperationalMode::Manual) {
        control->setHeater(0.f);
        control->setFan(100.f);
      }
    }
    break;
    case WS_EVT_DATA: {
      auto *info = (AwsFrameInfo *) arg;

      String msg = "";
      /*if (info->opcode != WS_TEXT || !info->final) {*/
      /*  break;*/
      /*}*/

      for (size_t i = 0; i < info->len; i++) {
        msg += (char) data[i];
      }


      JsonDocument doc;

      // DEBUG WEBSOCKET
      // logf("[%u] get Text: %s\n", num, payload);

      // Extract Values lt. https://arduinojson.org/v6/example/http-client/
      // Artisan Anleitung: https://artisan-scope.org/devices/websockets/

      deserializeJson(doc, msg);

      long ln_id = doc["id"].as<long>();


      if (!doc["Mode"].isNull() && strncmp(doc["Mode"].as<const char *>(), "Manual", 6) == 0) {
        control->setMode(OperationalMode::Manual);
      }

      if (!doc["Mode"].isNull() && strncmp(doc["Mode"].as<const char *>(), "PID", 3) == 0) {
        control->setMode(OperationalMode::Auto);
      }

      if (!doc["BurnerVal"].isNull()) {
        auto val = doc["BurnerVal"].as<float>();
        if (DEBUG) logf("BurnerVal: %6.1lf\n", val);
        // DimmerVal = doc["BurnerVal"].as<long>();
        control->setHeater(val);
      }

      if (!doc["Setpoint"].isNull()) {
        auto setpoint = doc["Setpoint"].as<float>();
        if (DEBUG) logf("Setpoint: %6.1lf\n", setpoint);
        control->setSetpoint(setpoint);
      }

      if (!doc["FanVal"].isNull()) {
        auto fanVal = doc["FanVal"].as<float>();
        if (DEBUG) logf("FanVal: %6.1lf\n", fanVal);
        control->setFan(fanVal);
      }

      if (!doc["Target"].isNull()) {
        String targetInput = doc["Target"];
        auto target = StringToTarget(targetInput);
        control->setTemperatureTarget(target);
        preferences->putString(temperatureTargetKey, targetInput);
      }

      // Send Values to Artisan over Websocket
      const char *command = doc["command"].as<const char *>();
      if (command != nullptr && strncmp(command, "setBurner", 9) == 0) {
        auto val = doc["value"].as<float>();
        if (DEBUG) logf("BurnerVal: %d\n", val);
        control->setHeater(val);
      }
      if (command != nullptr && strncmp(command, "setFan", 6) == 0) {
        auto val = doc["value"].as<float>();
        if (DEBUG) logf("FanVal: %d\n", val);
        control->setFan(val);
      }

      if (command != nullptr && strncmp(command, "autotune", 8) == 0) {
        if (control->getFan() < 30) control->setFan(60);
        control->startAutotune();
      }

      if (command != nullptr && strncmp(command, "setPreferences", 14) == 0) {
        if (!doc["pidKp"].isNull() && !doc["pidKi"].isNull() && !doc["pidKd"].isNull()) {
          auto pidKp = doc["pidKp"].as<float>();
          auto pidKi = doc["pidKi"].as<float>();
          auto pidKd = doc["pidKd"].as<float>();
          preferences->putFloat(pidPKey, pidKp);
          preferences->putFloat(pidIKey, pidKi);
          preferences->putFloat(pidDKey, pidKd);
          control->setPidValues(pidKp, pidKi, pidKd);
        }

        if (!doc["cooldownFanSpeed"].isNull()) {
          long cooldownFanSpeed = doc["cooldownFanSpeed"].as<long>();
          if (DEBUG) logf("cooldownFanSpeed: %d\n", cooldownFanSpeed);
          preferences->putLong(coolingFanKey, cooldownFanSpeed);
        }


        if (!doc["wifiSsid"].isNull() && !doc["wifiPass"].isNull()) {
          if (DEBUG) log("Wifi Credentials found, saving...");
          String wifiSSID = doc["wifiSsid"];
          if (DEBUG) log(wifiSSID.c_str());
          preferences->putString(wifiSSIDKey, wifiSSID);
          String wifiPass = doc["wifiPass"];
          log(wifiPass.c_str());
          preferences->putString(wifiPassKey, wifiPass);
        }
      }

      if (command != nullptr && (strncmp(command, "setPreferences", 14) == 0 || strncmp(command, "getPreferences", 14)
                                 ==
                                 0)) {
        JsonObject root = doc.to<JsonObject>();
        JsonObject resultData = root["data"].to<JsonObject>();

        root["id"] = ln_id;
        resultData["type"] = "preferences";
        resultData["pidKp"] = preferences->getFloat(pidPKey, 1.0);
        resultData["pidKi"] = preferences->getFloat(pidIKey, 0.1);
        resultData["pidKd"] = preferences->getFloat(pidDKey, 0.01);
        resultData["cooldownFanSpeed"] = preferences->getLong(coolingFanKey, 65);

        char buffer[200]; // create temp buffer
        serializeJson(doc, buffer); // serialize to buffer
        // DEBUG WEBSOCKET
        if (DEBUG) log(buffer);

        client->text(buffer);
      }
    }
    break;
    default:
      logf("unhandled message type: %d\n", type);
      break;
  }
}


void WSRequestHandler::loop() {
  if (millis() - _lastUpdate < 100)
    return; // Max update frequency 100ms

  JsonDocument doc;
  JsonObject root = doc.to<JsonObject>();
  JsonObject resultData = root["data"].to<JsonObject>();

  resultData["type"] = "status";
  resultData["ET"] = control->getExhaustTemp();
  resultData["BT"] = control->getBeanTemp();
  resultData["Amb"] = control->getAmbientTemp();
  resultData["BurnerVal"] = control->getHeater();
  resultData["Setpoint"] = control->getSetpoint();
  resultData["Target"] = control->getTemperatureTarget();
  resultData["Mode"] = modeToChar(control->getMode());
  resultData["FanVal"] = control->getFan();
  resultData["pidKp"] = control->getKp();
  resultData["pidKi"] = control->getKi();
  resultData["pidKd"] = control->getKd();

  char buffer[300]; // create temp buffer
  serializeJson(doc, buffer); // serialize to buffer
  // DEBUG WEBSOCKET
  if (DEBUG) log(buffer);

  this->ws->textAll(buffer);
  this->_lastUpdate = millis();
}
