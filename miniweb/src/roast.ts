import "./style.css";
import van from "vanjs-core";
import { initializeChart, updateChart } from "./chart";
import {
  YaegerMessage,
  YaegerState,
  Measurement,
  RoasterStatus,
  RoastState,
  Profile,
} from "./model.ts";
import { getFormattedTimeDifference } from "./util.ts";
import { PIDController } from "./pid.ts";
import {
  followProfile,
  followProfileEnabled,
  profile,
  ProfileControl,
} from "./profiling.ts";
import { socket, lastMessage, lastUpdate } from "./websocket";

const { label, button, div, input, select, option, canvas, p, span } = van.tags;

// State variables
const slider1Value = van.state(50);
const slider2Value = van.state(50);
const state = van.state(new YaegerState());

const setpoint = van.state(20);
const pidPFactor = van.state(1.0);
const pidIFactor = van.state(0.1);
const pidDFactor = van.state(0.01);
var pid = new PIDController(1.0, 0.1, 0.01);

// Chart.js setup
const chartElement = canvas({ id: "liveChart" });
const ctx = chartElement.getContext("2d") as CanvasRenderingContext2D;

const chart = initializeChart(ctx);

// Add a derived state for current message
const currentMessage = van.derive(() => {
  console.log("currentMessage derived state updated:", lastMessage.val);
  return lastMessage.val;
});
const currentUpdate = van.derive(() => {
  console.log("currentUpdate derived state updated:", lastUpdate.val);
  return lastUpdate.val;
});

// Reactive effect to handle state updates from lastMessage and lastUpdate
van.derive(() => {
  console.log("Reactive effect triggered");
  const message = currentMessage.val;
  const timestamp = currentUpdate.val;
  
  console.log("Current state:", {
    message,
    timestamp,
    slider1Value: slider1Value.val,
    slider2Value: slider2Value.val,
    state: state.val
  });
  
  if (message != undefined && timestamp != null) {
    console.log("Processing new message:", message);
    
    // Update UI elements directly
    console.log("Updating sliders:", {
      fan: message.FanVal,
      heater: message.BurnerVal
    });
    slider1Value.val = message.FanVal;
    slider2Value.val = message.BurnerVal;
    
    // Create a new state object to ensure reactivity
    const newState = {
      ...state.val,
      currentState: {
        ...state.val.currentState,
        lastMessage: message,
        lastUpdate: timestamp,
      },
    };

    console.log("New state object created:", newState);

    if (
      state.val.roast != null &&
      state.val.currentState.status == RoasterStatus.roasting
    ) {
      console.log("Processing roast state update");
      const newMeasurement: [Measurement] = [
        {
          timestamp: timestamp,
          message: message,
          extra: {
            setpoint: setpoint.val,
            pidData: {
              enabled: pidEnabled.val,
              kp: pidPFactor.val,
              ki: pidIFactor.val,
              kd: pidDFactor.val,
            },
          },
        },
      ];

      // Update roast state with new measurement
      newState.roast = {
        ...state.val.roast,
        measurements: [...state.val.roast.measurements, ...newMeasurement],
      };

      console.log("Updated roast state:", newState.roast);

      // Update chart with new data
      updateChart(chart, newState.roast);

      // Check profile following
      if (
        state.val.profile != undefined &&
        followProfileEnabled.val == true
      ) {
        var profiledSetpoint = followProfile(
          state.val.profile!,
          newState.roast,
        );
        if (profiledSetpoint != undefined) {
          console.log("Updating setpoint from profile:", profiledSetpoint);
          setpoint.val = profiledSetpoint;
        }
      }
      controlHeater();
    }

    // Update state atomically
    console.log("Applying state update");
    state.val = newState;
    console.log("State updated:", state.val);
  }
});

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

function appendCommand(label: "fan" | "heater", value: number) {
  if (state.val.currentState.status == RoasterStatus.idle) {
    return;
  }
  const roast = state.val.roast;
  if (!roast) return;
  
  state.val = {
    ...state.val,
    roast: {
      ...roast,
      startDate: roast.startDate,
      commands: [
        ...(roast.commands || []),
        {
          type: label,
          value: value,
          timestamp: new Date(),
        },
      ],
    },
  };
}

function appendEvent(label: string) {
  if (state.val.currentState.status == RoasterStatus.idle) {
    return;
  }
  const roast = state.val.roast;
  if (!roast) return;

  const lastMessage = state.val.currentState.lastMessage;
  const lastUpdate = state.val.currentState.lastUpdate;
  if (!lastMessage || !lastUpdate) return;

  state.val = {
    ...state.val,
    roast: {
      ...roast,
      startDate: roast.startDate,
      events: [
        ...(roast.events || []),
        {
          label: label,
          measurement: {
            message: lastMessage,
            timestamp: lastUpdate,
          },
        },
      ],
    },
  };
}

function sendCommand(data: any) {
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
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(value)
  ) {
    return new Date(value);
  }
  return value;
}

const UploadRoastInput = () => {
  const fileInput = input({
    type: "file",
    id: "fileInput",
    accept: "application/json",
    style: "display: none;",
  });
  fileInput.addEventListener("change", (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        console.log("reading: ", e.target?.result);
        const jsonData = JSON.parse(e.target?.result as string, dateReviver);
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
      disabled: followProfileEnabled.val,
      value: setpoint,
      oninput: (e: Event) => {
        setpoint.val = parseInt((e.target as HTMLInputElement).value, 10);
      },
    }),
  );

let tempP = pidPFactor.val;
let tempI = pidIFactor.val;
let tempD = pidDFactor.val;

let tempTarget = "BT";
const pidEnabled = van.state(true);

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
    "Target:",
    select(
      {
        value: tempTarget,
        onchange: (e: Event) => {
          tempTarget = (e.target as HTMLSelectElement).value;
        },
      },
      option({ value: "BT" }, "BT"),
      option({ value: "ET" }, "ET"),
    ),
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
    label(
      input({
        type: "checkbox",
        checked: pidEnabled.val,
        oninput: (e) => (pidEnabled.val = e.target.checked),
      }),
      "PID Enabled",
    ),
  );

function controlHeater() {
  let currentTemp: number;
  if (tempTarget == "BT") {
    currentTemp = state.val.currentState.lastMessage?.BT ?? 0;
  } else {
    currentTemp = state.val.currentState.lastMessage?.ET ?? 0;
  }
  const output = pid.compute(setpoint.val, currentTemp);

  // Clamp output to 0–100% range
  const heaterPower = Math.min(100, Math.max(0, Math.round(output)));

  if (pidEnabled.val == false) {
    return;
  }
  updateHeaterPower(heaterPower);
  slider2Value.val = heaterPower; // Reflect change in the UI
}

// UI creation
const createApp = () => div(
  div(
    span(
      button(
        {
          onclick: () => toggleRoastStart(),
        },
        () => {
          console.log("Status button render:", state.val.currentState.status);
          return state.val.currentState.status == RoasterStatus.idle
            ? "Start"
            : "Stop";
        },
      ),
      DownloadButton,
      UploadButton,
      "Roast time: ",
      () => {
        console.log("Roast time render:", state.val.roast);
        return state.val.roast != undefined ? RoastTime() : "00:00";
      },
    ),
  ),
  chartElement,
  div({class: 'control_cluster'},
    SetpointControl,
    div(
      "FAN 1:",
      () => {
        console.log("Fan slider render:", slider1Value.val);
        return slider1Value.val;
      },
      "%",
      input({
        type: "range",
        min: "0",
        max: "100",
        value: () => {
          console.log("Fan slider value render:", slider1Value.val);
          return slider1Value.val;
        },
        oninput: (e: Event) => {
          const target = e.target as HTMLInputElement;
          slider1Value.val = parseInt(target.value, 10);
          onSliderChange("slider1", slider1Value.val);
        },
      }),
    ),
    div(
      "HEATER:",
      () => {
        console.log("Heater slider render:", slider2Value.val);
        return slider2Value.val;
      },
      "%",
      input({
        type: "range",
        min: "0",
        max: "100",
        disabled: () => pidEnabled.val,
        value: () => {
          console.log("Heater slider value render:", slider2Value.val);
          return slider2Value.val;
        },
        oninput: (e: Event) => {
          const target = e.target as HTMLInputElement;
          slider2Value.val = parseInt(target.value, 10);
          onSliderChange("slider2", slider2Value.val);
        },
      }),
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
    span(
      "ET: ",
      () => {
        console.log("ET render:", currentMessage.val?.ET);
        return currentMessage.val?.ET ?? "N/A";
      },
      " ",
      "BT: ",
      () => {
        console.log("BT render:", currentMessage.val?.BT);
        return currentMessage.val?.BT ?? "N/A";
      },
    ),
    " ",
    p(
      "Last update: ",
      () => {
        console.log("Last update render:", currentUpdate.val);
        return currentUpdate.val?.toString() ?? "N/A";
      },
    ),
  ),
  UploadRoastInput,
  p(),
  PIDConfig,
  p(),
  ProfileControl,
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
        profile: profile.val,
      };
      break;
    case RoasterStatus.roasting:
      state.val = {
        ...state.val,
        currentState: {
          ...state.val.currentState,
          status: RoasterStatus.idle,
        },
        roast: {
          ...state.val.roast!,
          profile: state.val.profile,
        },
      };
      break;
  }
}

// Export the app for use in main.ts
export const roastApp = createApp; 
