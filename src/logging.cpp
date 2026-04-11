#include "logging.h"
#include <WebSerial.h>

namespace {
constexpr bool kEnableWebSerialLogging = false;
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
  if (kEnableWebSerialLogging) {
    WebSerial.println("Received Data...");
  }
	// TODO: can just map to char
  String d = "";
  for(int i=0; i < len; i++){
    d += char(data[i]);
  }
  if (kEnableWebSerialLogging) {
    WebSerial.println(d);
  }
}

void setupLogging(AsyncWebServer *server) {
	WebSerial.begin(server);
  WebSerial.onMessage(recvMsg);
}

void log(const char *message) {
	Serial.println(message);
  appendToLogBuffer(message);
  if (kEnableWebSerialLogging) {
	  WebSerial.println(message);
  }
}

void logf(const char *format, ...) {
	char buf[256];
	va_list args;
	va_start(args, format);
	vsnprintf(buf, sizeof(buf), format, args);
	va_end(args);
  if (kEnableWebSerialLogging) {
	  WebSerial.print(buf);
  }
	Serial.print(buf);
  appendToLogBuffer(buf);
}

String getLogBuffer() { return gLogBuffer; }

void clearLogBuffer() { gLogBuffer = ""; }

void appendExternalLog(const String &message) { appendToLogBuffer(message.c_str()); }
