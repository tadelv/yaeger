import { writable, get } from "svelte/store";

export const readings = writable([]);
export const fanPower = writable(0);
export const heaterPower = writable(0);
export const roastStart = writable(0);

export function updateFanPower(value) {
  fanPower.set(value);
  sendCommand({ FanVal: value });
}
export function updateHeaterPower(value) {
  heaterPower.set(value);
  sendCommand({ BurnerVal: value });
}
export function addEvent(value) {
  console.log(`got event ${value}`);
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
}

export function resetRoast(params) {
	readings.set([])
}

function sendCommand(data) {
  // WebSocket code to send updated values
}

function startReadings() {
  timerId = setInterval(() => {
    readings.update((val) => {
      val.push({
        et: 20,
        bt: 30,
        fanVal: get(fanPower),
        heaterVal: get(heaterPower),
      });
			return val;
    });
  }, 1000);
}
