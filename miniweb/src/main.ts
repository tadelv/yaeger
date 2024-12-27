import "./style.css";
import van from "vanjs-core";
import { initializeChart, updateChart } from "./chart";
import {
  YaegerMessage,
  YaegerState,
  Measurement,
  RoasterStatus,
} from "./model.ts";

const { button, div, input, h1, canvas, p, span } = van.tags;

// State variables
const slider1Value = van.state(50);
const slider2Value = van.state(50);
const state = van.state(new YaegerState());

// Initialize WebSocket
const socket = new WebSocket("ws://" + location.host + "/ws");

socket.onopen = () => {
  console.log("WebSocket connection established");
  startPeriodicWebSocketMessages(1000);
};
socket.onclose = () => console.log("WebSocket connection closed");
socket.onerror = (error) => console.error("WebSocket error:", error);

// Chart.js setup
const chartElement = canvas({ id: "liveChart" });
const ctx = chartElement.getContext("2d") as CanvasRenderingContext2D;

const chart = initializeChart(ctx);

// WebSocket message handling
socket.onmessage = (event) => {
  try {
    console.log(event.data);
    const data = JSON.parse(event.data);
    const message: YaegerMessage = data.data;
    if (message != undefined) {
      slider1Value.val = message.FanVal;
      slider2Value.val = message.BurnerVal;
      const timestamp = new Date();
      state.val = {
        ...state.val,
        currentState: {
          ...state.val.currentState,
          lastMessage: message,
          lastUpdate: timestamp,
        },
      };
      if (
        state.val.roast != null &&
        state.val.currentState.status == RoasterStatus.roasting
      ) {
        const newMeasurement: [Measurement] = [
          {
            timestamp: timestamp,
            message: message,
          },
        ];
        state.val = {
          ...state.val,
          roast: {
            ...state.val.roast,
            measurements: [...state.val.roast?.measurements, ...newMeasurement],
          },
        };
        updateChart(chart, state.val.roast!);
      }
      console.log(state.val);
    }
  } catch (error) {
    console.error("Error parsing WebSocket message:", error);
  }
};

// Slider change handler
const onSliderChange = (slider: string, value: number) => {
  console.log("slider: ", JSON.stringify({ slider, value }));
  switch (slider) {
    case "slider1":
      console.log("fan");
      updateFanPower(value);
      break;
    case "slider2":
      console.log("heat");
      updateHeaterPower(value);
      break;
    default:
      break;
  }
};
export function updateFanPower(value: number) {
  console.log("updateFanPower", value);
  sendCommand({ id: 1, FanVal: value });
}
export function updateHeaterPower(value: number) {
  sendCommand({ id: 1, BurnerVal: value });
}

function sendCommand(data: any) {
  // WebSocket code to send updated values
  let msg = JSON.stringify(data);
  console.log("sending command: ", msg);
  socket?.send(msg);
}

var DownloadButton = () => {
  const shouldShowButton = van.derive(() => {
    const c =
      state.val.currentState.status == RoasterStatus.idle &&
      (state.val.roast?.measurements.length ?? 0) > 0;
    console.log("c: ", c);
    return !c;
  });
  return button(
    {
      onclick: () => {
        console.log("download");
      },
      disabled: () => shouldShowButton.val,
    },
    "Download",
  );
};

// UI creation
const app = div(
  chartElement,
  div(
    "FAN 1:",
		() => slider1Value.val,
		"%",
    input({
      type: "range",
      min: "0",
      max: "100",
      value: slider1Value,
      oninput: (e: Event) => {
        const target = e.target as HTMLInputElement;
        slider1Value.val = parseInt(target.value, 10);
        onSliderChange("slider1", slider1Value.val);
      },
    }),
  ),
  div(
    "HEATER:",
		() => slider2Value.val,
		"%",
    input({
      type: "range",
      min: "0",
      max: "100",
      value: slider2Value,
      oninput: (e: Event) => {
        const target = e.target as HTMLInputElement;
        slider2Value.val = parseInt(target.value, 10);
        onSliderChange("slider2", slider2Value.val);
      },
    }),
  ),
  div(
    span(
      button(
        {
          onclick: () => toggleRoastStart(),
        },
        () =>
          state.val.currentState.status == RoasterStatus.idle
            ? "Start"
            : "Stop",
      ),
      DownloadButton,
			"Roast time: ",
    ),
  ),
  div(
    span("ET: ", () => {
      console.log("upd");
      return state.val.currentState.lastMessage?.ET ?? "N/A";
    }),
    p(),
    span("BT: ", () => state.val.currentState.lastMessage?.BT ?? "N/A"),
    p(),
    "Last update: ",
    p(() => state.val.currentState.lastUpdate?.toString() ?? "N/A"),
  ),
);

function toggleRoastStart() {
  switch (state.val.currentState.status) {
    case RoasterStatus.idle:
      state.val = {
        ...state.val,
        currentState: {
          ...state.val.currentState,
          status: RoasterStatus.roasting,
        },
        roast: {
          startDate: new Date(),
          measurements: [],
        },
      };
      break;
    case RoasterStatus.roasting:
      state.val = {
        ...state.val,
        currentState: {
          ...state.val.currentState,
          status: RoasterStatus.idle,
        },
      };
      break;
  }
}

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
      clearInterval(timerId);
      console.log("Timer stopped due to WebSocket closure.");
    };
  } else {
    console.warn("WebSocket is not open. Timer will not start.");
  }
}
// Attach UI to DOM
van.add(document.getElementById("app") as HTMLElement, app);
