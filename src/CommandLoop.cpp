#include "fan.h"
#include "heater.h"
#include "logging.h"
#include "security.h"
#include "sensors.h"
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>
#include <Preferences.h>
#include <algorithm>
#include <cmath>
#include <cstring>

Preferences preferences;

namespace {
constexpr unsigned long WEB_CLIENT_MANUAL_SAFETY_DELAY_MS = 20000;
constexpr long WEB_CLIENT_MANUAL_SAFETY_FAN_SPEED = 50;
constexpr unsigned long MUTATING_CMD_MIN_INTERVAL_MS = 100;
constexpr long ACTUATOR_MIN_VALUE = 0;
constexpr long ACTUATOR_MAX_VALUE = 100;
unsigned long lastWebClientDisconnectMs = 0;
unsigned long lastMutatingCommandMs = 0;
bool webClientGraceActive = false;
constexpr unsigned long PID_UPDATE_INTERVAL_MS = 400;
unsigned long lastPidUpdateMs = 0;

double pidIntegral = 0.0;
double pidPreviousError = 0.0;
bool pidHasPreviousError = false;
double pidCurrentTemp = NAN;
double pidError = 0.0;
double pidDerivative = 0.0;
double pidOutput = 0.0;

double pidSetpoint = 20.0;
bool pidEnabled = true;
enum class PidTargetSensor { BT, ET, SIM_BT };
PidTargetSensor pidTarget = PidTargetSensor::BT;
enum class PidTuneMethod { ZIEGLER_NICHOLS, TYREUS_LUYBEN, PESSEN_INTEGRAL, NO_OVERSHOOT };
PidTuneMethod pidTuneMethod = PidTuneMethod::ZIEGLER_NICHOLS;
bool pidAutotuneActive = false;
bool pidAutotuneRelayHigh = true;
double pidAutotunePeakHigh = NAN;
double pidAutotunePeakLow = NAN;
unsigned long pidAutotuneLastCrossingMs = 0;
double pidAutotuneHalfCycleSecondsSum = 0.0;
int pidAutotuneHalfCycleCount = 0;
int pidAutotuneCrossings = 0;
unsigned long pidAutotuneStartMs = 0;
double pidAutotuneKu = NAN;
double pidAutotunePu = NAN;
double pidAutotuneHeaterCommand = 0.0;
double pidAutotuneRelayOutputHigh = 60.0;
double pidAutotuneRelayOutputLow = 0.0;
constexpr int PID_AUTOTUNE_MIN_CROSSINGS = 8;

bool isManualRoastModeActive() { return !pidEnabled && !pidAutotuneActive; }

bool isMutatingCommand(const char *command) {
  if (command == NULL) {
    return false;
  }

  return strncmp(command, "setBurner", 9) == 0 || strncmp(command, "setFan", 6) == 0 ||
         strncmp(command, "setPreferences", 14) == 0 || strncmp(command, "setPidControl", 13) == 0;
}

bool enforceMutatingCommandAuth(AsyncWebSocketClient *client, JsonDocument &doc) {
  const char *authToken = doc["authToken"] | "";
  if (!isValidAdminToken(authToken)) {
    client->text("{\"error\":\"unauthorized mutating command\"}");
    return false;
  }

  unsigned long now = millis();
  if (now - lastMutatingCommandMs < MUTATING_CMD_MIN_INTERVAL_MS) {
    logf("Mutating command rate-limited (delta=%lu ms)\n", now - lastMutatingCommandMs);
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

bool isActuatorValueInRange(long value) { return value >= ACTUATOR_MIN_VALUE && value <= ACTUATOR_MAX_VALUE; }

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

const char *pidTargetToString(PidTargetSensor target) {
  switch (target) {
  case PidTargetSensor::ET:
    return "ET";
  case PidTargetSensor::SIM_BT:
    return "simBT";
  default:
    return "BT";
  }
}

bool parsePidTarget(const char *target, PidTargetSensor &targetOut) {
  if (target == NULL) {
    return false;
  }
  if (strncmp(target, "ET", 2) == 0) {
    targetOut = PidTargetSensor::ET;
    return true;
  }
  if (strncmp(target, "simBT", 5) == 0) {
    targetOut = PidTargetSensor::SIM_BT;
    return true;
  }
  if (strncmp(target, "BT", 2) == 0) {
    targetOut = PidTargetSensor::BT;
    return true;
  }
  return false;
}

const char *pidMethodToString(PidTuneMethod method) {
  switch (method) {
  case PidTuneMethod::TYREUS_LUYBEN:
    return "tyreus-luyben";
  case PidTuneMethod::PESSEN_INTEGRAL:
    return "pessen-integral";
  case PidTuneMethod::NO_OVERSHOOT:
    return "no-overshoot";
  default:
    return "ziegler-nichols";
  }
}

bool parsePidMethod(const char *methodValue, PidTuneMethod &methodOut) {
  if (methodValue == NULL) {
    return false;
  }
  if (strncmp(methodValue, "tyreus-luyben", 13) == 0) {
    methodOut = PidTuneMethod::TYREUS_LUYBEN;
    return true;
  }
  if (strncmp(methodValue, "pessen-integral", 15) == 0) {
    methodOut = PidTuneMethod::PESSEN_INTEGRAL;
    return true;
  }
  if (strncmp(methodValue, "no-overshoot", 12) == 0) {
    methodOut = PidTuneMethod::NO_OVERSHOOT;
    return true;
  }
  if (strncmp(methodValue, "ziegler-nichols", 15) == 0) {
    methodOut = PidTuneMethod::ZIEGLER_NICHOLS;
    return true;
  }
  return false;
}

String pidTargetPreferenceKey(const char *baseKey, PidTargetSensor target) {
  String key(baseKey);
  key += "_";
  key += pidTargetToString(target);
  return key;
}

double getPidGain(const char *baseKey, PidTargetSensor target, double defaultValue) {
  String targetKey = pidTargetPreferenceKey(baseKey, target);
  if (preferences.isKey(targetKey.c_str())) {
    return preferences.getDouble(targetKey.c_str(), defaultValue);
  }
  return preferences.getDouble(baseKey, defaultValue);
}

void setPidGain(const char *baseKey, PidTargetSensor target, double value) {
  String targetKey = pidTargetPreferenceKey(baseKey, target);
  preferences.putDouble(targetKey.c_str(), value);
}

bool validateCommandSchema(AsyncWebSocketClient *client, JsonDocument &doc, const char *command) {
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
    if (!doc["pidTarget"].isNull() && !doc["pidTarget"].is<const char *>()) {
      client->text("{\"error\":\"invalid schema: pidTarget must be string\"}");
      return false;
    }
    if (!doc["cooldownFanSpeed"].isNull() && !doc["cooldownFanSpeed"].is<long>()) {
      client->text("{\"error\":\"invalid schema: cooldownFanSpeed must be numeric\"}");
      return false;
    }
  }

  if (strncmp(command, "setPidControl", 13) == 0) {
    if (!doc["setpoint"].isNull() && !doc["setpoint"].is<double>()) {
      client->text("{\"error\":\"invalid schema: setpoint must be numeric\"}");
      return false;
    }
    if (!doc["pidEnabled"].isNull() && !doc["pidEnabled"].is<bool>()) {
      client->text("{\"error\":\"invalid schema: pidEnabled must be boolean\"}");
      return false;
    }
    if (!doc["pidTarget"].isNull() && !doc["pidTarget"].is<const char *>()) {
      client->text("{\"error\":\"invalid schema: pidTarget must be string\"}");
      return false;
    }
    if (!doc["pidAutotune"].isNull() && !doc["pidAutotune"].is<bool>()) {
      client->text("{\"error\":\"invalid schema: pidAutotune must be boolean\"}");
      return false;
    }
    if (!doc["pidTuneMethod"].isNull() && !doc["pidTuneMethod"].is<const char *>()) {
      client->text("{\"error\":\"invalid schema: pidTuneMethod must be string\"}");
      return false;
    }
    if (!doc["pidAutotuneMin"].isNull() && !doc["pidAutotuneMin"].is<double>()) {
      client->text("{\"error\":\"invalid schema: pidAutotuneMin must be numeric\"}");
      return false;
    }
    if (!doc["pidAutotuneMax"].isNull() && !doc["pidAutotuneMax"].is<double>()) {
      client->text("{\"error\":\"invalid schema: pidAutotuneMax must be numeric\"}");
      return false;
    }
  }

  return true;
}

void resetPidState() {
  pidIntegral = 0.0;
  pidPreviousError = 0.0;
  pidHasPreviousError = false;
}

void startPidAutotune() {
  pidAutotuneActive = true;
  pidAutotuneRelayHigh = true;
  pidAutotunePeakHigh = NAN;
  pidAutotunePeakLow = NAN;
  pidAutotuneLastCrossingMs = 0;
  pidAutotuneHalfCycleSecondsSum = 0.0;
  pidAutotuneHalfCycleCount = 0;
  pidAutotuneCrossings = 0;
  pidAutotuneStartMs = millis();
  pidAutotuneKu = NAN;
  pidAutotunePu = NAN;
  pidAutotuneHeaterCommand = 0.0;
  pidEnabled = false;
  preferences.putBool("pidEnabled", false);
  logf("PID autotune started (target=%s, method=%s, setpoint=%.2f)\n", pidTargetToString(pidTarget),
       pidMethodToString(pidTuneMethod), pidSetpoint);
  logf("PID autotune relay bounds min=%.1f max=%.1f\n", pidAutotuneRelayOutputLow, pidAutotuneRelayOutputHigh);
}

void stopPidAutotune(const char *reason) {
  pidAutotuneActive = false;
  setHeaterPower(0);
  pidAutotuneHeaterCommand = 0.0;
  logf("PID autotune stopped (%s)\n", reason == NULL ? "unknown" : reason);
}

double readPidTargetTemp(PidTargetSensor target, const float *etbt) {
  if (target == PidTargetSensor::ET) {
    return etbt[0];
  }
  if (target == PidTargetSensor::SIM_BT) {
    return getSimulatedInternalBeanTemp();
  }
  return etbt[1];
}

void applyAutotunedPidGains(double ku, double puSeconds) {
  if (puSeconds <= 0.0 || ku <= 0.0) {
    return;
  }

  double kp = 0.6 * ku;
  double ki = 1.2 * ku / puSeconds;
  double kd = 0.075 * ku * puSeconds;

  switch (pidTuneMethod) {
  case PidTuneMethod::TYREUS_LUYBEN: {
    kp = 0.454 * ku;
    const double ti = 2.2 * puSeconds;
    const double td = puSeconds / 6.3;
    ki = kp / ti;
    kd = kp * td;
    break;
  }
  case PidTuneMethod::PESSEN_INTEGRAL:
    kp = 0.7 * ku;
    ki = 1.75 * ku / puSeconds;
    kd = 0.105 * ku * puSeconds;
    break;
  case PidTuneMethod::NO_OVERSHOOT:
    kp = 0.2 * ku;
    ki = 0.4 * ku / puSeconds;
    kd = ku * puSeconds / 15.0;
    break;
  default:
    break;
  }

  setPidGain("pidKp", pidTarget, kp);
  setPidGain("pidKi", pidTarget, ki);
  setPidGain("pidKd", pidTarget, kd);
  preferences.putDouble("pidKp", kp);
  preferences.putDouble("pidKi", ki);
  preferences.putDouble("pidKd", kd);
}
} // namespace

void onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg,
               uint8_t *data, size_t len) {

  switch (type) {
  case WS_EVT_CONNECT:
    logf("[%u] Connected!\n", client->id());
    webClientGraceActive = false;
    lastWebClientDisconnectMs = 0;
    break;
  case WS_EVT_DISCONNECT: {
    logf("[%u] Disconnected!\n", client->id());
    if (isManualRoastModeActive()) {
      webClientGraceActive = true;
      lastWebClientDisconnectMs = millis();
      logf("[%u] Manual mode disconnect detected; starting %lu ms safety countdown\n", client->id(),
           WEB_CLIENT_MANUAL_SAFETY_DELAY_MS);
    } else {
      webClientGraceActive = false;
      lastWebClientDisconnectMs = 0;
      logf("[%u] Disconnect while automatic/profile control active; leaving roast control unchanged\n", client->id());
    }
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

    if (command != NULL && strncmp(command, "setPidControl", 13) == 0) {
      if (!doc["setpoint"].isNull()) {
        pidSetpoint = doc["setpoint"].as<double>();
        preferences.putDouble("pidSetpoint", pidSetpoint);
      }
      if (!doc["pidEnabled"].isNull()) {
        bool nextPidEnabled = doc["pidEnabled"].as<bool>();
        if (pidEnabled != nextPidEnabled) {
          resetPidState();
        }
        pidEnabled = nextPidEnabled;
        preferences.putBool("pidEnabled", pidEnabled);
      }
      if (!doc["pidTarget"].isNull()) {
        PidTargetSensor parsedTarget;
        if (parsePidTarget(doc["pidTarget"].as<const char *>(), parsedTarget)) {
          pidTarget = parsedTarget;
          preferences.putString("pidTarget", pidTargetToString(pidTarget));
          resetPidState();
        } else {
          client->text("{\"error\":\"invalid pidTarget\"}");
          return;
        }
      }
      if (!doc["pidTuneMethod"].isNull()) {
        PidTuneMethod parsedMethod;
        if (parsePidMethod(doc["pidTuneMethod"].as<const char *>(), parsedMethod)) {
          pidTuneMethod = parsedMethod;
          preferences.putString("pidTuneMethod", pidMethodToString(pidTuneMethod));
        } else {
          client->text("{\"error\":\"invalid pidTuneMethod\"}");
          return;
        }
      }
      if (!doc["pidAutotune"].isNull()) {
        bool shouldAutotune = doc["pidAutotune"].as<bool>();
        if (shouldAutotune) {
          startPidAutotune();
        } else {
          stopPidAutotune("requested by client");
        }
      }
      if (!doc["pidAutotuneMin"].isNull()) {
        pidAutotuneRelayOutputLow = std::clamp(doc["pidAutotuneMin"].as<double>(), 0.0, 100.0);
        preferences.putDouble("pidAutoMin", pidAutotuneRelayOutputLow);
      }
      if (!doc["pidAutotuneMax"].isNull()) {
        pidAutotuneRelayOutputHigh = std::clamp(doc["pidAutotuneMax"].as<double>(), 0.0, 100.0);
        preferences.putDouble("pidAutoMax", pidAutotuneRelayOutputHigh);
      }
      if (pidAutotuneRelayOutputLow > pidAutotuneRelayOutputHigh) {
        double temp = pidAutotuneRelayOutputLow;
        pidAutotuneRelayOutputLow = pidAutotuneRelayOutputHigh;
        pidAutotuneRelayOutputHigh = temp;
      }
    }

    if (getHeaterPower() > 0 && getFanSpeed() <= 30) {
      setFanSpeed(30);
    }

    if (command != NULL && strncmp(command, "setPreferences", 14) == 0) {
      PidTargetSensor preferenceTarget = pidTarget;
      if (!doc["pidTarget"].isNull()) {
        if (!parsePidTarget(doc["pidTarget"].as<const char *>(), preferenceTarget)) {
          client->text("{\"error\":\"invalid pidTarget\"}");
          return;
        }
        // Keep the active PID target aligned with explicit preference writes so updates
        // are immediately visible/used across the UI and control loop.
        pidTarget = preferenceTarget;
        preferences.putString("pidTarget", pidTargetToString(pidTarget));
      }
      if (!doc["pidKp"].isNull()) {
        double pidKp = doc["pidKp"].as<double>();
        setPidGain("pidKp", preferenceTarget, pidKp);
        preferences.putDouble("pidKp", pidKp);
      }
      if (!doc["pidKi"].isNull()) {
        double pidKi = doc["pidKi"].as<double>();
        setPidGain("pidKi", preferenceTarget, pidKi);
        preferences.putDouble("pidKi", pidKi);
      }
      if (!doc["pidKd"].isNull()) {
        double pidKd = doc["pidKd"].as<double>();
        setPidGain("pidKd", preferenceTarget, pidKd);
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
        (strncmp(command, "setPreferences", 14) == 0 || strncmp(command, "getPreferences", 14) == 0)) {
      JsonObject root = doc.to<JsonObject>();
      JsonObject dataObj = root["data"].to<JsonObject>();
      root["id"] = ln_id;
      dataObj["type"] = "preferences";
      dataObj["pidKp"] = getPidGain("pidKp", pidTarget, 1.0);
      dataObj["pidKi"] = getPidGain("pidKi", pidTarget, 0.1);
      dataObj["pidKd"] = getPidGain("pidKd", pidTarget, 0.01);
      dataObj["cooldownFanSpeed"] = preferences.getLong("coolFanSpeed", 65);
      dataObj["setpoint"] = pidSetpoint;
      dataObj["pidEnabled"] = pidEnabled;
      dataObj["pidTarget"] = pidTargetToString(pidTarget);
      dataObj["pidTuneMethod"] = pidMethodToString(pidTuneMethod);
      dataObj["pidAutotune"] = pidAutotuneActive;
      dataObj["pidCurrentTemp"] = pidCurrentTemp;
      dataObj["pidError"] = pidError;
      dataObj["pidIntegral"] = pidIntegral;
      dataObj["pidDerivative"] = pidDerivative;
      dataObj["pidOutput"] = pidOutput;
      dataObj["pidAutotuneCrossings"] = pidAutotuneCrossings;
      dataObj["pidAutotuneTargetCrossings"] = PID_AUTOTUNE_MIN_CROSSINGS;
      dataObj["pidAutotunePeakHigh"] = pidAutotunePeakHigh;
      dataObj["pidAutotunePeakLow"] = pidAutotunePeakLow;
      dataObj["pidAutotuneKu"] = pidAutotuneKu;
      dataObj["pidAutotunePu"] = pidAutotunePu;
      dataObj["pidAutotuneElapsedSec"] = pidAutotuneStartMs > 0 ? (millis() - pidAutotuneStartMs) / 1000.0 : 0.0;
      double avgHalfCycle = pidAutotuneHalfCycleCount > 0 ? pidAutotuneHalfCycleSecondsSum / pidAutotuneHalfCycleCount : NAN;
      dataObj["pidAutotuneEtaSec"] =
          (pidAutotuneActive && !isnan(avgHalfCycle))
              ? std::max(0.0, (PID_AUTOTUNE_MIN_CROSSINGS - pidAutotuneCrossings) * avgHalfCycle)
              : NAN;
      dataObj["pidAutotuneHeaterCommand"] = pidAutotuneHeaterCommand;
      dataObj["pidAutotuneMin"] = pidAutotuneRelayOutputLow;
      dataObj["pidAutotuneMax"] = pidAutotuneRelayOutputHigh;
      dataObj["pidKpActive"] = getPidGain("pidKp", pidTarget, 1.0);
      dataObj["pidKiActive"] = getPidGain("pidKi", pidTarget, 0.1);
      dataObj["pidKdActive"] = getPidGain("pidKd", pidTarget, 0.01);
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
      dataObj["simBT"] = getSimulatedInternalBeanTemp();
      dataObj["Amb"] = gotReading ? etbt[2] : NAN;
      dataObj["sampleAgeMs"] = millis() - getLastSensorUpdateMs();
      dataObj["sensorOk"] = gotReading;
      dataObj["BurnerVal"] = getHeaterPower();
      dataObj["FanVal"] = getFanSpeed();
      dataObj["setpoint"] = pidSetpoint;
      dataObj["pidEnabled"] = pidEnabled;
      dataObj["pidTarget"] = pidTargetToString(pidTarget);
      dataObj["pidTuneMethod"] = pidMethodToString(pidTuneMethod);
      dataObj["pidAutotune"] = pidAutotuneActive;
      dataObj["pidCurrentTemp"] = pidCurrentTemp;
      dataObj["pidError"] = pidError;
      dataObj["pidIntegral"] = pidIntegral;
      dataObj["pidDerivative"] = pidDerivative;
      dataObj["pidOutput"] = pidOutput;
      dataObj["pidAutotuneCrossings"] = pidAutotuneCrossings;
      dataObj["pidAutotuneTargetCrossings"] = PID_AUTOTUNE_MIN_CROSSINGS;
      dataObj["pidAutotunePeakHigh"] = pidAutotunePeakHigh;
      dataObj["pidAutotunePeakLow"] = pidAutotunePeakLow;
      dataObj["pidAutotuneKu"] = pidAutotuneKu;
      dataObj["pidAutotunePu"] = pidAutotunePu;
      dataObj["pidAutotuneElapsedSec"] = pidAutotuneStartMs > 0 ? (millis() - pidAutotuneStartMs) / 1000.0 : 0.0;
      double avgHalfCycle = pidAutotuneHalfCycleCount > 0 ? pidAutotuneHalfCycleSecondsSum / pidAutotuneHalfCycleCount : NAN;
      dataObj["pidAutotuneEtaSec"] =
          (pidAutotuneActive && !isnan(avgHalfCycle))
              ? std::max(0.0, (PID_AUTOTUNE_MIN_CROSSINGS - pidAutotuneCrossings) * avgHalfCycle)
              : NAN;
      dataObj["pidAutotuneHeaterCommand"] = pidAutotuneHeaterCommand;
      dataObj["pidAutotuneMin"] = pidAutotuneRelayOutputLow;
      dataObj["pidAutotuneMax"] = pidAutotuneRelayOutputHigh;
      dataObj["pidKpActive"] = getPidGain("pidKp", pidTarget, 1.0);
      dataObj["pidKiActive"] = getPidGain("pidKi", pidTarget, 0.1);
      dataObj["pidKdActive"] = getPidGain("pidKd", pidTarget, 0.01);
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
  pidSetpoint = preferences.getDouble("pidSetpoint", 20.0);
  const String configuredTarget = preferences.getString("pidTarget", "BT");
  PidTargetSensor configuredPidTarget;
  if (parsePidTarget(configuredTarget.c_str(), configuredPidTarget)) {
    pidTarget = configuredPidTarget;
  } else {
    pidTarget = PidTargetSensor::BT;
  }
  const String configuredMethod = preferences.getString("pidTuneMethod", "ziegler-nichols");
  PidTuneMethod configuredPidMethod;
  if (parsePidMethod(configuredMethod.c_str(), configuredPidMethod)) {
    pidTuneMethod = configuredPidMethod;
  } else {
    pidTuneMethod = PidTuneMethod::ZIEGLER_NICHOLS;
  }
  pidEnabled = false;
  preferences.putBool("pidEnabled", false);
  pidAutotuneActive = false;
  pidAutotuneRelayOutputLow = std::clamp(preferences.getDouble("pidAutoMin", 0.0), 0.0, 100.0);
  pidAutotuneRelayOutputHigh = std::clamp(preferences.getDouble("pidAutoMax", 60.0), 0.0, 100.0);
  if (pidAutotuneRelayOutputLow > pidAutotuneRelayOutputHigh) {
    double temp = pidAutotuneRelayOutputLow;
    pidAutotuneRelayOutputLow = pidAutotuneRelayOutputHigh;
    pidAutotuneRelayOutputHigh = temp;
  }
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

  if (millis() - lastWebClientDisconnectMs < WEB_CLIENT_MANUAL_SAFETY_DELAY_MS) {
    return;
  }

  setHeaterPower(0);
  setFanSpeed(WEB_CLIENT_MANUAL_SAFETY_FAN_SPEED);
  webClientGraceActive = false;
  log("Manual mode websocket disconnect timeout reached, applying safety output (heater=0, fan=50)");
}

void updatePidControl() {
  unsigned long now = millis();
  if (now - lastPidUpdateMs < PID_UPDATE_INTERVAL_MS) {
    return;
  }
  lastPidUpdateMs = now;

  if (!pidEnabled && !pidAutotuneActive) {
    return;
  }

  float etbt[3];
  if (!getETBTReadings(etbt)) {
    return;
  }

  double currentTemp = readPidTargetTemp(pidTarget, etbt);
  if (isnan(currentTemp)) {
    return;
  }

  if (pidAutotuneActive) {
    if (pidAutotuneRelayHigh) {
      if (isnan(pidAutotunePeakHigh) || currentTemp > pidAutotunePeakHigh) {
        pidAutotunePeakHigh = currentTemp;
      }
      setHeaterPower(lround(pidAutotuneRelayOutputHigh));
      pidAutotuneHeaterCommand = pidAutotuneRelayOutputHigh;
      if (currentTemp >= pidSetpoint) {
        pidAutotuneRelayHigh = false;
        if (pidAutotuneLastCrossingMs != 0) {
          pidAutotuneHalfCycleSecondsSum += (now - pidAutotuneLastCrossingMs) / 1000.0;
          pidAutotuneHalfCycleCount++;
        }
        pidAutotuneLastCrossingMs = now;
        pidAutotuneCrossings++;
      }
    } else {
      if (isnan(pidAutotunePeakLow) || currentTemp < pidAutotunePeakLow) {
        pidAutotunePeakLow = currentTemp;
      }
      setHeaterPower(lround(pidAutotuneRelayOutputLow));
      pidAutotuneHeaterCommand = pidAutotuneRelayOutputLow;
      if (currentTemp <= pidSetpoint) {
        pidAutotuneRelayHigh = true;
        if (pidAutotuneLastCrossingMs != 0) {
          pidAutotuneHalfCycleSecondsSum += (now - pidAutotuneLastCrossingMs) / 1000.0;
          pidAutotuneHalfCycleCount++;
        }
        pidAutotuneLastCrossingMs = now;
        pidAutotuneCrossings++;
      }
    }

    if (pidAutotuneCrossings >= PID_AUTOTUNE_MIN_CROSSINGS && pidAutotuneHalfCycleCount > 0 &&
        !isnan(pidAutotunePeakHigh) && !isnan(pidAutotunePeakLow) && pidAutotunePeakHigh > pidAutotunePeakLow) {
      const double oscillationAmplitude = (pidAutotunePeakHigh - pidAutotunePeakLow) / 2.0;
      const double relayAmplitude = (pidAutotuneRelayOutputHigh - pidAutotuneRelayOutputLow) / 2.0;
      const double ku = (4.0 * relayAmplitude) / (M_PI * oscillationAmplitude);
      const double puSeconds = 2.0 * (pidAutotuneHalfCycleSecondsSum / pidAutotuneHalfCycleCount);
      pidAutotuneKu = ku;
      pidAutotunePu = puSeconds;
      applyAutotunedPidGains(ku, puSeconds);
      logf("PID autotune converged (Ku=%.4f, Pu=%.4f, peakHigh=%.2f, peakLow=%.2f)\n", ku, puSeconds,
           pidAutotunePeakHigh, pidAutotunePeakLow);
      stopPidAutotune("converged");
      resetPidState();
    }

    pidCurrentTemp = currentTemp;
    return;
  }

  double error = pidSetpoint - currentTemp;

  double kp = getPidGain("pidKp", pidTarget, 1.0);
  double ki = getPidGain("pidKi", pidTarget, 0.1);
  double kd = getPidGain("pidKd", pidTarget, 0.01);
  double dtSeconds = PID_UPDATE_INTERVAL_MS / 1000.0;

  pidIntegral += error * dtSeconds;
  pidIntegral = std::clamp(pidIntegral, -100.0, 100.0);

  double derivative = 0.0;
  if (pidHasPreviousError) {
    derivative = (error - pidPreviousError) / dtSeconds;
  } else {
    pidHasPreviousError = true;
  }

  double output = kp * error + ki * pidIntegral + kd * derivative;
  long heaterPower = lround(std::clamp(output, 0.0, 100.0));
  setHeaterPower(heaterPower);
  pidPreviousError = error;
  pidCurrentTemp = currentTemp;
  pidError = error;
  pidDerivative = derivative;
  pidOutput = output;
}
