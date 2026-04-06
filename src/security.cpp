#include "security.h"

#include "wifi_setup.h"
#include <Preferences.h>

namespace {
constexpr const char *kAdminUser = "admin";
constexpr const char *kSecretPrefsNamespace = "security";
constexpr const char *kSecretPrefsKey = "adminSecret";
constexpr const char *kDefaultSecret = "ChangeMeYaeger!";

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

bool isAuthorizedRequest(AsyncWebServerRequest *request) {
  String secret = loadOrCreateSecret();
  if (request->authenticate(kAdminUser, secret.c_str())) {
    return true;
  }

  request->requestAuthentication();
  return false;
}
