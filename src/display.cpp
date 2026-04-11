
#include "config.h"
#include "sensors.h"
#include <LiquidCrystal_I2C.h>
#include <WiFi.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);
void initDisplay() { lcd.init(DISPLAY_DA, DISPLAY_CL); }

const char *sensorErrToShortText(SensorErrorCode error) {
  switch (error) {
  case SENSOR_OK:
    return "OK";
  case SENSOR_ERR_OPEN:
    return "OPEN";
  case SENSOR_ERR_SHORT_GND:
    return "SGND";
  case SENSOR_ERR_SHORT_VCC:
    return "SVCC";
  default:
    return "ERR";
  }
}

void setWifiIP() {

  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("Yaeger online    ");
  lcd.setCursor(2, 1);
  lcd.print("IP:");
  lcd.setCursor(5, 1);
  lcd.print(WiFi.localIP());
}

void updateDisplaySensorStatus() {
  SensorErrorCode etError = getExhaustSensorError();
  SensorErrorCode btError = getBeanSensorError();
  lcd.setCursor(0, 0);
  if (etError == SENSOR_OK && btError == SENSOR_OK) {
    lcd.print("Sensors OK       ");
  } else {
    lcd.print("ET:");
    lcd.print(sensorErrToShortText(etError));
    lcd.print(" BT:");
    lcd.print(sensorErrToShortText(btError));
    lcd.print("   ");
  }
}
