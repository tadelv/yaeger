import "./style.css";
import van from "vanjs-core";
import { roastApp } from "./roast";
import { profile, ProfileControl } from "./profiling.ts";
import { PIDController } from "./pid.ts";
import { connectionStatus, lastMessage, lastUpdate } from "./websocket";

const { label, button, div, input, p, span, h1, h2 } = van.tags;

// State variables
const pidPFactor = van.state(1.0);
const pidIFactor = van.state(0.1);
const pidDFactor = van.state(0.01);

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
  } catch (error: unknown) {
    if (error instanceof Error) {
      alert(`Error: ${error.message}`);
    } else {
      alert("An unknown error occurred");
    }
  }
};

// PID Configuration
const PIDConfig = () =>
  div(
    "PID Factors",
    p(),
    "P:",
    input({
      type: "number",
      value: pidPFactor.val,
      oninput: (e: Event) => {
        pidPFactor.val = parseFloat((e.target as HTMLInputElement).value) || 0;
      },
    }),
    "I:",
    input({
      type: "number",
      value: pidIFactor.val,
      oninput: (e: Event) => {
        pidIFactor.val = parseFloat((e.target as HTMLInputElement).value) || 0;
      },
    }),
    "D:",
    input({
      type: "number",
      value: pidDFactor.val,
      oninput: (e: Event) => {
        pidDFactor.val = parseFloat((e.target as HTMLInputElement).value) || 0;
      },
    }),
  );

// Connection Status Display
const ConnectionStatus = () =>
  div(
    { class: "connection-status" },
    "Connection Status: ",
    span(
      {
        style: () =>
          `color: ${
            connectionStatus.val === "Connected"
              ? "green"
              : connectionStatus.val === "Error"
              ? "red"
              : "orange"
          }`,
      },
      () => connectionStatus.val,
    ),
  );

// Sensor Data Display
const SensorData = () =>
  div(
    { class: "sensor-data" },
    "Current Readings:",
    p(
      "ET: ",
      () => lastMessage.val?.ET ?? "N/A",
      "°C",
    ),
    p(
      "BT: ",
      () => lastMessage.val?.BT ?? "N/A",
      "°C",
    ),
    p(
      "Last update: ",
      () => lastUpdate.val?.toString() ?? "N/A",
    ),
  );

// Start page UI
const startPage = div(
  div({ class: "start-page" },
    h1("Yaeger Roaster Control"),
    ConnectionStatus,
    SensorData,
    div({ class: "section" },
      h2("Profile Selection"),
      ProfileControl,
    ),
    div({ class: "section" },
      h2("PID Settings"),
      PIDConfig,
    ),
    div({ class: "section" },
      h2("Wifi Settings"),
      p(),
      "Wifi ssid:",
      input({
        type: "text",
        oninput: (e: Event) => {
          ssidField.val = (e.target as HTMLInputElement).value;
        },
      }),
      p(),
      "Wifi pass (if any)",
      input({
        type: "password",
        oninput: (e: Event) => {
          passField.val = (e.target as HTMLInputElement).value;
        },
      }),
      p(),
      button({ onclick: updateWifiSettings }, "Update Wifi"),
    ),
    div({ class: "section" },
      button(
        {
          onclick: () => {
            // Navigate to roast page
            document.getElementById("app")!.innerHTML = "";
            van.add(document.getElementById("app")!, roastApp());
          },
        },
        "Start Roasting",
      ),
    ),
  ),
);

// Attach UI to DOM
van.add(document.getElementById("app")!, startPage);
