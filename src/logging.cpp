#include "logging.h"
#include <WebSerial.h>

namespace {
constexpr bool kEnableWebSerialLogging = false;
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
}
