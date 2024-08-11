#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>

float BeanTemp = 22.2;
float exhaustTemp = 22.2;

void onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
               AwsEventType type, void *arg, uint8_t *data, size_t len) {

  switch (type) {
  case WS_EVT_CONNECT:
    Serial.printf("[%u] Connected!\n", client->id());
    // client->text("Connected");

    break;
  case WS_EVT_DISCONNECT: {
    Serial.printf("[%u] Disconnected!\n", client->id());
  } break;
  case WS_EVT_DATA: {

    AwsFrameInfo *info = (AwsFrameInfo *)arg;
    Serial.printf("ws[%s][%u] %s-message[%llu]: ", server->url(), client->id(),
                  (info->opcode == WS_TEXT) ? "text" : "binary", info->len);
    Serial.printf("final: %d\n", info->final);
    String msg = "";
    /*if (info->opcode != WS_TEXT || !info->final) {*/
    /*  break;*/
    /*}*/

    for (size_t i = 0; i < info->len; i++) {
      msg += (char)data[i];
    }
    Serial.printf("msg: %s\n", msg.c_str());
    const size_t capacity = JSON_OBJECT_SIZE(3) + 60; // Memory pool
    DynamicJsonDocument doc(capacity);

    // DEBUG WEBSOCKET
    // Serial.printf("[%u] get Text: %s\n", num, payload);

    // Extract Values lt. https://arduinojson.org/v6/example/http-client/
    // Artisan Anleitung: https://artisan-scope.org/devices/websockets/

    deserializeJson(
        doc,
        msg); // 2 Nodes einzeln (Feld: "command"): "getBT" und "getDimmerVal"
    // oder
    //  alle Nodes auf einmal (Feld: "command"): "getData"
    // char* entspricht String
    String command = doc["command"].as<const char *>();
    long ln_id = doc["id"].as<long>();
    // Get BurnerVal from Artisan over Websocket
    if (!doc["BurnerVal"].isNull()) {
      Serial.print("BurnerVal: ");
      long val = doc["BurnerVal"].as<long>();
      Serial.println(val);
      // DimmerVal = doc["BurnerVal"].as<long>();
      BeanTemp += 0.5 * val;
      exhaustTemp += 0.8 * val;
    }

    // Send Values to Artisan over Websocket
    JsonObject root = doc.to<JsonObject>();
    JsonObject data = root.createNestedObject("data");
    if (command == "getBT") {
      root["id"] = ln_id;
      data["BT"] = 22.2f; // Med_BeanTemp.getMedian();
    } else if (command == "getDimmerVal") {
      root["id"] = ln_id;
      data["DimmerVal"] = 0.2f; // float(DimmerVal);
    } else if (command == "getData") {
      root["id"] = ln_id;
      data["BT"] = BeanTemp; // Med_BeanTemp.getMedian();
      data["ET"] = exhaustTemp;
      data["DimmerVal"] = 0.2; // float(DimmerVal);
    }

    //====================================
    // DEBUG
    /*
    if(!doc["command"].isNull())
    {
      Serial.print("Command: ");
      Serial.println(doc["command"].as<char*>());
    }
    if(!doc["BurnerVal"].isNull())
    {
      Serial.print("BurnerVal: ");
      Serial.println(doc["BurnerVal"].as<long>());
      DimmerVal = doc["BurnerVal"].as<long>();
    }

    Serial.print("ID: ");
    Serial.println(doc["id"].as<long>());
    Serial.print("RoasterID: ");
    Serial.println(doc["roasterID"].as<long>());

    //==========================
    //JETZT JSON-Payload generieren und senden!!!
    //==========================

    ln_id = doc["id"].as<long>();
    JsonObject root = doc.to<JsonObject>();
    JsonObject data = root.createNestedObject("data");
    root["id"] = ln_id;
    data["BT"] = BeanTemp;
    data["Dimmer"] = float(DimmerVal);

    */
    // DEBUG
    //====================================

    char buffer[200];                        // create temp buffer
    size_t len = serializeJson(doc, buffer); // serialize to buffer

    // DEBUG WEBSOCKET
    Serial.println(buffer);

    client->text(buffer);
    // send message to client
    // webSocket.sendTXT(num, "message here");

    // send data to all connected clients
    // webSocket.broadcastTXT("message here");
  } break;
  default: // send message to client
    Serial.printf("msg: tp: %d, data: %s\n", type, data);
    // webSocket.sendBIN(num, payload, length);
    break;
  }
}

void setupMainLoop(AsyncWebSocket *ws) { ws->onEvent(onWsEvent); }
