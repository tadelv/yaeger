
#include <Arduino.h>
#include "heater.h"
#include "config.h"
#include "logging.h"

void initHeater() {
	pinMode(HEATER_PIN, OUTPUT);
	digitalWrite(HEATER_PIN, LOW);
}

static int heaterPower = 0;
// Refresh period in milliseconds
const unsigned long refreshPeriod = 1000; // 1 second (1000 milliseconds)

// Variables to keep track of time
unsigned long previousMillis = 0;
unsigned long onTime = 0;
bool isSSROn = false;

void setHeaterPower(int power) {
	if (power < 0) {
		power = 0;
	} else if (power > 80) {
		power = 80; // don't go over 80% for safety
	}
	heaterPower = power;
	logf("Heater power set to %d%%\n", power);
	onTime = (refreshPeriod * heaterPower) / 100;
}

// Update the heater SSR state
// where 100% is always turned on
// while 10% is on 1/10 of the time
// and the period is 1 second
// so, if the power is 10%, the heater will be on for 100 ms and off for 900 ms
void updateHeater() {
unsigned long currentMillis = millis();

  // Check if the refresh period has passed
  if (currentMillis - previousMillis >= refreshPeriod) {
    // Save the last time the cycle started
    previousMillis = currentMillis;

    // Toggle the SSR state based on power percentage
    if (heaterPower > 0) {
      isSSROn = true;
    } else {
      isSSROn = false;
    }
  }

  // Handle SSR on-time
  if (isSSROn && (currentMillis - previousMillis <= onTime)) {
    digitalWrite(HEATER_PIN, HIGH); // Turn SSR on
  } else {
    digitalWrite(HEATER_PIN, LOW); // Turn SSR off
    isSSROn = false; // Ensure it's off if past onTime
  }
}

int getHeaterPower() {
	return heaterPower;
}
