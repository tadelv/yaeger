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
constexpr double PID_OUTPUT_SMOOTHING_ALPHA = 0.25;
constexpr const char *PREF_PID_DELAY_SEC = "pidDelaySec";
constexpr const char *PREF_PID_MEASURED_DELAY_SEC = "pidMeasSec";
constexpr const char *PREF_PID_PREDICTOR_ENABLED = "pidPredEn";
unsigned long lastPidUpdateMs = 0;
constexpr unsigned long ROAST_HISTORY_SAMPLE_INTERVAL_MS = 1000;
constexpr size_t ROAST_HISTORY_MAX_SAMPLES = 1800;

double pidIntegral = 0.0;
double pidPreviousError = 0.0;
bool pidHasPreviousError = false;
double pidCurrentTemp = NAN;
double pidError = 0.0;
double pidDerivative = 0.0;
double pidOutput = 0.0;
double pidSmoothedOutput = 0.0;
double pidPredictedTemp = NAN;
double pidTempSlope = 0.0;
double pidPreviousTemp = NAN;
bool pidHasPreviousTemp = false;
double pidProcessDelaySeconds = 0.0;
bool pidPredictorEnabled = true;

double pidSetpoint = 20.0;
bool pidEnabled = true;
enum class PidTargetSensor { BT, ET, SIM_BT };
PidTargetSensor pidTarget = PidTargetSensor::BT;
enum class PidTuneMethod { ZIEGLER_NICHOLS, TYREUS_LUYBEN, PESSEN_INTEGRAL, NO_OVERSHOOT };
PidTuneMethod pidTuneMethod = PidTuneMethod::ZIEGLER_NICHOLS;
enum class ControlMode { PID, ADRC };
ControlMode controlMode = ControlMode::PID;
enum class AutotuneMode { PID, ADRC };
AutotuneMode autotuneMode = AutotuneMode::PID;
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
constexpr size_t PID_AUTOTUNE_PEAK_WINDOW = 6;
double pidAutotuneCyclePeak = NAN;
double pidAutotuneHighPeaks[PID_AUTOTUNE_PEAK_WINDOW] = {0};
double pidAutotuneLowPeaks[PID_AUTOTUNE_PEAK_WINDOW] = {0};
size_t pidAutotuneHighPeakCount = 0;
size_t pidAutotuneLowPeakCount = 0;
double pidAutotuneAvgPeakHigh = NAN;
double pidAutotuneAvgPeakLow = NAN;

// Fan envelope used when ADRC is allowed to command airflow.
double controlFanMin = 30.0;
double controlFanMax = 80.0;

// ADRC control states/parameters.
bool adrcAutotuneActive = false;
unsigned long adrcAutotuneStartMs = 0;
double adrcAutotuneBaselineSum = 0.0;
int adrcAutotuneBaselineSamples = 0;
double adrcAutotuneBaselineTemp = NAN;
double adrcAutotunePeakSlope = 0.0;
double adrcAutotuneHeaterStep = 60.0;
double adrcObserverZ1 = NAN;
double adrcObserverZ2 = 0.0;
double adrcObserverZ3 = 0.0;
double adrcLastCommand = 0.0;
double adrcB0 = 0.02;
double adrcW0 = 1.0;
double adrcWc = 0.25;
bool adrcFanControlEnabled = true;

enum class PidDelayMeasureState { IDLE, STABILIZING, HEATING, COMPLETE, FAILED };
PidDelayMeasureState pidDelayMeasureState = PidDelayMeasureState::IDLE;
unsigned long pidDelayMeasureStartMs = 0;
unsigned long pidDelayHeatStartMs = 0;
double pidDelayBaselineTemp = NAN;
double pidMeasuredProcessDelaySeconds = NAN;
double pidDelayMeasureFan = 50.0;
double pidDelayMeasureHeater = 60.0;
double pidDelayStabilizeTempSum = 0.0;
int pidDelayStabilizeSampleCount = 0;
int pidDelayRiseSampleCount = 0;
constexpr unsigned long PID_DELAY_STABILIZE_MS = 10000;
constexpr double PID_DELAY_RISE_THRESHOLD_C = 0.2;
constexpr double PID_DELAY_RISE_SLOPE_THRESHOLD = 0.02;
constexpr int PID_DELAY_RISE_CONSECUTIVE_SAMPLES = 3;

double loadPidDelaySecondsPreference() {
  double storedDelay = preferences.getDouble(PREF_PID_DELAY_SEC, NAN);
  if (isnan(storedDelay)) {
    // Legacy key path (too long for ESP32 NVS, kept as fallback in case target firmware supported it).
    storedDelay = preferences.getDouble("pidProcessDelaySec", 0.0);
  }
  return std::max(0.0, storedDelay);
}

double loadPidMeasuredDelaySecondsPreference(double fallbackDelaySeconds) {
  double storedMeasuredDelay = preferences.getDouble(PREF_PID_MEASURED_DELAY_SEC, NAN);
  if (isnan(storedMeasuredDelay)) {
    // Legacy key path (too long for ESP32 NVS, kept as fallback in case target firmware supported it).
    storedMeasuredDelay = preferences.getDouble("pidMeasuredProcessDelaySec", fallbackDelaySeconds);
  }
  return std::max(0.0, storedMeasuredDelay);
}

bool loadPidPredictorEnabledPreference() {
  if (preferences.isKey(PREF_PID_PREDICTOR_ENABLED)) {
    return preferences.getBool(PREF_PID_PREDICTOR_ENABLED, true);
  }
  // Legacy key path (too long for ESP32 NVS, kept as fallback in case target firmware supported it).
  return preferences.getBool("pidPredictorEnabled", true);
}

void pushAutotunePeak(double *buffer, size_t &count, double value) {
  if (isnan(value)) {
    return;
  }
  if (count < PID_AUTOTUNE_PEAK_WINDOW) {
    buffer[count++] = value;
    return;
  }
  for (size_t i = 1; i < PID_AUTOTUNE_PEAK_WINDOW; i++) {
    buffer[i - 1] = buffer[i];
  }
  buffer[PID_AUTOTUNE_PEAK_WINDOW - 1] = value;
}

double averageAutotunePeaks(const double *buffer, size_t count) {
  if (count == 0) {
    return NAN;
  }
  double sum = 0.0;
  for (size_t i = 0; i < count; i++) {
    sum += buffer[i];
  }
  return sum / count;
}

const char *sensorErrorSummary(SensorErrorCode exhaustError, SensorErrorCode beanError) {
  bool exhaustFault = exhaustError != SENSOR_OK;
  bool beanFault = beanError != SENSOR_OK;
  if (exhaustFault && beanFault) {
    return "ET+BT";
  }
  if (exhaustFault) {
    return "ET";
  }
  if (beanFault) {
    return "BT";
  }
  return "none";
}

const char *pidDelayMeasureStateToString(PidDelayMeasureState state) {
  switch (state) {
  case PidDelayMeasureState::STABILIZING:
    return "stabilizing";
  case PidDelayMeasureState::HEATING:
    return "heating";
  case PidDelayMeasureState::COMPLETE:
    return "complete";
  case PidDelayMeasureState::FAILED:
    return "failed";
  default:
    return "idle";
  }
}

const char *adrcAutotunePhaseToString() {
  if (!adrcAutotuneActive || adrcAutotuneStartMs == 0) {
    return "idle";
  }
  const unsigned long elapsed = millis() - adrcAutotuneStartMs;
  if (elapsed < 10000) {
    return "baseline";
  }
  if (elapsed < 35000) {
    return "step";
  }
  return "applying";
}

struct RoastHistorySample {
  unsigned long ms;
  float et;
  float bt;
  float amb;
  float simBt;
  long burnerVal;
  long fanVal;
  double setpoint;
  bool pidEnabled;
};

RoastHistorySample roastHistory[ROAST_HISTORY_MAX_SAMPLES];
size_t roastHistoryStart = 0;
size_t roastHistoryCount = 0;
bool roastSessionActive = false;
unsigned long roastSessionStartMs = 0;
unsigned long lastRoastHistorySampleMs = 0;

bool isManualRoastModeActive() { return !pidEnabled && !pidAutotuneActive && !adrcAutotuneActive; }

bool isMutatingCommand(const char *command) {
  if (command == NULL) {
    return false;
  }

  return strncmp(command, "setBurner", 9) == 0 || strncmp(command, "setFan", 6) == 0 ||
         strncmp(command, "setPreferences", 14) == 0 || strncmp(command, "setPidControl", 13) == 0 ||
         strncmp(command, "startRoastSession", 17) == 0 || strncmp(command, "endRoastSession", 15) == 0 ||
         strncmp(command, "clearRoastHistory", 17) == 0 || strncmp(command, "emergencyStop", 13) == 0 ||
         strncmp(command, "clearEmergencyStop", 18) == 0;
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

const char *controlModeToString(ControlMode mode) {
  switch (mode) {
  case ControlMode::ADRC:
    return "adrc";
  default:
    return "pid";
  }
}

bool parseControlMode(const char *value, ControlMode &modeOut) {
  if (value == NULL) {
    return false;
  }
  if (strncmp(value, "adrc", 4) == 0) {
    modeOut = ControlMode::ADRC;
    return true;
  }
  if (strncmp(value, "pid", 3) == 0) {
    modeOut = ControlMode::PID;
    return true;
  }
  return false;
}

const char *autotuneModeToString(AutotuneMode mode) {
  switch (mode) {
  case AutotuneMode::ADRC:
    return "adrc";
  default:
    return "pid";
  }
}

bool parseAutotuneMode(const char *value, AutotuneMode &modeOut) {
  if (value == NULL) {
    return false;
  }
  if (strncmp(value, "adrc", 4) == 0) {
    modeOut = AutotuneMode::ADRC;
    return true;
  }
  if (strncmp(value, "pid", 3) == 0) {
    modeOut = AutotuneMode::PID;
    return true;
  }
  return false;
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
    if (!doc["pidMeasureDelay"].isNull() && !doc["pidMeasureDelay"].is<bool>()) {
      client->text("{\"error\":\"invalid schema: pidMeasureDelay must be boolean\"}");
      return false;
    }
    if (!doc["pidDelayFan"].isNull() && !doc["pidDelayFan"].is<double>()) {
      client->text("{\"error\":\"invalid schema: pidDelayFan must be numeric\"}");
      return false;
    }
    if (!doc["pidDelayHeater"].isNull() && !doc["pidDelayHeater"].is<double>()) {
      client->text("{\"error\":\"invalid schema: pidDelayHeater must be numeric\"}");
      return false;
    }
    if (!doc["pidProcessDelaySec"].isNull() && !doc["pidProcessDelaySec"].is<double>()) {
      client->text("{\"error\":\"invalid schema: pidProcessDelaySec must be numeric\"}");
      return false;
    }
    if (!doc["pidPredictorEnabled"].isNull() && !doc["pidPredictorEnabled"].is<bool>()) {
      client->text("{\"error\":\"invalid schema: pidPredictorEnabled must be boolean\"}");
      return false;
    }
    if (!doc["controlMode"].isNull() && !doc["controlMode"].is<const char *>()) {
      client->text("{\"error\":\"invalid schema: controlMode must be string\"}");
      return false;
    }
    if (!doc["autotuneMode"].isNull() && !doc["autotuneMode"].is<const char *>()) {
      client->text("{\"error\":\"invalid schema: autotuneMode must be string\"}");
      return false;
    }
    if (!doc["controlFanMin"].isNull() && !doc["controlFanMin"].is<double>()) {
      client->text("{\"error\":\"invalid schema: controlFanMin must be numeric\"}");
      return false;
    }
    if (!doc["controlFanMax"].isNull() && !doc["controlFanMax"].is<double>()) {
      client->text("{\"error\":\"invalid schema: controlFanMax must be numeric\"}");
      return false;
    }
    if (!doc["adrcFanControlEnabled"].isNull() && !doc["adrcFanControlEnabled"].is<bool>()) {
      client->text("{\"error\":\"invalid schema: adrcFanControlEnabled must be boolean\"}");
      return false;
    }
    if (!doc["adrcAutotune"].isNull() && !doc["adrcAutotune"].is<bool>()) {
      client->text("{\"error\":\"invalid schema: adrcAutotune must be boolean\"}");
      return false;
    }
    if (!doc["adrcB0"].isNull() && !doc["adrcB0"].is<double>()) {
      client->text("{\"error\":\"invalid schema: adrcB0 must be numeric\"}");
      return false;
    }
    if (!doc["adrcW0"].isNull() && !doc["adrcW0"].is<double>()) {
      client->text("{\"error\":\"invalid schema: adrcW0 must be numeric\"}");
      return false;
    }
    if (!doc["adrcWc"].isNull() && !doc["adrcWc"].is<double>()) {
      client->text("{\"error\":\"invalid schema: adrcWc must be numeric\"}");
      return false;
    }
  }

  return true;
}

void resetRoastHistorySession() {
  roastHistoryStart = 0;
  roastHistoryCount = 0;
  roastSessionStartMs = millis();
  lastRoastHistorySampleMs = 0;
}

void appendRoastHistorySample(const RoastHistorySample &sample) {
  if (roastHistoryCount < ROAST_HISTORY_MAX_SAMPLES) {
    size_t index = (roastHistoryStart + roastHistoryCount) % ROAST_HISTORY_MAX_SAMPLES;
    roastHistory[index] = sample;
    roastHistoryCount++;
    return;
  }

  roastHistory[roastHistoryStart] = sample;
  roastHistoryStart = (roastHistoryStart + 1) % ROAST_HISTORY_MAX_SAMPLES;
}

void resetPidState() {
  pidIntegral = 0.0;
  pidPreviousError = 0.0;
  pidHasPreviousError = false;
  pidSmoothedOutput = getHeaterPower();
  pidPredictedTemp = NAN;
  pidTempSlope = 0.0;
  pidPreviousTemp = NAN;
  pidHasPreviousTemp = false;
}

void resetAdrcState() {
  adrcObserverZ1 = NAN;
  adrcObserverZ2 = 0.0;
  adrcObserverZ3 = 0.0;
  adrcLastCommand = getHeaterPower();
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
  pidAutotuneCyclePeak = NAN;
  pidAutotuneHighPeakCount = 0;
  pidAutotuneLowPeakCount = 0;
  pidAutotuneAvgPeakHigh = NAN;
  pidAutotuneAvgPeakLow = NAN;
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

void startAdrcAutotune() {
  adrcAutotuneActive = true;
  adrcAutotuneStartMs = millis();
  adrcAutotuneBaselineSum = 0.0;
  adrcAutotuneBaselineSamples = 0;
  adrcAutotuneBaselineTemp = NAN;
  adrcAutotunePeakSlope = 0.0;
  pidEnabled = false;
  preferences.putBool("pidEnabled", false);
  setHeaterPower(0);
  if (adrcFanControlEnabled) {
    setFanSpeed(lround(std::clamp((controlFanMin + controlFanMax) * 0.5, controlFanMin, controlFanMax)));
  }
  logf("ADRC autotune started (target=%s, setpoint=%.2f)\n", pidTargetToString(pidTarget), pidSetpoint);
}

void stopAdrcAutotune(const char *reason) {
  adrcAutotuneActive = false;
  setHeaterPower(0);
  logf("ADRC autotune stopped (%s)\n", reason == NULL ? "unknown" : reason);
}

void startPidDelayMeasurement() {
  pidDelayMeasureState = PidDelayMeasureState::STABILIZING;
  pidDelayMeasureStartMs = millis();
  pidDelayHeatStartMs = 0;
  pidDelayBaselineTemp = NAN;
  pidMeasuredProcessDelaySeconds = NAN;
  pidDelayStabilizeTempSum = 0.0;
  pidDelayStabilizeSampleCount = 0;
  pidDelayRiseSampleCount = 0;
  pidEnabled = false;
  pidAutotuneActive = false;
  preferences.putBool("pidEnabled", false);
  setFanSpeed(lround(std::clamp(pidDelayMeasureFan, 0.0, 100.0)));
  setHeaterPower(0);
  logf("PID delay measurement started (fan=%.1f, heater=%.1f)\n", pidDelayMeasureFan, pidDelayMeasureHeater);
}

void stopPidDelayMeasurement(const char *reason, bool failed = false) {
  pidDelayMeasureState = failed ? PidDelayMeasureState::FAILED : PidDelayMeasureState::COMPLETE;
  setHeaterPower(0);
  logf("PID delay measurement %s (%s, delay=%.2fs)\n", failed ? "failed" : "completed",
       reason == NULL ? "unknown" : reason, pidMeasuredProcessDelaySeconds);
}

void setEmergencyStopState(bool active) {
  setHeaterForcedOff(active);
  if (active) {
    pidEnabled = false;
    pidAutotuneActive = false;
    adrcAutotuneActive = false;
    pidDelayMeasureState = PidDelayMeasureState::IDLE;
    setHeaterPower(0);
    log("Emergency stop active: heater output clamped to 0");
  } else {
    log("Emergency stop cleared");
  }
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
      if (!doc["controlMode"].isNull()) {
        ControlMode parsedControlMode;
        if (!parseControlMode(doc["controlMode"].as<const char *>(), parsedControlMode)) {
          client->text("{\"error\":\"invalid controlMode\"}");
          return;
        }
        if (controlMode != parsedControlMode) {
          controlMode = parsedControlMode;
          preferences.putString("controlMode", controlModeToString(controlMode));
          resetPidState();
          resetAdrcState();
        }
      }
      if (!doc["autotuneMode"].isNull()) {
        AutotuneMode parsedAutotuneMode;
        if (!parseAutotuneMode(doc["autotuneMode"].as<const char *>(), parsedAutotuneMode)) {
          client->text("{\"error\":\"invalid autotuneMode\"}");
          return;
        }
        autotuneMode = parsedAutotuneMode;
        preferences.putString("autotuneMode", autotuneModeToString(autotuneMode));
      }
      if (!doc["setpoint"].isNull()) {
        pidSetpoint = doc["setpoint"].as<double>();
        preferences.putDouble("pidSetpoint", pidSetpoint);
      }
      if (!doc["controlFanMin"].isNull()) {
        controlFanMin = std::clamp(doc["controlFanMin"].as<double>(), 0.0, 100.0);
      }
      if (!doc["controlFanMax"].isNull()) {
        controlFanMax = std::clamp(doc["controlFanMax"].as<double>(), 0.0, 100.0);
      }
      if (controlFanMin > controlFanMax) {
        double temp = controlFanMin;
        controlFanMin = controlFanMax;
        controlFanMax = temp;
      }
      preferences.putDouble("controlFanMin", controlFanMin);
      preferences.putDouble("controlFanMax", controlFanMax);
      if (!doc["adrcFanControlEnabled"].isNull()) {
        adrcFanControlEnabled = doc["adrcFanControlEnabled"].as<bool>();
        preferences.putBool("adrcFanCtrl", adrcFanControlEnabled);
      }
      if (!doc["pidEnabled"].isNull()) {
        bool nextPidEnabled = doc["pidEnabled"].as<bool>();
        if (pidEnabled != nextPidEnabled) {
          resetPidState();
          resetAdrcState();
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
          if (autotuneMode == AutotuneMode::ADRC) {
            stopPidAutotune("switching to ADRC autotune");
            startAdrcAutotune();
          } else {
            stopAdrcAutotune("switching to PID autotune");
            startPidAutotune();
          }
        } else {
          stopPidAutotune("requested by client");
          stopAdrcAutotune("requested by client");
        }
      }
      if (!doc["adrcAutotune"].isNull()) {
        bool shouldAutotune = doc["adrcAutotune"].as<bool>();
        autotuneMode = AutotuneMode::ADRC;
        preferences.putString("autotuneMode", autotuneModeToString(autotuneMode));
        if (shouldAutotune) {
          stopPidAutotune("switching to ADRC autotune");
          startAdrcAutotune();
        } else {
          stopAdrcAutotune("requested by client");
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
      if (!doc["pidDelayFan"].isNull()) {
        pidDelayMeasureFan = std::clamp(doc["pidDelayFan"].as<double>(), 0.0, 100.0);
        preferences.putDouble("pidDelayFan", pidDelayMeasureFan);
      }
      if (!doc["pidDelayHeater"].isNull()) {
        pidDelayMeasureHeater = std::clamp(doc["pidDelayHeater"].as<double>(), 0.0, 100.0);
        preferences.putDouble("pidDelayHeater", pidDelayMeasureHeater);
      }
      if (!doc["pidProcessDelaySec"].isNull()) {
        pidProcessDelaySeconds = std::max(0.0, doc["pidProcessDelaySec"].as<double>());
        pidMeasuredProcessDelaySeconds = pidProcessDelaySeconds;
        preferences.putDouble(PREF_PID_MEASURED_DELAY_SEC, pidMeasuredProcessDelaySeconds);
        preferences.putDouble(PREF_PID_DELAY_SEC, pidProcessDelaySeconds);
      }
      if (!doc["pidPredictorEnabled"].isNull()) {
        pidPredictorEnabled = doc["pidPredictorEnabled"].as<bool>();
        preferences.putBool(PREF_PID_PREDICTOR_ENABLED, pidPredictorEnabled);
      }
      if (!doc["adrcB0"].isNull()) {
        adrcB0 = std::max(0.001, doc["adrcB0"].as<double>());
        preferences.putDouble("adrcB0", adrcB0);
      }
      if (!doc["adrcW0"].isNull()) {
        adrcW0 = std::max(0.1, doc["adrcW0"].as<double>());
        preferences.putDouble("adrcW0", adrcW0);
      }
      if (!doc["adrcWc"].isNull()) {
        adrcWc = std::max(0.05, doc["adrcWc"].as<double>());
        preferences.putDouble("adrcWc", adrcWc);
      }
      if (pidAutotuneRelayOutputLow > pidAutotuneRelayOutputHigh) {
        double temp = pidAutotuneRelayOutputLow;
        pidAutotuneRelayOutputLow = pidAutotuneRelayOutputHigh;
        pidAutotuneRelayOutputHigh = temp;
      }
      if (!doc["pidMeasureDelay"].isNull() && doc["pidMeasureDelay"].as<bool>()) {
        stopAdrcAutotune("starting delay measurement");
        startPidDelayMeasurement();
      }
    }

    if (command != NULL && strncmp(command, "startRoastSession", 17) == 0) {
      if (isHeaterForcedOff()) {
        setEmergencyStopState(false);
      }
      resetRoastHistorySession();
      roastSessionActive = true;
      log("Roast history session started");
    }

    if (command != NULL && strncmp(command, "endRoastSession", 15) == 0) {
      roastSessionActive = false;
      log("Roast history session ended");
    }

    if (command != NULL && strncmp(command, "clearRoastHistory", 17) == 0) {
      roastSessionActive = false;
      resetRoastHistorySession();
      log("Roast history cleared");
    }

    if (command != NULL && strncmp(command, "emergencyStop", 13) == 0) {
      setEmergencyStopState(true);
    }

    if (command != NULL && strncmp(command, "clearEmergencyStop", 18) == 0) {
      setEmergencyStopState(false);
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
      dataObj["controlMode"] = controlModeToString(controlMode);
      dataObj["autotuneMode"] = autotuneModeToString(autotuneMode);
      dataObj["pidTarget"] = pidTargetToString(pidTarget);
      dataObj["pidTuneMethod"] = pidMethodToString(pidTuneMethod);
      dataObj["pidAutotune"] = pidAutotuneActive;
      dataObj["adrcAutotune"] = adrcAutotuneActive;
      dataObj["pidCurrentTemp"] = pidCurrentTemp;
      dataObj["pidError"] = pidError;
      dataObj["pidIntegral"] = pidIntegral;
      dataObj["pidDerivative"] = pidDerivative;
      dataObj["pidOutput"] = pidOutput;
      dataObj["pidOutputSmoothed"] = pidSmoothedOutput;
      dataObj["pidPredictedTemp"] = pidPredictedTemp;
      dataObj["pidTempSlope"] = pidTempSlope;
      dataObj["pidProcessDelaySec"] = pidProcessDelaySeconds;
      dataObj["pidPredictorEnabled"] = pidPredictorEnabled;
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
      dataObj["pidAutotuneRelayHigh"] = pidAutotuneRelayHigh;
      dataObj["pidAutotuneCyclePeak"] = pidAutotuneCyclePeak;
      dataObj["pidAutotuneAvgPeakHigh"] = pidAutotuneAvgPeakHigh;
      dataObj["pidAutotuneAvgPeakLow"] = pidAutotuneAvgPeakLow;
      dataObj["pidAutotuneHighPeakCount"] = static_cast<int>(pidAutotuneHighPeakCount);
      dataObj["pidAutotuneLowPeakCount"] = static_cast<int>(pidAutotuneLowPeakCount);
      dataObj["pidDelayMeasureState"] = pidDelayMeasureStateToString(pidDelayMeasureState);
      dataObj["pidDelayMeasureElapsedSec"] =
          pidDelayMeasureState == PidDelayMeasureState::IDLE ? 0.0 : (millis() - pidDelayMeasureStartMs) / 1000.0;
      dataObj["pidMeasuredProcessDelaySec"] = pidMeasuredProcessDelaySeconds;
      dataObj["pidDelayFan"] = pidDelayMeasureFan;
      dataObj["pidDelayHeater"] = pidDelayMeasureHeater;
      dataObj["controlFanMin"] = controlFanMin;
      dataObj["controlFanMax"] = controlFanMax;
      dataObj["adrcFanControlEnabled"] = adrcFanControlEnabled;
      dataObj["adrcB0"] = adrcB0;
      dataObj["adrcW0"] = adrcW0;
      dataObj["adrcWc"] = adrcWc;
      dataObj["adrcZ1"] = adrcObserverZ1;
      dataObj["adrcZ2"] = adrcObserverZ2;
      dataObj["adrcZ3"] = adrcObserverZ3;
      dataObj["adrcLastCommand"] = adrcLastCommand;
      dataObj["adrcAutotunePeakSlope"] = adrcAutotunePeakSlope;
      dataObj["adrcAutotuneElapsedSec"] =
          (adrcAutotuneActive && adrcAutotuneStartMs > 0) ? (millis() - adrcAutotuneStartMs) / 1000.0 : 0.0;
      dataObj["adrcAutotunePhase"] = adrcAutotunePhaseToString();
      dataObj["adrcAutotuneBaselineTemp"] = adrcAutotuneBaselineTemp;
      dataObj["adrcAutotuneHeaterStep"] = adrcAutotuneHeaterStep;
      dataObj["adrcAutotuneBaselineSamples"] = adrcAutotuneBaselineSamples;
      dataObj["pidKpActive"] = getPidGain("pidKp", pidTarget, 1.0);
      dataObj["pidKiActive"] = getPidGain("pidKi", pidTarget, 0.1);
      dataObj["pidKdActive"] = getPidGain("pidKd", pidTarget, 0.01);
      dataObj["emergencyStopActive"] = isHeaterForcedOff();
      SensorErrorCode exhaustError = getExhaustSensorError();
      SensorErrorCode beanError = getBeanSensorError();
      dataObj["exhaustSensorError"] = static_cast<int>(exhaustError);
      dataObj["beanSensorError"] = static_cast<int>(beanError);
      dataObj["sensorErrorSummary"] = sensorErrorSummary(exhaustError, beanError);
    }

    if (command != NULL && strncmp(command, "getData", 7) == 0) {
      JsonObject root = doc.to<JsonObject>();
      JsonObject dataObj = root["data"].to<JsonObject>();
      root["id"] = ln_id;
      float etbt[3];
      bool gotReading = getETBTReadings(etbt);
      SensorErrorCode exhaustError = getExhaustSensorError();
      SensorErrorCode beanError = getBeanSensorError();
      bool sensorOk = gotReading && exhaustError == SENSOR_OK && beanError == SENSOR_OK;
      dataObj["type"] = "status";
      dataObj["ET"] = gotReading ? etbt[0] : NAN;
      dataObj["BT"] = gotReading ? etbt[1] : NAN;
      dataObj["simBT"] = getSimulatedInternalBeanTemp();
      dataObj["Amb"] = gotReading ? etbt[2] : NAN;
      dataObj["sampleAgeMs"] = millis() - getLastSensorUpdateMs();
      dataObj["sensorOk"] = sensorOk;
      dataObj["exhaustSensorError"] = static_cast<int>(exhaustError);
      dataObj["beanSensorError"] = static_cast<int>(beanError);
      dataObj["sensorErrorSummary"] = sensorErrorSummary(exhaustError, beanError);
      dataObj["BurnerVal"] = getHeaterPower();
      dataObj["FanVal"] = getFanSpeed();
      dataObj["setpoint"] = pidSetpoint;
      dataObj["pidEnabled"] = pidEnabled;
      dataObj["controlMode"] = controlModeToString(controlMode);
      dataObj["autotuneMode"] = autotuneModeToString(autotuneMode);
      dataObj["pidTarget"] = pidTargetToString(pidTarget);
      dataObj["pidTuneMethod"] = pidMethodToString(pidTuneMethod);
      dataObj["pidAutotune"] = pidAutotuneActive;
      dataObj["adrcAutotune"] = adrcAutotuneActive;
      dataObj["pidCurrentTemp"] = pidCurrentTemp;
      dataObj["pidError"] = pidError;
      dataObj["pidIntegral"] = pidIntegral;
      dataObj["pidDerivative"] = pidDerivative;
      dataObj["pidOutput"] = pidOutput;
      dataObj["pidOutputSmoothed"] = pidSmoothedOutput;
      dataObj["pidPredictedTemp"] = pidPredictedTemp;
      dataObj["pidTempSlope"] = pidTempSlope;
      dataObj["pidProcessDelaySec"] = pidProcessDelaySeconds;
      dataObj["pidPredictorEnabled"] = pidPredictorEnabled;
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
      dataObj["pidAutotuneRelayHigh"] = pidAutotuneRelayHigh;
      dataObj["pidAutotuneCyclePeak"] = pidAutotuneCyclePeak;
      dataObj["pidAutotuneAvgPeakHigh"] = pidAutotuneAvgPeakHigh;
      dataObj["pidAutotuneAvgPeakLow"] = pidAutotuneAvgPeakLow;
      dataObj["pidAutotuneHighPeakCount"] = static_cast<int>(pidAutotuneHighPeakCount);
      dataObj["pidAutotuneLowPeakCount"] = static_cast<int>(pidAutotuneLowPeakCount);
      dataObj["pidDelayMeasureState"] = pidDelayMeasureStateToString(pidDelayMeasureState);
      dataObj["pidDelayMeasureElapsedSec"] =
          pidDelayMeasureState == PidDelayMeasureState::IDLE ? 0.0 : (millis() - pidDelayMeasureStartMs) / 1000.0;
      dataObj["pidMeasuredProcessDelaySec"] = pidMeasuredProcessDelaySeconds;
      dataObj["pidDelayFan"] = pidDelayMeasureFan;
      dataObj["pidDelayHeater"] = pidDelayMeasureHeater;
      dataObj["controlFanMin"] = controlFanMin;
      dataObj["controlFanMax"] = controlFanMax;
      dataObj["adrcFanControlEnabled"] = adrcFanControlEnabled;
      dataObj["adrcB0"] = adrcB0;
      dataObj["adrcW0"] = adrcW0;
      dataObj["adrcWc"] = adrcWc;
      dataObj["adrcZ1"] = adrcObserverZ1;
      dataObj["adrcZ2"] = adrcObserverZ2;
      dataObj["adrcZ3"] = adrcObserverZ3;
      dataObj["adrcLastCommand"] = adrcLastCommand;
      dataObj["adrcAutotunePeakSlope"] = adrcAutotunePeakSlope;
      dataObj["adrcAutotuneElapsedSec"] =
          (adrcAutotuneActive && adrcAutotuneStartMs > 0) ? (millis() - adrcAutotuneStartMs) / 1000.0 : 0.0;
      dataObj["adrcAutotunePhase"] = adrcAutotunePhaseToString();
      dataObj["adrcAutotuneBaselineTemp"] = adrcAutotuneBaselineTemp;
      dataObj["adrcAutotuneHeaterStep"] = adrcAutotuneHeaterStep;
      dataObj["adrcAutotuneBaselineSamples"] = adrcAutotuneBaselineSamples;
      dataObj["pidKpActive"] = getPidGain("pidKp", pidTarget, 1.0);
      dataObj["pidKiActive"] = getPidGain("pidKi", pidTarget, 0.1);
      dataObj["pidKdActive"] = getPidGain("pidKd", pidTarget, 0.01);
      dataObj["emergencyStopActive"] = isHeaterForcedOff();
    }

    if (command != NULL && strncmp(command, "getRoastHistory", 15) == 0) {
      JsonObject root = doc.to<JsonObject>();
      JsonObject dataObj = root["data"].to<JsonObject>();
      root["id"] = ln_id;
      dataObj["type"] = "roastHistory";
      dataObj["active"] = roastSessionActive;
      dataObj["sessionStartMs"] = roastSessionStartMs;
      dataObj["sampleIntervalMs"] = ROAST_HISTORY_SAMPLE_INTERVAL_MS;
      JsonArray samples = dataObj["samples"].to<JsonArray>();
      for (size_t i = 0; i < roastHistoryCount; i++) {
        size_t idx = (roastHistoryStart + i) % ROAST_HISTORY_MAX_SAMPLES;
        const RoastHistorySample &sample = roastHistory[idx];
        JsonObject sampleObj = samples.add<JsonObject>();
        sampleObj["ms"] = sample.ms;
        sampleObj["ET"] = sample.et;
        sampleObj["BT"] = sample.bt;
        sampleObj["Amb"] = sample.amb;
        sampleObj["simBT"] = sample.simBt;
        sampleObj["BurnerVal"] = sample.burnerVal;
        sampleObj["FanVal"] = sample.fanVal;
        sampleObj["setpoint"] = sample.setpoint;
        sampleObj["pidEnabled"] = sample.pidEnabled;
      }
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
  adrcAutotuneActive = false;
  ControlMode configuredControlMode;
  const String configuredControlModeStr = preferences.getString("controlMode", "pid");
  if (parseControlMode(configuredControlModeStr.c_str(), configuredControlMode)) {
    controlMode = configuredControlMode;
  } else {
    controlMode = ControlMode::PID;
  }
  AutotuneMode configuredAutotuneMode;
  const String configuredAutotuneModeStr = preferences.getString("autotuneMode", "pid");
  if (parseAutotuneMode(configuredAutotuneModeStr.c_str(), configuredAutotuneMode)) {
    autotuneMode = configuredAutotuneMode;
  } else {
    autotuneMode = AutotuneMode::PID;
  }
  controlFanMin = std::clamp(preferences.getDouble("controlFanMin", 30.0), 0.0, 100.0);
  controlFanMax = std::clamp(preferences.getDouble("controlFanMax", 80.0), 0.0, 100.0);
  if (controlFanMin > controlFanMax) {
    double temp = controlFanMin;
    controlFanMin = controlFanMax;
    controlFanMax = temp;
  }
  adrcB0 = std::max(0.001, preferences.getDouble("adrcB0", 0.02));
  adrcW0 = std::max(0.1, preferences.getDouble("adrcW0", 1.0));
  adrcWc = std::max(0.05, preferences.getDouble("adrcWc", 0.25));
  adrcFanControlEnabled = preferences.getBool("adrcFanCtrl", true);
  pidAutotuneRelayOutputLow = std::clamp(preferences.getDouble("pidAutoMin", 0.0), 0.0, 100.0);
  pidAutotuneRelayOutputHigh = std::clamp(preferences.getDouble("pidAutoMax", 60.0), 0.0, 100.0);
  pidDelayMeasureFan = std::clamp(preferences.getDouble("pidDelayFan", 50.0), 0.0, 100.0);
  pidDelayMeasureHeater = std::clamp(preferences.getDouble("pidDelayHeater", 60.0), 0.0, 100.0);
  pidProcessDelaySeconds = loadPidDelaySecondsPreference();
  pidMeasuredProcessDelaySeconds = loadPidMeasuredDelaySecondsPreference(pidProcessDelaySeconds);
  pidPredictorEnabled = loadPidPredictorEnabledPreference();
  if (pidAutotuneRelayOutputLow > pidAutotuneRelayOutputHigh) {
    double temp = pidAutotuneRelayOutputLow;
    pidAutotuneRelayOutputLow = pidAutotuneRelayOutputHigh;
    pidAutotuneRelayOutputHigh = temp;
  }
  resetAdrcState();
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

void updateRoastHistory() {
  if (!roastSessionActive) {
    return;
  }

  unsigned long now = millis();
  if (lastRoastHistorySampleMs != 0 && now - lastRoastHistorySampleMs < ROAST_HISTORY_SAMPLE_INTERVAL_MS) {
    return;
  }

  float etbt[3];
  bool gotReading = getETBTReadings(etbt);
  RoastHistorySample sample = {
      .ms = now,
      .et = gotReading ? etbt[0] : NAN,
      .bt = gotReading ? etbt[1] : NAN,
      .amb = gotReading ? etbt[2] : NAN,
      .simBt = getSimulatedInternalBeanTemp(),
      .burnerVal = getHeaterPower(),
      .fanVal = getFanSpeed(),
      .setpoint = pidSetpoint,
      .pidEnabled = pidEnabled,
  };

  appendRoastHistorySample(sample);
  lastRoastHistorySampleMs = now;
}

void updatePidControl() {
  unsigned long now = millis();
  if (now - lastPidUpdateMs < PID_UPDATE_INTERVAL_MS) {
    return;
  }
  double dtSeconds = lastPidUpdateMs == 0 ? PID_UPDATE_INTERVAL_MS / 1000.0 : (now - lastPidUpdateMs) / 1000.0;
  if (dtSeconds <= 0.0) {
    dtSeconds = PID_UPDATE_INTERVAL_MS / 1000.0;
  }
  lastPidUpdateMs = now;

  bool pidDelayMeasureRunning =
      pidDelayMeasureState == PidDelayMeasureState::STABILIZING || pidDelayMeasureState == PidDelayMeasureState::HEATING;
  if (!pidEnabled && !pidAutotuneActive && !adrcAutotuneActive && !pidDelayMeasureRunning) {
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

  if (pidHasPreviousTemp) {
    pidTempSlope = (currentTemp - pidPreviousTemp) / dtSeconds;
  }
  pidPreviousTemp = currentTemp;
  pidHasPreviousTemp = true;

  if (pidDelayMeasureState == PidDelayMeasureState::STABILIZING) {
    setFanSpeed(lround(std::clamp(pidDelayMeasureFan, 0.0, 100.0)));
    setHeaterPower(0);
    pidDelayStabilizeTempSum += currentTemp;
    pidDelayStabilizeSampleCount++;
    if (now - pidDelayMeasureStartMs >= PID_DELAY_STABILIZE_MS) {
      if (pidDelayStabilizeSampleCount > 0) {
        pidDelayBaselineTemp = pidDelayStabilizeTempSum / pidDelayStabilizeSampleCount;
      } else {
        pidDelayBaselineTemp = currentTemp;
      }
      pidDelayHeatStartMs = now;
      pidDelayMeasureState = PidDelayMeasureState::HEATING;
      setHeaterPower(lround(std::clamp(pidDelayMeasureHeater, 0.0, 100.0)));
      logf("PID delay measurement heating phase started after fixed %lu ms (baseline=%.2f)\n",
           PID_DELAY_STABILIZE_MS, pidDelayBaselineTemp);
    }
    pidCurrentTemp = currentTemp;
    pidPredictedTemp = currentTemp;
    return;
  }

  if (pidDelayMeasureState == PidDelayMeasureState::HEATING) {
    setFanSpeed(lround(std::clamp(pidDelayMeasureFan, 0.0, 100.0)));
    setHeaterPower(lround(std::clamp(pidDelayMeasureHeater, 0.0, 100.0)));
    if (pidTempSlope > PID_DELAY_RISE_SLOPE_THRESHOLD) {
      pidDelayRiseSampleCount++;
    } else {
      pidDelayRiseSampleCount = 0;
    }
    bool crossedBaseline = !isnan(pidDelayBaselineTemp) && currentTemp >= pidDelayBaselineTemp + PID_DELAY_RISE_THRESHOLD_C;
    bool sustainedRise = pidDelayRiseSampleCount >= PID_DELAY_RISE_CONSECUTIVE_SAMPLES;
    if (crossedBaseline || sustainedRise) {
      pidMeasuredProcessDelaySeconds = (now - pidDelayHeatStartMs) / 1000.0;
      pidProcessDelaySeconds = pidMeasuredProcessDelaySeconds;
      preferences.putDouble(PREF_PID_MEASURED_DELAY_SEC, pidMeasuredProcessDelaySeconds);
      preferences.putDouble(PREF_PID_DELAY_SEC, pidProcessDelaySeconds);
      stopPidDelayMeasurement(crossedBaseline ? "temperature crossed baseline threshold" : "sustained positive slope detected");
    } else if (now - pidDelayHeatStartMs > 120000) {
      stopPidDelayMeasurement("timeout waiting for temperature rise", true);
    }
    pidCurrentTemp = currentTemp;
    pidPredictedTemp = currentTemp;
    return;
  }

  if (adrcAutotuneActive) {
    const unsigned long elapsed = now - adrcAutotuneStartMs;
    if (adrcFanControlEnabled) {
      const double fanBaseline = std::clamp((controlFanMin + controlFanMax) * 0.5, controlFanMin, controlFanMax);
      setFanSpeed(lround(fanBaseline));
    }
    if (elapsed < 10000) {
      setHeaterPower(0);
      adrcAutotuneBaselineSum += currentTemp;
      adrcAutotuneBaselineSamples++;
      pidCurrentTemp = currentTemp;
      pidPredictedTemp = currentTemp;
      return;
    }

    if (isnan(adrcAutotuneBaselineTemp)) {
      adrcAutotuneBaselineTemp =
          adrcAutotuneBaselineSamples > 0 ? adrcAutotuneBaselineSum / adrcAutotuneBaselineSamples : currentTemp;
    }

    if (elapsed < 35000) {
      setHeaterPower(lround(std::clamp(adrcAutotuneHeaterStep, 0.0, 100.0)));
      adrcAutotunePeakSlope = std::max(adrcAutotunePeakSlope, std::max(0.0, pidTempSlope));
      pidCurrentTemp = currentTemp;
      pidPredictedTemp = currentTemp;
      return;
    }

    const double slope = std::max(0.001, adrcAutotunePeakSlope);
    const double heaterStep = std::max(1.0, adrcAutotuneHeaterStep);
    adrcB0 = std::clamp(slope / heaterStep, 0.001, 1.0);
    double heuristicW0 = pidProcessDelaySeconds > 0.01 ? (1.0 / pidProcessDelaySeconds) : 1.0;
    adrcW0 = std::clamp(heuristicW0, 0.2, 4.0);
    adrcWc = std::clamp(adrcW0 / 4.0, 0.05, 1.0);
    preferences.putDouble("adrcB0", adrcB0);
    preferences.putDouble("adrcW0", adrcW0);
    preferences.putDouble("adrcWc", adrcWc);
    stopAdrcAutotune("completed");
    resetAdrcState();
    pidCurrentTemp = currentTemp;
    pidPredictedTemp = currentTemp;
    return;
  }

  if (pidAutotuneActive) {
    if (pidAutotuneRelayHigh) {
      if (isnan(pidAutotuneCyclePeak) || currentTemp > pidAutotuneCyclePeak) {
        pidAutotuneCyclePeak = currentTemp;
      }
      setHeaterPower(lround(pidAutotuneRelayOutputHigh));
      pidAutotuneHeaterCommand = pidAutotuneRelayOutputHigh;
      if (currentTemp >= pidSetpoint) {
        pushAutotunePeak(pidAutotuneHighPeaks, pidAutotuneHighPeakCount, pidAutotuneCyclePeak);
        pidAutotuneCyclePeak = NAN;
        pidAutotuneRelayHigh = false;
        if (pidAutotuneLastCrossingMs != 0) {
          pidAutotuneHalfCycleSecondsSum += (now - pidAutotuneLastCrossingMs) / 1000.0;
          pidAutotuneHalfCycleCount++;
        }
        pidAutotuneLastCrossingMs = now;
        pidAutotuneCrossings++;
        logf("PID autotune crossing %d/%d (falling, peak=%.2f, avgHigh=%.2f, avgLow=%.2f)\n", pidAutotuneCrossings,
             PID_AUTOTUNE_MIN_CROSSINGS, pidAutotuneHighPeakCount > 0 ? pidAutotuneHighPeaks[pidAutotuneHighPeakCount - 1] : NAN,
             averageAutotunePeaks(pidAutotuneHighPeaks, pidAutotuneHighPeakCount),
             averageAutotunePeaks(pidAutotuneLowPeaks, pidAutotuneLowPeakCount));
      }
    } else {
      if (isnan(pidAutotuneCyclePeak) || currentTemp < pidAutotuneCyclePeak) {
        pidAutotuneCyclePeak = currentTemp;
      }
      setHeaterPower(lround(pidAutotuneRelayOutputLow));
      pidAutotuneHeaterCommand = pidAutotuneRelayOutputLow;
      if (currentTemp <= pidSetpoint) {
        pushAutotunePeak(pidAutotuneLowPeaks, pidAutotuneLowPeakCount, pidAutotuneCyclePeak);
        pidAutotuneCyclePeak = NAN;
        pidAutotuneRelayHigh = true;
        if (pidAutotuneLastCrossingMs != 0) {
          pidAutotuneHalfCycleSecondsSum += (now - pidAutotuneLastCrossingMs) / 1000.0;
          pidAutotuneHalfCycleCount++;
        }
        pidAutotuneLastCrossingMs = now;
        pidAutotuneCrossings++;
        logf("PID autotune crossing %d/%d (rising, peak=%.2f, avgHigh=%.2f, avgLow=%.2f)\n", pidAutotuneCrossings,
             PID_AUTOTUNE_MIN_CROSSINGS, pidAutotuneLowPeakCount > 0 ? pidAutotuneLowPeaks[pidAutotuneLowPeakCount - 1] : NAN,
             averageAutotunePeaks(pidAutotuneHighPeaks, pidAutotuneHighPeakCount),
             averageAutotunePeaks(pidAutotuneLowPeaks, pidAutotuneLowPeakCount));
      }
    }

    const double avgPeakHigh = averageAutotunePeaks(pidAutotuneHighPeaks, pidAutotuneHighPeakCount);
    const double avgPeakLow = averageAutotunePeaks(pidAutotuneLowPeaks, pidAutotuneLowPeakCount);
    pidAutotuneAvgPeakHigh = avgPeakHigh;
    pidAutotuneAvgPeakLow = avgPeakLow;
    if (pidAutotuneCrossings >= PID_AUTOTUNE_MIN_CROSSINGS && pidAutotuneHalfCycleCount > 0 &&
        pidAutotuneHighPeakCount >= 2 && pidAutotuneLowPeakCount >= 2 && !isnan(avgPeakHigh) && !isnan(avgPeakLow) &&
        avgPeakHigh > avgPeakLow) {
      pidAutotunePeakHigh = avgPeakHigh;
      pidAutotunePeakLow = avgPeakLow;
      const double oscillationAmplitude = (avgPeakHigh - avgPeakLow) / 2.0;
      const double relayAmplitude = (pidAutotuneRelayOutputHigh - pidAutotuneRelayOutputLow) / 2.0;
      const double ku = (4.0 * relayAmplitude) / (M_PI * oscillationAmplitude);
      const double puSeconds = 2.0 * (pidAutotuneHalfCycleSecondsSum / pidAutotuneHalfCycleCount);
      pidAutotuneKu = ku;
      pidAutotunePu = puSeconds;
      applyAutotunedPidGains(ku, puSeconds);
      logf("PID autotune converged (Ku=%.4f, Pu=%.4f, avgPeakHigh=%.2f, avgPeakLow=%.2f)\n", ku, puSeconds,
           avgPeakHigh, avgPeakLow);
      stopPidAutotune("converged");
      resetPidState();
    }

    pidCurrentTemp = currentTemp;
    return;
  }

  if (controlMode == ControlMode::ADRC) {
    if (isnan(adrcObserverZ1)) {
      adrcObserverZ1 = currentTemp;
      adrcObserverZ2 = 0.0;
      adrcObserverZ3 = 0.0;
      adrcLastCommand = getHeaterPower();
    }

    const double y = currentTemp;
    const double b0 = std::max(0.001, adrcB0);
    const double w0 = std::max(0.1, adrcW0);
    const double wc = std::max(0.05, adrcWc);
    const double beta1 = 3.0 * w0;
    const double beta2 = 3.0 * w0 * w0;
    const double beta3 = w0 * w0 * w0;
    const double observerError = adrcObserverZ1 - y;

    adrcObserverZ1 += dtSeconds * (adrcObserverZ2 - beta1 * observerError + b0 * adrcLastCommand);
    adrcObserverZ2 += dtSeconds * (adrcObserverZ3 - beta2 * observerError);
    adrcObserverZ3 += dtSeconds * (-beta3 * observerError);

    const double controlError = pidSetpoint - adrcObserverZ1;
    const double virtualControl = wc * controlError;
    const double rawHeater = (virtualControl - adrcObserverZ2 - adrcObserverZ3) / b0;
    const double heaterCommand = std::clamp(rawHeater, 0.0, 100.0);
    adrcLastCommand += PID_OUTPUT_SMOOTHING_ALPHA * (heaterCommand - adrcLastCommand);
    adrcLastCommand = std::clamp(adrcLastCommand, 0.0, 100.0);

    if (adrcFanControlEnabled) {
      const double fanSpan = std::max(0.0, controlFanMax - controlFanMin);
      const double fanCommand =
          std::clamp(controlFanMin + ((100.0 - adrcLastCommand) / 100.0) * fanSpan, controlFanMin, controlFanMax);
      setFanSpeed(lround(fanCommand));
    }
    setHeaterPower(lround(adrcLastCommand));
    pidPredictedTemp = adrcObserverZ1;
    pidCurrentTemp = currentTemp;
    pidError = controlError;
    pidDerivative = adrcObserverZ2;
    pidOutput = rawHeater;
    pidSmoothedOutput = adrcLastCommand;
    return;
  }

  double controlTemp = currentTemp;
  if (pidPredictorEnabled && pidProcessDelaySeconds > 0.0) {
    controlTemp = currentTemp + pidTempSlope * pidProcessDelaySeconds;
  }
  pidPredictedTemp = controlTemp;
  double error = pidSetpoint - controlTemp;

  double kp = getPidGain("pidKp", pidTarget, 1.0);
  double ki = getPidGain("pidKi", pidTarget, 0.1);
  double kd = getPidGain("pidKd", pidTarget, 0.01);

  double derivative = 0.0;
  if (pidHasPreviousError) {
    derivative = (error - pidPreviousError) / dtSeconds;
  } else {
    pidHasPreviousError = true;
  }

  double unsaturated = kp * error + ki * pidIntegral + kd * derivative;
  double clamped = std::clamp(unsaturated, 0.0, 100.0);
  bool allowIntegrate = unsaturated == clamped || (unsaturated > 100.0 && error < 0.0) || (unsaturated < 0.0 && error > 0.0);
  if (allowIntegrate) {
    pidIntegral += error * dtSeconds;
    pidIntegral = std::clamp(pidIntegral, -100.0, 100.0);
    unsaturated = kp * error + ki * pidIntegral + kd * derivative;
    clamped = std::clamp(unsaturated, 0.0, 100.0);
  }

  pidSmoothedOutput += PID_OUTPUT_SMOOTHING_ALPHA * (clamped - pidSmoothedOutput);
  pidSmoothedOutput = std::clamp(pidSmoothedOutput, 0.0, 100.0);

  double output = unsaturated;
  long heaterPower = lround(pidSmoothedOutput);
  setHeaterPower(heaterPower);
  pidPreviousError = error;
  pidCurrentTemp = currentTemp;
  pidError = error;
  pidDerivative = derivative;
  pidOutput = output;
}
