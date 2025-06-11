import van from "vanjs-core";
import { YaegerMessage } from "./model.ts";

// State variables
export const connectionStatus = van.state("Disconnected");
export const lastMessage = van.state<YaegerMessage | null>(null);
export const lastUpdate = van.state<Date | null>(null);

// Initialize WebSocket
export const socket = new WebSocket("ws://" + location.host + "/ws");

// WebSocket message handling
socket.onmessage = (event) => {
  console.log("WebSocket message received:", event.data);
  try {
    const data = JSON.parse(event.data);
    const message: YaegerMessage = data.data;
    if (message != undefined) {
      lastMessage.val = message;
      lastUpdate.val = new Date();
    }
  } catch (error) {
    console.error("Error parsing WebSocket message:", error);
  }
};

socket.onopen = () => {
  console.log("WebSocket connection established");
  connectionStatus.val = "Connected";
  startPeriodicWebSocketMessages(1000);
};

function startPeriodicWebSocketMessages(interval: number) {
  if (socket.readyState === WebSocket.OPEN) {
    const timerId = setInterval(() => {
      const cmd = JSON.stringify({
        id: 1,
        command: "getData",
      });
      socket.send(cmd);
    }, interval);

    // Clear timer on WebSocket close
    socket.onclose = () => {
      console.log("WebSocket connection closed");
      connectionStatus.val = "Disconnected";
      clearInterval(timerId);
      console.log("Timer stopped due to WebSocket closure.");
    };
    socket.onerror = (error) => {
      console.error("WebSocket error:", error);
      clearInterval(timerId);
      connectionStatus.val = "Error";
    };
  } else {
    console.warn("WebSocket is not open. Timer will not start.");
  }
} 
