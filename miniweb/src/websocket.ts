import van from "vanjs-core";
import { YaegerMessage } from "./model.ts";

export const connectionStatus = van.state("Disconnected");
export const lastMessage = van.state<YaegerMessage | null>(null);
export const lastUpdate = van.state<Date | null>(null);

const WS_PATH = "/ws";
const DATA_REQUEST_INTERVAL_MS = 1000;
const RECONNECT_DELAY_MS = 2000;

let socket: WebSocket | null = null;
let requestTimerId: number | null = null;
let reconnectTimerId: number | null = null;

function stopPolling() {
  if (requestTimerId != null) {
    window.clearInterval(requestTimerId);
    requestTimerId = null;
  }
}

function scheduleReconnect() {
  if (reconnectTimerId != null) {
    return;
  }

  reconnectTimerId = window.setTimeout(() => {
    reconnectTimerId = null;
    connectWebSocket();
  }, RECONNECT_DELAY_MS);
}

function sendGetData() {
  if (socket?.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(
    JSON.stringify({
      id: 1,
      command: "getData",
    }),
  );
}

function handleMessage(event: MessageEvent) {
  try {
    const parsed = JSON.parse(event.data);
    const message: YaegerMessage | undefined = parsed.data;

    if (message) {
      lastMessage.val = message;
      lastUpdate.val = new Date();
    }
  } catch (error) {
    console.error("Error parsing WebSocket message:", error);
  }
}

function connectWebSocket() {
  stopPolling();

  const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${wsProtocol}://${location.host}${WS_PATH}`);

  socket.onopen = () => {
    connectionStatus.val = "Connected";
    sendGetData();
    requestTimerId = window.setInterval(sendGetData, DATA_REQUEST_INTERVAL_MS);
  };

  socket.onmessage = handleMessage;

  socket.onclose = () => {
    connectionStatus.val = "Disconnected";
    stopPolling();
    scheduleReconnect();
  };

  socket.onerror = (error) => {
    console.error("WebSocket error:", error);
    connectionStatus.val = "Error";
    stopPolling();
    socket?.close();
  };
}

connectWebSocket();

export { socket };
