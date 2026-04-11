#include "FreeRTOS.h"
#include "config.h"
#include "freertos/portmacro.h"
#include "freertos/semphr.h"
#include "logging.h"
#include "sensors.h"
#include <Adafruit_MAX31855.h>
#include <NexgenFilter.h>
#include <SPI.h>
#include <MovingAverageFilter.h>
#include <cstdint>

void getChipTemp() {
  // Get Ambient Temp from DS18B20
  // https://randomnerdtutorials.com/esp32-ds18b20-temperature-arduino-ide/
  float temp = temperatureRead();
  logf("Temperature: %.2f\n", temp);
}

Adafruit_MAX31855 tcExhaust(MAX1CLK, MAX1CS, MAX1DO);
Adafruit_MAX31855 tcBeans(MAX2CLK, MAX2CS, MAX2DO);

const uint8_t kMovingAverageWindowSize = 10;
const unsigned long kSamplingWindowDurationMs = 400;
const uint8_t kFaultDebounceThreshold = 3;

MovingAverageFilter exhaustFilter(kMovingAverageWindowSize);
MovingAverageFilter beansFilter(kMovingAverageWindowSize);
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
    xSemaphoreGiveRecursive(mtx);
    return true;
  }
  return false;
}

unsigned long getLastSensorUpdateMs() {
  return lastSensorUpdateMs;
}

SensorErrorCode getExhaustSensorError() { return exhaustSensorError; }
SensorErrorCode getBeanSensorError() { return beanSensorError; }
