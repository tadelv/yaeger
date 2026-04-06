#ifndef SECURITY_H
#define SECURITY_H

#include <Arduino.h>
#include <ESPAsyncWebServer.h>

const char *getApiAdminUsername();
String getApiAdminSecret();
String getApPassphrase();
String getCsrfToken();

bool isAuthorizedRequest(AsyncWebServerRequest *request);
bool hasValidCsrfHeader(AsyncWebServerRequest *request);
bool isValidAdminToken(const char *token);

#endif
