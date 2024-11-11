import { writable, get } from "svelte/store";

export const readings = writable([]);
export const fanPower = writable(Number(0));
export const heaterPower = writable(0);
export const roastStart = writable(0);
export const events = writable([]);
export const messageStore = writable([]);

export function updateFanPower(value) {
	console.log('updateFanPower', value)
  fanPower.set(value);
  sendCommand({ id: 1, FanVal: value });
}
export function updateHeaterPower(value) {
  heaterPower.set(value);
  sendCommand({ id: 1, BurnerVal: value });
}
export function addEvent(value) {
  console.log(`got event ${value}`);
  events.update((val) => {
    val.push({
      idx: get(readings).length - 1,
      label: value,
    });
    return val;
  });
}

export const isRoasting = writable(false);
let timerId;
export function startRoast(params) {
  isRoasting.set(true);
  roastStart.set(new Date().getTime() / 1000);
  startReadings();
  //  isRoasting.set(!isRoasting);
  //  if (isRoasting.get == false) {
  //    clearInterval(timerId);
  //    console.log("Timer stopped");
  //  } else {
  // 	startReadings();
  // }
}
export function stopRoast(params) {
  isRoasting.set(false);
  clearInterval(timerId);
  console.log("stopped");
}

export function resetRoast(params) {
  console.log("reseting roast");
  readings.set([]);
  events.set([]);
}

function sendCommand(data) {
  // WebSocket code to send updated values
  let msg = JSON.stringify(data);
  console.log("sending command: ", msg);
  socket?.send(msg);
}

class YaegerMessage {
  ET: Number;
  BT: Number;
  Amb: Number;
  FanVal: Number;
  BurnerVal: Number;
  id: Number;
}

let socket: WebSocket;

function startReadings() {
  console.log("startReadings");
  timerId = setInterval(() => {
    console.log("timer fire");
    const cmd = JSON.stringify({
      id: 1,
      command: "getData",
    });
    console.log("sending ", cmd);
    socket?.send(cmd);
    //readings.update((val) => {
    //  val.push({
    //    Amb: 22.4,
    //    ET: 20,
    //    BT: 30,
    //    fanVal: get(fanPower),
    //    heaterVal: get(heaterPower),
    //  });
    //  return val;
    //});
  }, 1000);
}

export function connectWebSocket() {
  socket = new WebSocket("ws://192.168.12.123/ws");

  // Listen for messages
  socket.addEventListener("message", (event) => {
    console.log("messag: ", event.data);
    try {
      const data = JSON.parse(event.data); // Parse the JSON message
      let msg = data.data as YaegerMessage;
      console.log("as ygm: ", msg);
      if (msg != undefined) {
        readings.update((readings) => [...readings, msg]);
      }
      messageStore.update((messages) => [...messages, data]); // Update the store with the new data
    } catch (error) {
      console.error("Error parsing JSON message:", error);
    }
  });

  socket.addEventListener("open", () => {
    console.log("WebSocket connection established");
  });

  socket.addEventListener("close", () => {
    console.log("WebSocket connection closed");
  });

  socket.addEventListener("error", (error) => {
    console.error("WebSocket error:", error);
  });
  return socket;
}
