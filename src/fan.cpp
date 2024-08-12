#include <Arduino.h>
#include "fan.h"

#define FAN_PIN 8

// Initialize the fan
// This function should be called in the setup function
void initFan() {
	pinMode(FAN_PIN, OUTPUT);
	digitalWrite(FAN_PIN, LOW);
}

// set the fan speed
// speed: the speed of the fan, from 0 to 100
// 0 means the fan is off, 100 means the fan is at full speed
void setFanSpeed(int speed) {
	if (speed < 0) {
		speed = 0;
	} else if (speed > 100) {
		speed = 100;
	}
	/*analogWrite(FAN_PIN, speed * 255 / 100);*/
	digitalWrite(FAN_PIN, speed > 0 ? HIGH : LOW);
	Serial.printf("Fan speed set to %d%%\n", speed);
}
