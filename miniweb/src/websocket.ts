import { useEffect, useState } from "preact/hooks";
import { YaegerMessage } from "./model.ts";

type Listener = () => void;

type SocketState = {
  connectionStatus: "Disconnected" | "Connected" | "Error";
  lastMessage: YaegerMessage | null;
  lastData: Record<string, unknown> | null;
  lastUpdate: Date | null;
};

const WS_PATH = "/ws";
const DATA_REQUEST_INTERVAL_MS = 1000;
const RECONNECT_DELAY_MS = 2000;

const listeners = new Set<Listener>();
const socketState: SocketState = {
  connectionStatus: "Disconnected",
  lastMessage: null,
  lastData: null,
  lastUpdate: null,
};

let socket: WebSocket | null = null;
let requestTimerId: number | null = null;
let reconnectTimerId: number | null = null;

function emit() {
  listeners.forEach((listener) => listener());
}

function setState(next: Partial<SocketState>) {
  Object.assign(socketState, next);
  emit();
}

function stopPolling() {
  if (requestTimerId != null) {
    window.clearInterval(requestTimerId);
    requestTimerId = null;
  }
}

function scheduleReconnect() {
  if (reconnectTimerId != null) return;

  reconnectTimerId = window.setTimeout(() => {
    reconnectTimerId = null;
    connectWebSocket();
  }, RECONNECT_DELAY_MS);
}

function sendGetData() {
  if (socket?.readyState !== WebSocket.OPEN) return;

  socket.send(JSON.stringify({ id: 1, command: "getData" }));
}

function handleMessage(event: MessageEvent) {
  try {
    const parsed = JSON.parse(event.data);
    const data: Record<string, unknown> | undefined = parsed.data;
    if (data) {
      const next: Partial<SocketState> = { lastData: data };
      if (data.type === "status") {
        next.lastMessage = data as YaegerMessage;
        next.lastUpdate = new Date();
      }
      setState(next);
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
    setState({ connectionStatus: "Connected" });
    sendGetData();
    requestTimerId = window.setInterval(sendGetData, DATA_REQUEST_INTERVAL_MS);
  };

  socket.onmessage = handleMessage;

  socket.onclose = () => {
    setState({ connectionStatus: "Disconnected" });
    stopPolling();
    scheduleReconnect();
  };

  socket.onerror = (error) => {
    console.error("WebSocket error:", error);
    setState({ connectionStatus: "Error" });
    stopPolling();
    socket?.close();
  };
}

connectWebSocket();

export function sendWsCommand(data: Record<string, unknown>) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return false;
  }
  socket.send(JSON.stringify(data));
  return true;
}

export function subscribeSocket(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSocketState() {
  const [, forceRender] = useState(0);

  useEffect(() => subscribeSocket(() => forceRender((v) => v + 1)), []);
  return socketState;
}
