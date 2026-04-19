#include "logging.h"
#include "config.h"
#if ENABLE_WEBSERIAL_LOGGING
#include <WebSerial.h>
#endif

namespace {
constexpr size_t kLogBufferMaxChars = 32768;
String gLogBuffer;

void appendToLogBuffer(const char *message) {
  if (message == nullptr) {
    return;
  }

  gLogBuffer += message;
  gLogBuffer += "\n";

  if (gLogBuffer.length() > kLogBufferMaxChars) {
    size_t removeCount = gLogBuffer.length() - kLogBufferMaxChars;
    gLogBuffer.remove(0, removeCount);
  }
}
}

void recvMsg(uint8_t *data, size_t len){
#if ENABLE_WEBSERIAL_LOGGING
  String d = "";
  for(int i = 0; i < len; i++){
    d += char(data[i]);
  }
  WebSerial.println("Received Data...");
  WebSerial.println(d);
#else
  (void)data;
  (void)len;
#endif
}

void setupLogging(AsyncWebServer *server) {
#if ENABLE_WEBSERIAL_LOGGING
	WebSerial.begin(server);
  WebSerial.onMessage(recvMsg);
#else
  (void)server;
#endif
}

void log(const char *message) {
  Serial.println(message);
  appendToLogBuffer(message);
  #if ENABLE_WEBSERIAL_LOGGING
	  WebSerial.println(message);
  #endif
}

void logf(const char *format, ...) {
	char buf[256];
	va_list args;
	va_start(args, format);
	vsnprintf(buf, sizeof(buf), format, args);
	va_end(args);
  #if ENABLE_WEBSERIAL_LOGGING
	  WebSerial.print(buf);
  #endif
	Serial.print(buf);
  appendToLogBuffer(buf);
}

String getLogBuffer() { return gLogBuffer; }

void clearLogBuffer() { gLogBuffer = ""; }

void appendExternalLog(const String &message) { appendToLogBuffer(message.c_str()); }
