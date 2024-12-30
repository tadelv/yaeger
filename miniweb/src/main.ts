import "./style.css";
import van from "vanjs-core";
import { initializeChart, updateChart } from "./chart";
import {
  YaegerMessage,
  YaegerState,
  Measurement,
  RoasterStatus,
} from "./model.ts";
import { getFormattedTimeDifference } from "./util.ts";

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
      updateFanPower(value);
      break;
    case "slider2":
      updateHeaterPower(value);
      break;
    default:
      break;
  }
};
export function updateFanPower(value: number) {
  sendCommand({ id: 1, FanVal: value });
  appendCommand("fan", value);
}
export function updateHeaterPower(value: number) {
  sendCommand({ id: 1, BurnerVal: value });
  appendCommand("heater", value);
}

function appendCommand(label: String, value: number) {
  if (state.val.currentState.status == RoasterStatus.idle) {
    return;
  }
  state.val = {
    ...state.val,
    roast: {
      ...state.val.roast,
      commands: [
        ...state.val.roast?.commands,
        ...[
          {
            type: label,
            value: value,
            timestamp: new Date(),
          },
        ],
      ],
    },
  };
}

function appendEvent(label: String) {
  if (state.val.currentState.status == RoasterStatus.idle) {
    return;
  }
  state.val = {
    ...state.val,
    roast: {
      ...state.val.roast,
      events: [
        ...state.val.roast?.events,
        ...[
          {
            label: label,
            measurement: {
              message: state.val.currentState.lastMessage,
              timestamp: state.val.currentState.lastUpdate,
            },
          },
        ],
      ],
    },
  };
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

const RoastTime = () => {
  const start = state.val.roast?.startDate ?? new Date();
  const last =
    state.val.roast!.measurements[state.val.roast!.measurements.length - 1]
      .timestamp;
  console.log("eval roast time");
  return getFormattedTimeDifference(start, last);
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
      () => (state.val.roast != undefined ? RoastTime() : "00:00"),
    ),
  ),
  div(
    span(
      button(
        {
          onclick: () => appendEvent("charge"),
        },
        "Charge",
      ),
    ),
  ),
  div(
    span("ET: ", () => {
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
          events: [],
          commands: [],
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
