import "./style.css";
import van from "vanjs-core";
import { roastApp } from "./roast";
import { logsApp } from "./logs";
import { ProfileControl } from "./profiling.ts";
import { connectionStatus, lastMessage, lastUpdate } from "./websocket";
import { getBasicAuthHeaderValue } from "./auth";

declare const __APP_VERSION__: string;
declare const __BUILD_TIMESTAMP__: string;

interface DeviceInfo {
  firmwareVersion: string;
  networkMode: string;
  ssid: string;
  ip: string;
  hostname: string;
  csrfToken?: string;
}

type DashboardTab = "overview" | "control" | "network";

const { button, div, input, p, span, h1, h2 } = van.tags;

const activeTab = van.state<DashboardTab>("overview");

// State variables
const pidPFactor = van.state(1.0);
const pidIFactor = van.state(0.1);
const pidDFactor = van.state(0.01);

// Wifi
const ssidField = van.state("");
const passField = van.state("");

// Versioning and network details
const deviceInfo = van.state<DeviceInfo | null>(null);
const deviceInfoError = van.state<string | null>(null);
const csrfToken = van.state("");

const appVersion = __APP_VERSION__;
const buildTimestamp = new Date(__BUILD_TIMESTAMP__).toLocaleString();

const refreshDeviceInfo = async () => {
  try {
    deviceInfoError.val = null;
    const response = await fetch(`http://${location.host}/api/info`);
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    deviceInfo.val = (await response.json()) as DeviceInfo;
    csrfToken.val = deviceInfo.val.csrfToken || "";
  } catch (error: unknown) {
    deviceInfo.val = null;
    if (error instanceof Error) {
      deviceInfoError.val = error.message;
    } else {
      deviceInfoError.val = "Unknown error";
    }
  }
};

void refreshDeviceInfo();

const updateWifiSettings = async () => {
  const ssid = ssidField.val;
  const pass = passField.val;

  try {
    const response = await fetch(`http://${location.host}/api/wifi`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: getBasicAuthHeaderValue(),
        "X-Yaeger-CSRF": csrfToken.val,
      },
      body: JSON.stringify({ ssid, pass }),
    });
    if (response.ok) {
      alert(
        "Wifi settings updated!\nPlease restart for the new settings to take effect",
      );
      await refreshDeviceInfo();
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

const navTab = (tab: DashboardTab, label: string, subtitle: string) =>
  button(
    {
      class: () =>
        activeTab.val === tab ? "sidebar-tab is-active" : "sidebar-tab",
      onclick: () => {
        activeTab.val = tab;
      },
    },
    div({ class: "sidebar-tab-title" }, label),
    div({ class: "sidebar-tab-subtitle" }, subtitle),
  );

// PID Configuration
const PIDConfig = () =>
  div(
    { class: "section" },
    h2("PID Settings"),
    div(
      { class: "settings-grid" },
      p("P Factor"),
      input({
        type: "number",
        value: pidPFactor.val,
        oninput: (e: Event) => {
          pidPFactor.val = parseFloat((e.target as HTMLInputElement).value) || 0;
        },
      }),
      p("I Factor"),
      input({
        type: "number",
        value: pidIFactor.val,
        oninput: (e: Event) => {
          pidIFactor.val = parseFloat((e.target as HTMLInputElement).value) || 0;
        },
      }),
      p("D Factor"),
      input({
        type: "number",
        value: pidDFactor.val,
        oninput: (e: Event) => {
          pidDFactor.val = parseFloat((e.target as HTMLInputElement).value) || 0;
        },
      }),
    ),
  );

// Connection Status Display
const ConnectionStatus = () =>
  div(
    { class: "section" },
    h2("Connection"),
    p(
      "Connection Status: ",
      span(
        {
          style: () =>
            `color: ${
              connectionStatus.val === "Connected"
                ? "#16a34a"
                : connectionStatus.val === "Error"
                  ? "#dc2626"
                  : "#f59e0b"
            }`,
        },
        () => connectionStatus.val,
      ),
    ),
    p("Last telemetry update: ", () => lastUpdate.val?.toString() ?? "N/A"),
  );

// Sensor Data Display
const SensorData = () =>
  div(
    { class: "section" },
    h2("Sensors"),
    p("ET: ", () => lastMessage.val?.ET ?? "N/A", "°C"),
    p("BT: ", () => lastMessage.val?.BT ?? "N/A", "°C"),
    p("Sensor sample age: ", () => lastMessage.val?.sampleAgeMs ?? "N/A", " ms"),
    p("Sensor status: ", () => (lastMessage.val?.sensorOk ? "OK" : "BUSY/STALE")),
  );

const VersionAndNetworkInfo = () =>
  div(
    { class: "section" },
    h2("Version & Network"),
    p("Web UI version: ", appVersion),
    p("Web UI build: ", buildTimestamp),
    p("Viewed via: ", location.origin),
    () =>
      deviceInfo.val
        ? div(
            p("Firmware version: ", deviceInfo.val.firmwareVersion),
            p("Network mode: ", deviceInfo.val.networkMode),
            p("SSID: ", deviceInfo.val.ssid || "N/A"),
            p("IP address: ", deviceInfo.val.ip || "N/A"),
            p("Hostname: ", deviceInfo.val.hostname || "N/A"),
          )
        : p("Device info unavailable"),
    () =>
      deviceInfoError.val
        ? p(
            { style: "color: #b91c1c;" },
            "Could not load network info: ",
            deviceInfoError.val,
          )
        : null,
    button({ onclick: refreshDeviceInfo }, "Refresh Info"),
  );

const WifiSettings = () =>
  div(
    { class: "section" },
    h2("Wifi Settings"),
    div(
      { class: "settings-grid" },
      p("Wifi SSID"),
      input({
        type: "text",
        oninput: (e: Event) => {
          ssidField.val = (e.target as HTMLInputElement).value;
        },
      }),
      p("Wifi Password"),
      input({
        type: "password",
        oninput: (e: Event) => {
          passField.val = (e.target as HTMLInputElement).value;
        },
      }),
    ),
    button({ onclick: updateWifiSettings }, "Update Wifi"),
  );

const QuickActions = () =>
  div(
    { class: "section" },
    h2("Quick Actions"),
    p("Start a roast session or inspect device logs."),
    div(
      { class: "action-row" },
      button(
        {
          onclick: () => {
            document.getElementById("app")!.innerHTML = "";
            van.add(document.getElementById("app")!, roastApp());
          },
        },
        "Start Roasting",
      ),
      button(
        {
          onclick: () => {
            document.getElementById("app")!.innerHTML = "";
            van.add(document.getElementById("app")!, logsApp());
            window.history.pushState({}, "", "/logs");
          },
        },
        "Open Logs",
      ),
    ),
  );

const DashboardPanel = () =>
  div(
    { class: "dashboard-panel" },
    () => {
      if (activeTab.val === "overview") {
        return div(ConnectionStatus, SensorData, QuickActions);
      }
      if (activeTab.val === "control") {
        return div(
          div({ class: "section" }, h2("Profile Selection"), ProfileControl),
          PIDConfig,
          QuickActions,
        );
      }

      return div(VersionAndNetworkInfo, WifiSettings);
    },
  );

// Start page UI
const startPage = div(
  { class: "app-shell" },
  div(
    { class: "sidebar" },
    h1("Yaeger"),
    p({ class: "sidebar-subtitle" }, "Roaster Control"),
    navTab("overview", "Overview", "Live status and sensors"),
    navTab("control", "Roast Controls", "Profiles and PID tuning"),
    navTab("network", "Network", "Device info and wifi"),
  ),
  div(
    { class: "content" },
    div(
      { class: "content-header" },
      h2("Control Center"),
      p("Modernized dashboard with task-focused tabs."),
    ),
    DashboardPanel,
  ),
);

// Attach UI to DOM
van.add(document.getElementById("app")!, startPage);
