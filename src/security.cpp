#include "security.h"

#include <Preferences.h>
#include <esp_system.h>

namespace {
constexpr const char *kAdminUser = "admin";
constexpr const char *kSecretPrefsNamespace = "security";
constexpr const char *kSecretPrefsKey = "adminSecret";
constexpr const char *kDefaultSecret = "ChangeMeYaeger!";
constexpr unsigned long kAuthBackoffMs = 5000;

unsigned long authBlockedUntilMs = 0;
String csrfToken = "";

String loadOrCreateSecret() {
  Preferences prefs;
  prefs.begin(kSecretPrefsNamespace, false);

  String secret = prefs.getString(kSecretPrefsKey, "");
  if (secret.length() < 8) {
    secret = String(kDefaultSecret);
    prefs.putString(kSecretPrefsKey, secret);
  }

  prefs.end();
  return secret;
}

void ensureCsrfToken() {
  if (csrfToken.length() > 0) {
    return;
  }

  uint32_t r1 = esp_random();
  uint32_t r2 = esp_random();
  char token[17] = {0};
  snprintf(token, sizeof(token), "%08lx%08lx", (unsigned long)r1,
           (unsigned long)r2);
  csrfToken = String(token);
}
} // namespace

const char *getApiAdminUsername() { return kAdminUser; }

String getApiAdminSecret() { return loadOrCreateSecret(); }

String getApPassphrase() {
  String secret = loadOrCreateSecret();
  if (secret.length() < 8) {
    return String("yaeger-setup");
  }

  return secret;
}

String getCsrfToken() {
  ensureCsrfToken();
  return csrfToken;
}

bool isAuthorizedRequest(AsyncWebServerRequest *request) {
  unsigned long now = millis();
  if (authBlockedUntilMs > now) {
    request->send(429, "application/json",
                  "{\"error\":\"auth temporarily rate-limited\"}");
    return false;
  }

  String secret = loadOrCreateSecret();
  if (request->authenticate(kAdminUser, secret.c_str())) {
    return true;
  }

  authBlockedUntilMs = now + kAuthBackoffMs;
  request->requestAuthentication();
  return false;
}

bool hasValidCsrfHeader(AsyncWebServerRequest *request) {
  ensureCsrfToken();
  if (!request->hasHeader("X-Yaeger-CSRF")) {
    return false;
  }

  AsyncWebHeader *csrfHeader = request->getHeader("X-Yaeger-CSRF");
  return csrfHeader->value() == csrfToken;
}

bool isValidAdminToken(const char *token) {
  if (token == NULL) {
    return false;
  }

  String expected = loadOrCreateSecret();
  return expected.equals(token);
}
