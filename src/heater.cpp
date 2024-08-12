
#include <Arduino.h>
#include "heater.h"

#define HEATER_PIN 3

void initHeater() {
	pinMode(HEATER_PIN, OUTPUT);
	digitalWrite(HEATER_PIN, LOW);
}

static int heaterPower = 0;

void setHeaterPower(int power) {
	if (power < 0) {
		power = 0;
	} else if (power > 100) {
		power = 100;
	}
	heaterPower = power;
	Serial.printf("Heater power set to %d%%\n", power);
}

static int heaterPeriod = 2000;
// Update the heater SSR state
// where 100% is always turned on
// while 10% is on 1/10 of the time
// and the period is 1 second
// so, if the power is 10%, the heater will be on for 100 ms and off for 900 ms
void updateHeater() {
	static unsigned long lastHeaterUpdate = 0;
	if (millis() - lastHeaterUpdate >= heaterPeriod) {
		lastHeaterUpdate = millis();
		if (heaterPower == 0) {
			digitalWrite(HEATER_PIN, LOW);
		} else if (heaterPower == 100) {
			digitalWrite(HEATER_PIN, HIGH);
		} else {
			if (millis() % heaterPeriod < heaterPower * heaterPeriod / 100) {
				digitalWrite(HEATER_PIN, HIGH);
			} else {
				digitalWrite(HEATER_PIN, LOW);
			}
		}
	}
}
