import "./style.css";
import van from "vanjs-core";
import { initializeChart, updateChart } from "./chart";
import {
  YaegerMessage,
  YaegerState,
  Measurement,
  RoasterStatus,
  RoastState,
} from "./model.ts";
import { getFormattedTimeDifference } from "./util.ts";
import { PIDController } from "./pid.ts";

const { button, div, input, h1, canvas, p, span } = van.tags;

// State variables
const slider1Value = van.state(50);
const slider2Value = van.state(50);
const state = van.state(new YaegerState());

const setpoint = van.state(20);
const pidPFactor = van.state(1.0);
const pidIFactor = van.state(0.1);
const pidDFactor = van.state(0.01);
var pid = new PIDController(1.0, 0.1, 0.01);

// Wifi
const ssidField = van.state("");
const passField = van.state("");

const updateWifiSettings = async () => {
  const ssid = ssidField.val;
  const pass = passField.val;

  try {
    const response = await fetch(
      `http://${location.host}/api/wifi?ssid=${encodeURIComponent(ssid)}&pass=${encodeURIComponent(pass)}`,
    );
    if (response.ok) {
      alert(
        "Wifi settings updated!\nPlease restart for the new settings to take effect",
      );
    } else {
      alert(`Something happened: ${response.status}`);
    }
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
};

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
            extra: {
              setpoint: setpoint.val,
            },
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
        controlHeater();
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
        const blob = new Blob([JSON.stringify(state.val.roast!)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = "roast.json";
        a.click();

        URL.revokeObjectURL(url);
      },
      disabled: () => shouldShowButton.val,
    },
    "Download",
  );
};

const UploadButton = () => {
  return button(
    {
      onclick: () => {
        const fileInput = document.getElementById("fileInput");
        fileInput?.click();
      },
      disabled: () => state.val.currentState.status == RoasterStatus.roasting,
    },
    "Upload",
  );
};

const RoastTime = () => {
  const start = state.val.roast?.startDate ?? new Date();
  const last =
    state.val.roast!.measurements[state.val.roast!.measurements.length - 1]
      .timestamp;
  return getFormattedTimeDifference(start, last);
};
function dateReviver(key: string, value: any): any {
  // Check if the value is a string that looks like an ISO 8601 date
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(value)
  ) {
    return new Date(value); // Convert to Date object
  }
  return value; // Otherwise, return the value as-is
}

const UploadRoastInput = () => {
  const fileInput = input({
    type: "file",
    id: "fileInput",
    accept: "application/json",
    style: "display: none;",
  });
  fileInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        console.log("reading: ", e.target.result);
        const jsonData = JSON.parse<RoastState>(e.target.result, dateReviver);
        console.log(typeof jsonData);
        console.log(jsonData as RoastState);
        state.val = {
          ...state.val,
          roast: jsonData,
        };
        updateChart(chart, state.val.roast!);
      } catch (error) {
        console.log("upload failed:", error);
      }
    };
    reader.readAsText(file);
  });

  return div(fileInput);
};

// Update setpoint through a slider or input
const SetpointControl = () =>
  div(
    "Setpoint (°C): ",
    () => setpoint.val,
    input({
      type: "range",
      min: "0",
      max: "300",
      value: setpoint,
      oninput: (e: Event) => {
        setpoint.val = parseInt((e.target as HTMLInputElement).value, 10);
      },
    }),
  );
let tempP = pidPFactor.val;
let tempI = pidIFactor.val;
let tempD = pidDFactor.val;
const PIDConfig = () =>
  div(
    "PID Factors",
    p(),
    "P:",
    input({
      type: "number",
      value: tempP,
      oninput: (e: Event) => {
        tempP = parseFloat((e.target as HTMLInputElement).value) || 0;
      },
    }),
    "I:",
    input({
      type: "number",
      value: tempI,
      oninput: (e: Event) => {
        tempI = parseFloat((e.target as HTMLInputElement).value) || 0;
      },
    }),
    "D:",
    input({
      type: "number",
      value: tempD,
      oninput: (e: Event) => {
        tempD = parseFloat((e.target as HTMLInputElement).value) || 0;
      },
    }),
    p(),
    button(
      {
        onclick: () => {
          pidPFactor.val = tempP;
          pidIFactor.val = tempI;
          pidDFactor.val = tempD;

          pid = new PIDController(
            pidPFactor.val,
            pidIFactor.val,
            pidDFactor.val,
          );
          console.log("New PID values set:", {
            P: pidPFactor.val,
            I: pidIFactor.val,
            D: pidDFactor.val,
          });
          console.log("PID:", JSON.stringify(pid));
        },
      },
      "Apply pid",
    ),
  );

function controlHeater() {
  const currentTemp = state.val.currentState.lastMessage?.BT ?? 0;

  const output = pid.compute(setpoint.val, currentTemp);

  // Clamp output to 0–100% range
  const heaterPower = Math.min(100, Math.max(0, Math.round(output)));

  updateHeaterPower(heaterPower);
  slider2Value.val = heaterPower; // Reflect change in the UI
}

// UI creation
const app = div(
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
      UploadButton,
      "Roast time: ",
      () => (state.val.roast != undefined ? RoastTime() : "00:00"),
    ),
  ),
  chartElement,
  SetpointControl,
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
          onclick: () => appendEvent("charge"),
        },
        "Charge",
      ),
      button(
        {
          onclick: () => appendEvent("dry-end"),
        },
        "Dry End",
      ),
      button(
        {
          onclick: () => appendEvent("first-crack-start"),
        },
        "First crack start",
      ),
      button(
        {
          onclick: () => appendEvent("first-crack-end"),
        },
        "First crack end",
      ),
      button(
        {
          onclick: () => appendEvent("second-crack start"),
        },
        "Second crack start",
      ),
      button(
        {
          onclick: () => appendEvent("second-crack-end"),
        },
        "Second crack end",
      ),
      button(
        {
          onclick: () => appendEvent("drop"),
        },
        "Drop",
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
  UploadRoastInput,
  p(),
  PIDConfig,
  p(),
  div(
    "Wifi settings:",
    p(),
    "Wifi ssid:",
    input({
      type: "text",
      oninput: (e: Event) => {
        ssidField.val = e.target.value;
      },
    }),
    p(),
    "Wifi pass (if any)",
    input({
      type: "password",
      oninput: (e: Event) => {
        passField.val = e.target.value;
      },
    }),
    p(),
    button({ onclick: updateWifiSettings }, "Update"),
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
