import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import "./style.css";
import { AutotuneApp } from "./autotune";
import { LogsApp } from "./logs";
import { UpdateApp } from "./update";
import { ProfileControl } from "./profiling";
import { RoastApp } from "./roast";
import { getAdminSecret, getBasicAuthHeaderValue } from "./auth";
import { CoffeeBeanBackground } from "./coffeeBeans";
import { sendWsCommand } from "./websocket";
import { useSocketState } from "./websocket";

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

type AppTab = "home" | "roast" | "autotune" | "logs" | "update" | "settings";

function App() {
  const { connectionStatus, lastMessage, lastUpdate } = useSocketState();
  const [pidPFactor, setPidPFactor] = useState(1.0);
  const [pidIFactor, setPidIFactor] = useState(0.1);
  const [pidDFactor, setPidDFactor] = useState(0.01);
  const [ssidField, setSsidField] = useState("");
  const [passField, setPassField] = useState("");
  const [activeTab, setActiveTab] = useState<AppTab>("home");
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [deviceInfoError, setDeviceInfoError] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState("");
  const [, setTick] = useState(0);

  const appVersion = __APP_VERSION__;
  const appVersionLabel = `V${appVersion}`;
  const buildTimestamp = new Date(__BUILD_TIMESTAMP__).toLocaleString();

  const refreshDeviceInfo = async () => {
    try {
      setDeviceInfoError(null);
      const response = await fetch(`http://${location.host}/api/info`);
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      const data = (await response.json()) as DeviceInfo;
      setDeviceInfo(data);
      setCsrfToken(data.csrfToken || "");
    } catch (error) {
      setDeviceInfo(null);
      setDeviceInfoError(error instanceof Error ? error.message : "Unknown error");
    }
  };

  useEffect(() => {
    void refreshDeviceInfo();
  }, []);

  useEffect(() => {
    if (typeof lastMessage?.pidKpActive === "number") setPidPFactor(lastMessage.pidKpActive);
    if (typeof lastMessage?.pidKiActive === "number") setPidIFactor(lastMessage.pidKiActive);
    if (typeof lastMessage?.pidKdActive === "number") setPidDFactor(lastMessage.pidKdActive);
  }, [lastMessage]);

  useEffect(() => {
    const onPidUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ kp?: number; ki?: number; kd?: number }>;
      if (typeof customEvent.detail?.kp === "number") setPidPFactor(customEvent.detail.kp);
      if (typeof customEvent.detail?.ki === "number") setPidIFactor(customEvent.detail.ki);
      if (typeof customEvent.detail?.kd === "number") setPidDFactor(customEvent.detail.kd);
    };
    window.addEventListener("pid-preferences-updated", onPidUpdated);
    return () => window.removeEventListener("pid-preferences-updated", onPidUpdated);
  }, []);

  const updateWifiSettings = async () => {
    try {
      const response = await fetch(`http://${location.host}/api/wifi`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: getBasicAuthHeaderValue(),
          "X-Yaeger-CSRF": csrfToken,
        },
        body: JSON.stringify({ ssid: ssidField, pass: passField }),
      });
      if (response.ok) {
        alert("Wifi settings updated!\nPlease restart for the new settings to take effect");
        await refreshDeviceInfo();
      } else {
        alert(`Something happened: ${response.status}`);
      }
    } catch (error) {
      alert(error instanceof Error ? `Error: ${error.message}` : "An unknown error occurred");
    }
  };

  const applyPidFromSettings = () => {
    sendWsCommand({
      id: 1,
      command: "setPreferences",
      pidKp: pidPFactor,
      pidKi: pidIFactor,
      pidKd: pidDFactor,
      authToken: getAdminSecret(),
    });
  };

  return (
    <>
      <CoffeeBeanBackground />
      <div class="app-layout">
        <div class="tabs-nav">
          <h2 class="tabs-title">Yaeger</h2>
          {(["home", "roast", "autotune", "logs", "update", "settings"] as AppTab[]).map((tab) => (
            <button class={`tab-btn ${activeTab === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
          <div class="external-links">
            <a class="ext-link" href="https://github.com/tadelv/yaeger" target="_blank" rel="noreferrer">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.3-1.2-1.6-1.2-1.6-1-.7.1-.7.1-.7 1.1.1 1.7 1.1 1.7 1.1 1 .1.7 2.6 3.3 1.8.1-.7.4-1.2.7-1.5-2.7-.3-5.5-1.4-5.5-6a4.7 4.7 0 0 1 1.2-3.2c-.1-.3-.5-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.3 11.3 0 0 1 6 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.9.1 3.2a4.7 4.7 0 0 1 1.2 3.2c0 4.7-2.8 5.7-5.5 6 .4.3.8 1 .8 2v3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" />
              </svg>
              Yaeger GitHub
            </a>
            <a class="ext-link" href="https://matthew73210.github.io/Gaggiuino-web-profiler/" target="_blank" rel="noreferrer">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm1 5v4.6l3.3 3.3-1.4 1.4L11 12V7Z" />
              </svg>
              Gaggiuino Profiler
            </a>
          </div>
        </div>
        <div class="tab-content">
          {activeTab === "home" && (
            <div>
              <h1>Yaeger Roaster Control</h1>
              <p class="muted">Modern command center for your roast workflow.</p>
              <div class="status-strip">
                Connection Status: <span>{connectionStatus}</span>
              </div>
              <div class="telemetry-grid">
                <div class="metric-card">
                  <span>ET</span>
                  <strong>{lastMessage?.ET ?? "N/A"}°C</strong>
                </div>
                <div class="metric-card">
                  <span>BT</span>
                  <strong>{lastMessage?.BT ?? "N/A"}°C</strong>
                </div>
                <div class="metric-card">
                  <span>Sim BT (core)</span>
                  <strong>{lastMessage?.simBT ?? "N/A"}°C</strong>
                </div>
                <div class="metric-card">
                  <span>Sample age</span>
                  <strong>{lastMessage?.sampleAgeMs ?? "N/A"} ms</strong>
                </div>
                <div class="metric-card">
                  <span>Sensor status</span>
                  <strong>{lastMessage?.sensorOk ? "OK" : "BUSY/STALE"}</strong>
                </div>
                <div class="metric-card">
                  <span>Last update</span>
                  <strong>{lastUpdate?.toString() ?? "N/A"}</strong>
                </div>
              </div>
            </div>
          )}

          {activeTab === "roast" && <RoastApp />}
          {activeTab === "autotune" && <AutotuneApp />}
          {activeTab === "logs" && <LogsApp />}
          {activeTab === "update" && <UpdateApp />}

          {activeTab === "settings" && (
            <div>
              <div class="section">
                <h2>Version & Network Info</h2>
                <div class="info-list">
                  <p>Web UI version: {appVersionLabel}</p>
                  <p>Web UI build: {buildTimestamp}</p>
                  <p>Viewed via: {location.origin}</p>
                </div>
                {deviceInfo ? (
                  <div class="info-list">
                    <p>Firmware version: V{deviceInfo.firmwareVersion}</p>
                    <p>Network mode: {deviceInfo.networkMode}</p>
                    <p>SSID: {deviceInfo.ssid || "N/A"}</p>
                    <p>IP address: {deviceInfo.ip || "N/A"}</p>
                    <p>Hostname: {deviceInfo.hostname || "N/A"}</p>
                  </div>
                ) : (
                  <p>Device info unavailable</p>
                )}
                {deviceInfoError ? <p style="color:#b91c1c;">Could not load network info: {deviceInfoError}</p> : null}
                <button onClick={() => void refreshDeviceInfo()}>Refresh Info</button>
              </div>
              <div class="section">
                <h2>Profile Selection</h2>
                <ProfileControl onStateChange={() => setTick((v) => v + 1)} />
              </div>
              <div class="section">
                <h2>PID Factors</h2>
                <div class="form-grid">
                  <label for="pid-p">P</label>
                  <input id="pid-p" type="number" value={pidPFactor} onInput={(e) => setPidPFactor(Number((e.target as HTMLInputElement).value) || 0)} />
                  <label for="pid-i">I</label>
                  <input id="pid-i" type="number" value={pidIFactor} onInput={(e) => setPidIFactor(Number((e.target as HTMLInputElement).value) || 0)} />
                  <label for="pid-d">D</label>
                  <input id="pid-d" type="number" value={pidDFactor} onInput={(e) => setPidDFactor(Number((e.target as HTMLInputElement).value) || 0)} />
                </div>
                <p />
                <button onClick={applyPidFromSettings}>Apply PID</button>
              </div>
              <div class="section">
                <h2>Wifi Settings</h2>
                <div class="form-grid">
                  <label for="wifi-ssid">Wi‑Fi SSID</label>
                  <input id="wifi-ssid" type="text" autoComplete="off" onInput={(e) => setSsidField((e.target as HTMLInputElement).value)} />
                  <label for="wifi-password">Wi‑Fi Password</label>
                  <input id="wifi-password" type="password" autoComplete="new-password" onInput={(e) => setPassField((e.target as HTMLInputElement).value)} />
                </div>
                <p />
                <button onClick={() => void updateWifiSettings()}>Update Wifi</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

render(<App />, document.getElementById("app")!);
