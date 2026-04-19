#include "Control.h"
#include "config.h"
#include <Arduino.h>


const char *modeToChar(OperationalMode mode) {
  const char *result;
  if (mode == OperationalMode::Auto) {
    result = "PID";
  } else if (mode == OperationalMode::Tune) {
    result = "Tuning";
  } else {
    result = "Manual";
  }
  return result;
}


Control::Control(float kp, float ki, float kd, TemperatureTarget target)
  : _autotune(0, MAX_HEATER_POWER, TuningMethod::ZieglerNichols),
    _temperatureTarget(target),
    lastUpdate(0),
    tuningEnabled(false),
    hasResults(false),
    _fan(FAN_PIN, FAN_FREQUENCY, 10, 0),
    _heater(HEATER_PIN, HEATER_FREQUENCY, 10, 1),
    _etSensor(MAX1CLK, MAX1CS, MAX1DO, "Exhaust"),
    _btSensor(MAX2CLK, MAX2CS, MAX2DO, "Bean") {
  _autotune.setManualGains(kp, ki, kd);
  _autotune.enableAntiWindup(true, 0.8);
  _autotune.setOscillationMode(OscillationMode::Normal);
  _autotune.setSetpoint(0.);
  _autotune.setOperationalMode(OperationalMode::Manual);
  _autotune.setManualOutput(0.);
}


void Control::setPidValues(float kp, float ki, float kd) {
  _autotune.setManualGains(kp, ki, kd);
}

void Control::setSetpoint(float setpoint) {
  if (_autotune.getSetpoint() == 0 && setpoint > 0.) {
    _autotune.resetError();
  }
  _autotune.setSetpoint(max(min(setpoint, 250.f), 0.f));
}

void Control::setHeater(float value) {
  _autotune.setManualOutput(value);
}

void Control::startAutotune() {
  _autotune.setOperationalMode(OperationalMode::Tune);
  tuningEnabled = true;
}

void Control::resetAutotune() {
  hasResults = false;
}

bool Control::hasAutotuneResults() const {
  return hasResults;
}

float Control::getKp() const {
  return _autotune.getKp();
}

float Control::getKi() const {
  return _autotune.getKi();
}

float Control::getKd() const {
  return _autotune.getKd();
}

void Control::setFan(float value) {
  _fan.setValue(value);
}

float Control::getFan() const {
  return _fan.getValue();
}

void Control::setTemperatureTarget(TemperatureTarget target) {
  _temperatureTarget = target;
}

float Control::getHeater() const {
  return _autotune.getOutput();
}

float Control::getSetpoint() const {
  return _autotune.getSetpoint();
}

float Control::getExhaustTemp() const {
  return this->_etSensor.getValue();
}

float Control::getBeanTemp() const {
  return this->_btSensor.getValue();
}

float Control::getAmbientTemp() const {
  return this->_btSensor.getAmbient();
}

const char *Control::getTemperatureTarget() const {
  const char *result;
  if (_temperatureTarget == TemperatureTarget::BT) {
    result = "BT";
  } else if (_temperatureTarget == TemperatureTarget::ET) {
    result = "ET";
  } else {
    result = "MAX";
  }
  return result;
}

OperationalMode Control::getMode() {
  return _autotune.getOperationalMode();
}

void Control::setMode(OperationalMode mode) {
  _autotune.setOperationalMode(mode);
}


float Control::getTemperature() const {
  float bt = this->_btSensor.getFilteredValue();
  float et = this->_etSensor.getFilteredValue();

  if (_temperatureTarget == TemperatureTarget::BT) {
    return bt;
  }
  if (_temperatureTarget == TemperatureTarget::ET) {
    return et;
  }
  if (_temperatureTarget == TemperatureTarget::MAX) {
    return max(bt, et);
  }
  return 0.f;
}

void Control::loop() {
  if (tuningEnabled && _autotune.getOperationalMode() != OperationalMode::Tune) {
    // tuning completed, set status accordingly
    tuningEnabled = false;
    hasResults = true;
    setFan(30.f);
    setSetpoint(0);
  }

  unsigned long now = millis();
  unsigned long dt = (now - lastUpdate);
  if (dt < noUpdateBeforeMs) {
    return;
  }
  this->_btSensor.takeReading();
  this->_etSensor.takeReading();

  float temp = getTemperature();
  _autotune.update(temp);

  float heaterValue = _autotune.getOutput();
  if (heaterValue > 0. && getFan() <= 10) {
    setFan(30.f);
  }

  _heater.setValue(heaterValue);
}
