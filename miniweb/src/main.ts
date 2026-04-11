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

type AppTab = "home" | "roast" | "logs" | "settings";

const { button, div, input, p, span, h1, h2 } = van.tags;

// State variables
const pidPFactor = van.state(1.0);
const pidIFactor = van.state(0.1);
const pidDFactor = van.state(0.01);

// Wifi
const ssidField = van.state("");
const passField = van.state("");
const activeTab = van.state<AppTab>("home");

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

const PIDConfig = () =>
  div(
    { class: "section" },
    h2("PID Factors"),
    div(
      { class: "form-grid" },
      p("P:"),
      input({
        type: "number",
        value: pidPFactor.val,
        oninput: (e: Event) => {
          pidPFactor.val = parseFloat((e.target as HTMLInputElement).value) || 0;
        },
      }),
      p("I:"),
      input({
        type: "number",
        value: pidIFactor.val,
        oninput: (e: Event) => {
          pidIFactor.val = parseFloat((e.target as HTMLInputElement).value) || 0;
        },
      }),
      p("D:"),
      input({
        type: "number",
        value: pidDFactor.val,
        oninput: (e: Event) => {
          pidDFactor.val = parseFloat((e.target as HTMLInputElement).value) || 0;
        },
      }),
    ),
  );

const ConnectionStatus = () =>
  div(
    { class: "connection-status" },
    "Connection Status: ",
    span(
      {
        style: () =>
          `color: ${
            connectionStatus.val === "Connected"
              ? "#059669"
              : connectionStatus.val === "Error"
                ? "#dc2626"
                : "#d97706"
          }`,
      },
      () => connectionStatus.val,
    ),
  );

const SensorData = () =>
  div(
    { class: "section" },
    h2("Current Readings"),
    p("ET: ", () => lastMessage.val?.ET ?? "N/A", "°C"),
    p("BT: ", () => lastMessage.val?.BT ?? "N/A", "°C"),
    p("Sensor sample age: ", () => lastMessage.val?.sampleAgeMs ?? "N/A", " ms"),
    p("Sensor status: ", () => (lastMessage.val?.sensorOk ? "OK" : "BUSY/STALE")),
    p("Last update: ", () => lastUpdate.val?.toString() ?? "N/A"),
  );

const VersionAndNetworkInfo = () =>
  div(
    { class: "section" },
    h2("Version & Network Info"),
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
    button({ onclick: () => void refreshDeviceInfo() }, "Refresh Info"),
  );

const HomePanel = () =>
  div(
    h1("Yaeger Roaster Control"),
    p({ class: "muted" }, "Modern command center for your roast workflow."),
    ConnectionStatus,
    SensorData,
  );

const SettingsPanel = () =>
  div(
    VersionAndNetworkInfo,
    div({ class: "section" }, h2("Profile Selection"), ProfileControl),
    PIDConfig,
    div(
      { class: "section" },
      h2("Wifi Settings"),
      div(
        { class: "form-grid" },
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
      p(),
      button({ onclick: () => void updateWifiSettings() }, "Update Wifi"),
    ),
  );

const TabsNav = () =>
  div(
    { class: "tabs-nav" },
    h2({ class: "tabs-title" }, "Yaeger"),
    button({ class: () => `tab-btn ${activeTab.val === "home" ? "active" : ""}`, onclick: () => (activeTab.val = "home") }, "Home"),
    button({ class: () => `tab-btn ${activeTab.val === "roast" ? "active" : ""}`, onclick: () => (activeTab.val = "roast") }, "Roast"),
    button({ class: () => `tab-btn ${activeTab.val === "logs" ? "active" : ""}`, onclick: () => (activeTab.val = "logs") }, "Logs"),
    button({ class: () => `tab-btn ${activeTab.val === "settings" ? "active" : ""}`, onclick: () => (activeTab.val = "settings") }, "Settings"),
  );

const appLayout = div(
  { class: "app-layout" },
  TabsNav,
  div(
    { class: "tab-content" },
    () => {
      switch (activeTab.val) {
        case "roast":
          return roastApp();
        case "logs":
          return logsApp();
        case "settings":
          return SettingsPanel();
        case "home":
        default:
          return HomePanel();
      }
    },
  ),
);

van.add(document.getElementById("app")!, appLayout);
