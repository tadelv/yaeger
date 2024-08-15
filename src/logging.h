#include <ESPAsyncWebServer.h>

void setupLogging(AsyncWebServer *server);
void log(const char *message);
void logf(const char *format, ...);
