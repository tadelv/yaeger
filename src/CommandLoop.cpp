#include "fan.h"
#include "heater.h"
#include "logging.h"
#include "sensors.h"
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>
#include <cmath>
#include <cstring>

void onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
               AwsEventType type, void *arg, uint8_t *data, size_t len) {

  switch (type) {
  case WS_EVT_CONNECT:
    logf("[%u] Connected!\n", client->id());
    // client->text("Connected");

    break;
  case WS_EVT_DISCONNECT: {
    logf("[%u] Disconnected!\n", client->id());
    // turn off heater and set fan to 100%
    setHeaterPower(0);
    setFanSpeed(100);
  } break;
  case WS_EVT_DATA: {

    AwsFrameInfo *info = (AwsFrameInfo *)arg;
#ifdef DEBUG
    logf("ws[%s][%u] %s-message[%llu]: ", server->url(), client->id(),
         (info->opcode == WS_TEXT) ? "text" : "binary", info->len);
    logf("final: %d\n", info->final);
#endif
    String msg = "";
    /*if (info->opcode != WS_TEXT || !info->final) {*/
    /*  break;*/
    /*}*/

    for (size_t i = 0; i < info->len; i++) {
      msg += (char)data[i];
    }
#ifdef DEBUG
    logf("msg: %s\n", msg.c_str());
#endif

    const size_t capacity = JSON_OBJECT_SIZE(3) + 60; // Memory pool
    DynamicJsonDocument doc(capacity);

    // DEBUG WEBSOCKET
    // logf("[%u] get Text: %s\n", num, payload);

    // Extract Values lt. https://arduinojson.org/v6/example/http-client/
    // Artisan Anleitung: https://artisan-scope.org/devices/websockets/

    deserializeJson(doc, msg);

    long ln_id = doc["id"].as<long>();
    // Get BurnerVal from Artisan over Websocket
    if (!doc["BurnerVal"].isNull()) {
      long val = doc["BurnerVal"].as<long>();
      logf("BurnerVal: %d\n", val);
      // DimmerVal = doc["BurnerVal"].as<long>();
      setHeaterPower(val);
    }
    if (!doc["FanVal"].isNull()) {
      long val = doc["FanVal"].as<long>();
      logf("FanVal: %d\n", val);
      setFanSpeed(val);
    }

    // Send Values to Artisan over Websocket
    const char *command = doc["command"].as<const char *>();
    if (command != NULL && strncmp(command, "getData", 7) == 0) {
      JsonObject root = doc.to<JsonObject>();
      JsonObject data = root.createNestedObject("data");
      root["id"] = ln_id;
      float etbt[3];
      getETBTReadings(etbt);
      data["ET"] = etbt[0]; // Med_ExhaustTemp.getMedian()
      data["BT"] = etbt[1]; // Med_BeanTemp.getMedian();
      data["Amb"] = etbt[2];
      data["BurnerVal"] = getHeaterPower(); // float(DimmerVal);
      data["FanVal"] = getFanSpeed();
    }

    char buffer[200];                        // create temp buffer
    size_t len = serializeJson(doc, buffer); // serialize to buffer
    // DEBUG WEBSOCKET
    log(buffer);

    client->text(buffer);
    // send message to client
    // webSocket.sendTXT(num, "message here");

    // send data to all connected clients
    // webSocket.broadcastTXT("message here");
  } break;
  default: // send message to client
    logf("unhandled message type: %d\n", type);
    // webSocket.sendBIN(num, payload, length);
    break;
  }
}

void setupMainLoop(AsyncWebSocket *ws) { ws->onEvent(onWsEvent); }
