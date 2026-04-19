#include <ESPAsyncWebServer.h>


void setupMainLoop(AsyncWebSocket *ws);
void updateConnectionSafety(AsyncWebSocket *ws);
void updatePidControl();
void updateRoastHistory();
