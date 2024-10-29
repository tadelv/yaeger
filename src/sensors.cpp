#include "FreeRTOS.h"
#include "config.h"
#include "freertos/portmacro.h"
#include "freertos/semphr.h"
#include "logging.h"
#include <Adafruit_MAX31855.h>
#include <NexgenFilter.h>
#include <SPI.h>

void getChipTemp() {
  // Get Ambient Temp from DS18B20
  // https://randomnerdtutorials.com/esp32-ds18b20-temperature-arduino-ide/
  float temp = temperatureRead();
  logf("Temperature: %.2f\n", temp);
}

Adafruit_MAX31855 tcExhaust(MAX1CLK, MAX1CS, MAX1DO);
Adafruit_MAX31855 tcBeans(MAX2CLK, MAX2CS, MAX2DO);

SimpleKalmanFilter exhaustFilter(80, 80, 3);
SimpleKalmanFilter beansFilter(80, 80, 3);
unsigned long lastReadTime = 0;

SemaphoreHandle_t mtx;
StaticSemaphore_t mtx_buffer;

float readings[3] = {0, 0, 0};

void takeETReadings(float dt);
void takeBTReadings(float dt);

void startSensors() {
  log("Initializing sensors");
  mtx = xSemaphoreCreateRecursiveMutexStatic(&mtx_buffer);
  if (mtx == NULL) {
    log("could not create mutex");
  }
  delay(500); // Give the sensors time to settle
  bool allGood = true;
  allGood &= tcExhaust.begin();
  allGood &= tcBeans.begin();
  logf("Sensors %s\n", allGood ? "initialized" : "failed to init");
}

void takeReadings() {
  float dt = (millis() - lastReadTime);
  if (dt < 500) {
    return;
  }
  if (xSemaphoreTakeRecursive(mtx, portMAX_DELAY) == pdTRUE) {
    takeETReadings(dt);
    takeBTReadings(dt);
    lastReadTime = millis();
    float internal = tcExhaust.readInternal();
    logf("internal: %.2f\n", internal);
    readings[2] = internal;
    xSemaphoreGiveRecursive(mtx);
  }
}

void takeETReadings(float dt) {
  float exhaustTemp = tcExhaust.readCelsius();
  if (isnan(exhaustTemp)) {
    uint8_t e = tcExhaust.readError();
    logf("Thermocouple fault(s) detected! %d", e);
    if (e & MAX31855_FAULT_OPEN)
      log("FAULT: Thermocouple is open - no connections.");
    if (e & MAX31855_FAULT_SHORT_GND)
      log("FAULT: Thermocouple is short-circuited to GND.");
    if (e & MAX31855_FAULT_SHORT_VCC)
      log("FAULT: Thermocouple is short-circuited to VCC.");
    return;
  }
  logf("Exhaust Temp: %.2f\n", exhaustTemp);
  readings[0] = exhaustFilter.updateEstimate(exhaustTemp);
}

void takeBTReadings(float dt) {
  float beanTemp = tcBeans.readCelsius();
  if (isnan(beanTemp)) {
    uint8_t e = tcBeans.readError();
    logf("Thermocouple fault(s) detected! %d", e);
    if (e & MAX31855_FAULT_OPEN)
      log("FAULT: Thermocouple is open - no connections.");
    if (e & MAX31855_FAULT_SHORT_GND)
      log("FAULT: Thermocouple is short-circuited to GND.");
    if (e & MAX31855_FAULT_SHORT_VCC)
      log("FAULT: Thermocouple is short-circuited to VCC.");
    return;
  }
  logf("Bean Temp: %.2f\n", beanTemp);
  readings[1] = beansFilter.updateEstimate(beanTemp);
}

void getETBTReadings(float *readingsBuf) {
  if (xSemaphoreTakeRecursive(mtx, portMAX_DELAY) == pdTRUE) {
    memcpy(readingsBuf, readings, 3 * sizeof(float));
    xSemaphoreGiveRecursive(mtx);
  }
}
