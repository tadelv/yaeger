#ifndef SECURITY_H
#define SECURITY_H

#include <Arduino.h>
#include <ESPAsyncWebServer.h>

const char *getApiAdminUsername();
String getApiAdminSecret();
String getApPassphrase();
bool isAuthorizedRequest(AsyncWebServerRequest *request);

#endif
