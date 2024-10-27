import { writable } from "svelte/store";

export const readings = writable({});
export const fanPower = writable(0);
export const heaterPower = writable(0);

export function updateFanPower(value) {
  fanPower.set(value);
  sendCommand({ FanVal: value });
}
export function updateHeaterPower(value) {
  heaterPower.set(value);
  sendCommand({ BurnerVal: value });
}
export function addEvent(value) {
  console.log("got event #{value}");
}

const isRoasting = writable(false);
let timerId;
export function startRoast(params) {
	isRoasting.set(true)
	startReadings()
	//  isRoasting.set(!isRoasting);
	//  if (isRoasting.get == false) {
	//    clearInterval(timerId);
	//    console.log("Timer stopped");
	//  } else {
	// 	startReadings();
	// }
}
export function stopRoast(params) {
	isRoasting.set(false)
	clearInterval(timerId);
}

export function resetRoast(params) {}

function sendCommand(data) {
  // WebSocket code to send updated values
}

export function startReadings() {
  timerId = setInterval(() => {
    console.log("This runs every 1 second");
  }, 1000);
}
