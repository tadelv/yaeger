
#include "config.h"
#include <LiquidCrystal_I2C.h>
#include <WiFi.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);
void initDisplay() { lcd.init(DISPLAY_DA, DISPLAY_CL); }
void setWifiIP() {

  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("Yaeger online");
  lcd.setCursor(2, 1);
  lcd.print("IP:");
  lcd.setCursor(2, 4);
  lcd.print(WiFi.localIP());
}
