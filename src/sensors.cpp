#include "config.h"
#include "logging.h"
#include <Adafruit_MAX31855.h>
#include <Arduino.h>
#include <SPI.h>
#include <kalman.h>

void getChipTemp() {
  // Get Ambient Temp from DS18B20
  // https://randomnerdtutorials.com/esp32-ds18b20-temperature-arduino-ide/
  float temp = temperatureRead();
  logf("Temperature: %.2f\n", temp);
}

Adafruit_MAX31855 tcExhaust(MAX1CLK, MAX1CS, MAX1DO);
Adafruit_MAX31855 tcBeans(MAX2CLK, MAX2CS, MAX2DO);

KalmanFilter exhaustFilter;
KalmanFilter beansFilter;
unsigned long lastReadTime = 0;

void takeETReadings(float dt);
void takeBTReadings(float dt);

void startSensors() {
  exhaustFilter.init();
  beansFilter.init();
  exhaustFilter.set(22.f);
  beansFilter.set(22.f);

  log("Initializing sensors");
  delay(500); // Give the sensors time to settle
  bool allGood = true;
  allGood &= tcExhaust.begin();
  allGood &= tcBeans.begin();
  logf("Sensors %s\n", allGood ? "initialized" : "failed to init");
}

void takeReadings() {
  float dt = (millis() - lastReadTime) / 1000.0;
  if (dt < 1) {
    return;
  }
  takeETReadings(dt);
  takeBTReadings(dt);
  lastReadTime = millis();
#ifdef DEBUG
  logf("Filtered Exhaust Temp: %.2f\n", exhaustFilter.get());
  logf("Filtered Bean Temp: %.2f\n", beansFilter.get());
#endif
}

void takeETReadings(float dt) {
  float exhaustTemp = tcExhaust.readCelsius();
  if (isnan(exhaustTemp)) {
    log("Thermocouple fault(s) detected!");
    uint8_t e = tcExhaust.readError();
    if (e & MAX31855_FAULT_OPEN)
      log("FAULT: Thermocouple is open - no connections.");
    if (e & MAX31855_FAULT_SHORT_GND)
      log("FAULT: Thermocouple is short-circuited to GND.");
    if (e & MAX31855_FAULT_SHORT_VCC)
      log("FAULT: Thermocouple is short-circuited to VCC.");
		return;
	}
	exhaustFilter.predict(dt);
  exhaustFilter.correct(exhaustTemp);
}

void takeBTReadings(float dt) {
  float beanTemp = tcBeans.readCelsius();
  if (isnan(beanTemp)) {
    log("Thermocouple fault(s) detected!");
    uint8_t e = tcBeans.readError();
    if (e & MAX31855_FAULT_OPEN)
      log("FAULT: Thermocouple is open - no connections.");
    if (e & MAX31855_FAULT_SHORT_GND)
      log("FAULT: Thermocouple is short-circuited to GND.");
    if (e & MAX31855_FAULT_SHORT_VCC)
      log("FAULT: Thermocouple is short-circuited to VCC.");
		return;
	}
  beansFilter.predict(dt);
  beansFilter.correct(beanTemp);
}

float *getETBTReadings() {
  float *readings = (float *)malloc(2 * sizeof(float));
  readings[0] = exhaustFilter.get();
  readings[1] = beansFilter.get();
  return readings;
}
