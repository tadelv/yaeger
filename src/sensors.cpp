#include <Adafruit_MAX31855.h>
#include <Arduino.h>
#include <SPI.h>
#include <kalman.h>

void getChipTemp() {
  // Get Ambient Temp from DS18B20
  // https://randomnerdtutorials.com/esp32-ds18b20-temperature-arduino-ide/
  float temp = temperatureRead();
  Serial.printf("Temperature: %.2f\n", temp);
}

#define MAX1DO 5
#define MAX1CS 6
#define MAX1CLK 7

#define MAX2DO 9
#define MAX2CS 10
#define MAX2CLK 11

Adafruit_MAX31855 tcExhaust(MAX1CLK, MAX1CS, MAX1DO);
Adafruit_MAX31855 tcBeans(MAX2CLK, MAX2CS, MAX2DO);

KalmanFilter exhaustFilter;
KalmanFilter beansFilter;
unsigned long lastReadTime = 0;

void startSensors() {
	exhaustFilter.init();
	beansFilter.init();
  exhaustFilter.set(22.f);
  beansFilter.set(22.f);

  Serial.println("Initializing sensors");
  delay(500); // Give the sensors time to settle
  bool allGood = true;
  allGood |= tcExhaust.begin();
  allGood |= tcBeans.begin();
  Serial.printf("Sensors %s\n", allGood ? "initialized" : "failed to init");
}

void takeReadings() {
  Serial.println("Taking readings");
  float exhaustTemp = tcExhaust.readCelsius();
  float beanTemp = tcBeans.readCelsius();
  Serial.printf("Exhaust Temp: %.2f\n", exhaustTemp);
  Serial.printf("Bean Temp: %.2f\n", beanTemp);
  float dt = (millis() - lastReadTime) / 1000.0;
  lastReadTime = millis();
  exhaustFilter.predict(dt);
  beansFilter.predict(dt);
  exhaustFilter.correct(exhaustTemp);
  beansFilter.correct(beanTemp);
  Serial.printf("Filtered Exhaust Temp: %.2f\n", exhaustFilter.get());
  Serial.printf("Filtered Bean Temp: %.2f\n", beansFilter.get());
}

float *getETBTReadings() {
  float *readings = (float *)malloc(2 * sizeof(float));
  readings[0] = exhaustFilter.get();
  readings[1] = beansFilter.get();
  return readings;
}
