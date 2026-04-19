#include "FreeRTOS.h"
#include "config.h"
#include "fan.h"
#include "freertos/portmacro.h"
#include "freertos/semphr.h"
#include "heater.h"
#include "logging.h"
#include "sensors.h"
#include <Adafruit_MAX31855.h>
#include <SPI.h>
#include <cstdint>

void getChipTemp() {
  // Get Ambient Temp from DS18B20
  // https://randomnerdtutorials.com/esp32-ds18b20-temperature-arduino-ide/
  float temp = temperatureRead();
  logf("Temperature: %.2f\n", temp);
}

Adafruit_MAX31855 tcExhaust(MAX1CLK, MAX1CS, MAX1DO);
Adafruit_MAX31855 tcBeans(MAX2CLK, MAX2CS, MAX2DO);

constexpr uint8_t kMovingAverageWindowSize = 4;
const unsigned long kSamplingWindowDurationMs = 400;
const uint8_t kFaultDebounceThreshold = 3;

class MovingAverage {
public:
  float process(float value) {
    if (count < kMovingAverageWindowSize) {
      samples[count++] = value;
      sum += value;
    } else {
      sum -= samples[index];
      samples[index] = value;
      sum += value;
    }
    index = (index + 1) % kMovingAverageWindowSize;
    return sum / count;
  }

private:
  float samples[kMovingAverageWindowSize] = {0};
  float sum = 0;
  uint8_t count = 0;
  uint8_t index = 0;
};

MovingAverage exhaustFilter;
MovingAverage beansFilter;
/*SimpleKalmanFilter exhaustFilter(80, 80, 3);*/
/*SimpleKalmanFilter beansFilter(80, 80, 3);*/
unsigned long lastReadTime = 0;
unsigned long lastSensorUpdateMs = 0;
uint8_t exhaustFaultCount = 0;
uint8_t beansFaultCount = 0;
SensorErrorCode exhaustSensorError = SENSOR_OK;
SensorErrorCode beanSensorError = SENSOR_OK;

SemaphoreHandle_t mtx;
StaticSemaphore_t mtx_buffer;

float readings[3] = {0, 0, 0};
float simulatedInternalBeanTemp = NAN;

// 1D Kalman estimator for a "core bean" state:
// x_k = x_(k-1) + dt * (k_env*(ET-x) + k_heat*u_heat - k_fan*u_fan) + w_k
// z_k = BT + alpha * (ET-BT) + v_k
//
// The z_k formulation uses ET-BT differential as a proxy for inward heat flux,
// while control inputs model heater and fan influence on thermal dynamics.
constexpr float kCoreEnvCoupling = 0.010f;     // 1/s
constexpr float kCoreHeaterGain = 0.030f;      // °C/s at 100% heater
constexpr float kCoreFanCoolingGain = 0.025f;  // °C/s at 100% fan
constexpr float kCoreDeltaWeight = 0.25f;      // blend ET-BT differential
constexpr float kKalmanProcessNoiseBase = 0.06f;
constexpr float kKalmanProcessNoiseControlGain = 0.50f;
constexpr float kKalmanMeasurementNoise = 0.35f;
float simulatedBeanVariance = 1.0f;

void takeETReadings(float dt);
void takeBTReadings(float dt);
void primeThermocoupleBusPins();
void reinitializeThermocouples();

void primeThermocoupleBusPins() {
  pinMode(MAX1CS, OUTPUT);
  pinMode(MAX2CS, OUTPUT);
  digitalWrite(MAX1CS, HIGH);
  digitalWrite(MAX2CS, HIGH);

  // Shared MAX31855 MISO line can float on some clone boards; pull-up helps avoid
  // false all-low reads that decode as SHORT_GND faults.
  pinMode(MAX1DO, INPUT_PULLUP);
}

void reinitializeThermocouples() {
  primeThermocoupleBusPins();
  tcExhaust.begin();
  tcBeans.begin();
}

void startSensors() {
  log("Initializing sensors");
  mtx = xSemaphoreCreateRecursiveMutexStatic(&mtx_buffer);
  if (mtx == NULL) {
    log("could not create mutex");
  }
  delay(500); // Give the sensors time to settle
  primeThermocoupleBusPins();
  bool allGood = true;
  allGood &= tcExhaust.begin();
  allGood &= tcBeans.begin();
  logf("Sensors %s\n", allGood ? "initialized" : "failed to init");
}

void takeReadings() {
  unsigned long dt = millis() - lastReadTime;
  if (dt < kSamplingWindowDurationMs) {
    return;
  }
  if (xSemaphoreTakeRecursive(mtx, portMAX_DELAY) == pdTRUE) {
    takeETReadings(dt);
    takeBTReadings(dt);
    lastReadTime = millis();
    float internal = tcExhaust.readInternal();
#ifdef DEBUG
    logf("internal: %.2f\n", internal);
#endif
    readings[2] = internal;

    bool sensorDataValid = exhaustSensorError == SENSOR_OK && beanSensorError == SENSOR_OK;
    if (sensorDataValid) {
      const float dtSeconds = dt / 1000.0f;
      const float et = readings[0];
      const float bt = readings[1];
      const float heaterNorm = getHeaterPower() / 100.0f;
      const float fanNorm = getFanSpeed() / 100.0f;

      if (isnan(simulatedInternalBeanTemp)) {
        simulatedInternalBeanTemp = bt;
        simulatedBeanVariance = 1.0f;
      }

      const float controlInfluence = kCoreHeaterGain * heaterNorm - kCoreFanCoolingGain * fanNorm;
      const float predicted =
          simulatedInternalBeanTemp +
          dtSeconds * (kCoreEnvCoupling * (et - simulatedInternalBeanTemp) + controlInfluence);
      const float processNoise = kKalmanProcessNoiseBase +
                                 kKalmanProcessNoiseControlGain * (fabsf(controlInfluence));
      float predictedVariance = simulatedBeanVariance + processNoise;
      if (predictedVariance < 1e-4f) {
        predictedVariance = 1e-4f;
      }

      const float pseudoMeasurement = bt + kCoreDeltaWeight * (et - bt);
      const float innovation = pseudoMeasurement - predicted;
      const float innovationCovariance = predictedVariance + kKalmanMeasurementNoise;
      const float kalmanGain = predictedVariance / innovationCovariance;

      simulatedInternalBeanTemp = predicted + kalmanGain * innovation;
      simulatedBeanVariance = (1.0f - kalmanGain) * predictedVariance;
    }

    lastSensorUpdateMs = lastReadTime;
    xSemaphoreGiveRecursive(mtx);
  }
}

void takeETReadings(float dt) {
  float exhaustTemp = tcExhaust.readCelsius();
  if (isnan(exhaustTemp)) {
    exhaustFaultCount++;
    if (exhaustFaultCount < kFaultDebounceThreshold) {
      return;
    }

    uint8_t e = tcExhaust.readError();
    exhaustSensorError = SENSOR_ERR_UNKNOWN;
    if ((e & MAX31855_FAULT_OPEN) != 0) {
      exhaustSensorError = SENSOR_ERR_OPEN;
    } else if ((e & MAX31855_FAULT_SHORT_GND) != 0) {
      exhaustSensorError = SENSOR_ERR_SHORT_GND;
    } else if ((e & MAX31855_FAULT_SHORT_VCC) != 0) {
      exhaustSensorError = SENSOR_ERR_SHORT_VCC;
    }
    logf("Exhaust thermocouple fault(s) detected! %d\n", e);
    if (e & MAX31855_FAULT_OPEN) {
      log("FAULT: Exhaust thermocouple open - no connections.");
    }
    if (e & MAX31855_FAULT_SHORT_GND) {
      log("FAULT: Exhaust thermocouple short-circuited to GND.");
    }
    if (e & MAX31855_FAULT_SHORT_VCC) {
      log("FAULT: Exhaust thermocouple short-circuited to VCC.");
    }

    if (e == 0) {
      // Sometimes NaN occurs transiently; attempt sensor re-sync.
      tcExhaust.begin();
    }
    if ((e & MAX31855_FAULT_SHORT_GND) != 0 && beansFaultCount >= kFaultDebounceThreshold) {
      log("Both probes reporting SHORT_GND; reinitializing thermocouple bus");
      reinitializeThermocouples();
      exhaustFaultCount = 0;
      beansFaultCount = 0;
    }
    readings[0] = NAN;
    return;
  }
  exhaustFaultCount = 0;
  exhaustSensorError = SENSOR_OK;
#ifdef DEBUG
  logf("Exhaust Temp: %.2f\n", exhaustTemp);
#endif
  readings[0] = exhaustFilter.process(exhaustTemp);
}

void takeBTReadings(float dt) {
  float beanTemp = tcBeans.readCelsius();
  if (isnan(beanTemp)) {
    beansFaultCount++;
    if (beansFaultCount < kFaultDebounceThreshold) {
      return;
    }

    uint8_t e = tcBeans.readError();
    beanSensorError = SENSOR_ERR_UNKNOWN;
    if ((e & MAX31855_FAULT_OPEN) != 0) {
      beanSensorError = SENSOR_ERR_OPEN;
    } else if ((e & MAX31855_FAULT_SHORT_GND) != 0) {
      beanSensorError = SENSOR_ERR_SHORT_GND;
    } else if ((e & MAX31855_FAULT_SHORT_VCC) != 0) {
      beanSensorError = SENSOR_ERR_SHORT_VCC;
    }
    logf("Bean thermocouple fault(s) detected! %d\n", e);
    if (e & MAX31855_FAULT_OPEN) {
      log("FAULT: Bean thermocouple open - no connections.");
    }
    if (e & MAX31855_FAULT_SHORT_GND) {
      log("FAULT: Bean thermocouple short-circuited to GND.");
    }
    if (e & MAX31855_FAULT_SHORT_VCC) {
      log("FAULT: Bean thermocouple short-circuited to VCC.");
    }

    if (e == 0) {
      tcBeans.begin();
    }
    if ((e & MAX31855_FAULT_SHORT_GND) != 0 && exhaustFaultCount >= kFaultDebounceThreshold) {
      log("Both probes reporting SHORT_GND; reinitializing thermocouple bus");
      reinitializeThermocouples();
      exhaustFaultCount = 0;
      beansFaultCount = 0;
    }
    readings[1] = NAN;
    return;
  }
  beansFaultCount = 0;
  beanSensorError = SENSOR_OK;
#ifdef DEBUG
  logf("Bean Temp: %.2f\n", beanTemp);
#endif
  readings[1] = beansFilter.process(beanTemp);
}

bool getETBTReadings(float *readingsBuf) {
  if (xSemaphoreTakeRecursive(mtx, pdMS_TO_TICKS(5)) == pdTRUE) {
    memcpy(readingsBuf, readings, 3 * sizeof(float));
    bool sensorsHealthy = exhaustSensorError == SENSOR_OK && beanSensorError == SENSOR_OK;
    xSemaphoreGiveRecursive(mtx);
    return sensorsHealthy;
  }
  return false;
}

float getSimulatedInternalBeanTemp() {
  if (xSemaphoreTakeRecursive(mtx, pdMS_TO_TICKS(5)) == pdTRUE) {
    float simulated = simulatedInternalBeanTemp;
    xSemaphoreGiveRecursive(mtx);
    return simulated;
  }
  return NAN;
}

unsigned long getLastSensorUpdateMs() {
  return lastSensorUpdateMs;
}

SensorErrorCode getExhaustSensorError() { return exhaustSensorError; }
SensorErrorCode getBeanSensorError() { return beanSensorError; }
