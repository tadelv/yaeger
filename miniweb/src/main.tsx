import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import "./style.css";
import { AutotuneApp } from "./autotune";
import { LogsApp } from "./logs";
import { UpdateApp } from "./update";
import { ProfileControl, profileStore } from "./profiling";
import { RoastApp } from "./roast";
import { getAdminSecret, getBasicAuthHeaderValue } from "./auth";
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
  const [pidProcessDelaySec, setPidProcessDelaySec] = useState(0);
  const [pidPredictorEnabled, setPidPredictorEnabled] = useState(true);
  const [ssidField, setSsidField] = useState("");
  const [passField, setPassField] = useState("");
  const [activeTab, setActiveTab] = useState<AppTab>("home");
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [deviceInfoError, setDeviceInfoError] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState("");
  const [, setTick] = useState(0);
  const [isEditingPid, setIsEditingPid] = useState(false);
  const hasHydratedPidFromTelemetry = useRef(false);
  const pidSyncPausedUntilMs = useRef(0);

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
    if (hasHydratedPidFromTelemetry.current) return;
    if (isEditingPid || Date.now() < pidSyncPausedUntilMs.current) return;

    let hydratedAny = false;
    if (typeof lastMessage?.pidKpActive === "number") {
      setPidPFactor(lastMessage.pidKpActive);
      hydratedAny = true;
    }
    if (typeof lastMessage?.pidKiActive === "number") {
      setPidIFactor(lastMessage.pidKiActive);
      hydratedAny = true;
    }
    if (typeof lastMessage?.pidKdActive === "number") {
      setPidDFactor(lastMessage.pidKdActive);
      hydratedAny = true;
    }
    if (typeof lastMessage?.pidProcessDelaySec === "number") {
      setPidProcessDelaySec(lastMessage.pidProcessDelaySec);
      hydratedAny = true;
    }
    if (typeof lastMessage?.pidPredictorEnabled === "boolean") {
      setPidPredictorEnabled(lastMessage.pidPredictorEnabled);
      hydratedAny = true;
    }
    if (hydratedAny) hasHydratedPidFromTelemetry.current = true;
  }, [isEditingPid, lastMessage]);

  useEffect(() => {
    const onPidUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ kp?: number; ki?: number; kd?: number; pidTarget?: "BT" | "ET" | "simBT" }>;
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
    pidSyncPausedUntilMs.current = Date.now() + 3000;
    sendWsCommand({
      id: 1,
      command: "setPreferences",
      pidKp: pidPFactor,
      pidKi: pidIFactor,
      pidKd: pidDFactor,
      authToken: getAdminSecret(),
    });
    window.dispatchEvent(
      new CustomEvent("pid-preferences-updated", {
        detail: { kp: pidPFactor, ki: pidIFactor, kd: pidDFactor },
      }),
    );
    sendWsCommand({
      id: 1,
      command: "setPidControl",
      pidProcessDelaySec,
      pidPredictorEnabled,
      authToken: getAdminSecret(),
    });
  };

  const emergencyStop = () => {
    profileStore.followProfileEnabled = false;
    setTick((v) => v + 1);
    const authToken = getAdminSecret();
    sendWsCommand({ id: 1, command: "emergencyStop", authToken });
    sendWsCommand({ id: 1, BurnerVal: 0, authToken });
    sendWsCommand({ id: 1, command: "setPidControl", pidEnabled: false, setpoint: 0, pidAutotune: false, authToken });
    sendWsCommand({ id: 1, command: "endRoastSession", authToken });
    window.dispatchEvent(new CustomEvent("emergency-stop"));
  };

  return (
    <>
      <div class="app-layout">
        <div class="tabs-nav">
          <h2 class="tabs-title">Yaeger</h2>
          {(["home", "roast", "autotune", "logs", "update", "settings"] as AppTab[]).map((tab) => (
            <button class={`tab-btn ${activeTab === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
          <button class="tab-btn emergency-btn" onClick={emergencyStop}>
            Emergency stop
          </button>
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
                  <input
                    id="pid-p"
                    type="number"
                    value={pidPFactor}
                    onFocus={() => setIsEditingPid(true)}
                    onBlur={() => setIsEditingPid(false)}
                    onInput={(e) => setPidPFactor(Number((e.target as HTMLInputElement).value) || 0)}
                  />
                  <label for="pid-i">I</label>
                  <input
                    id="pid-i"
                    type="number"
                    value={pidIFactor}
                    onFocus={() => setIsEditingPid(true)}
                    onBlur={() => setIsEditingPid(false)}
                    onInput={(e) => setPidIFactor(Number((e.target as HTMLInputElement).value) || 0)}
                  />
                  <label for="pid-d">D</label>
                  <input
                    id="pid-d"
                    type="number"
                    value={pidDFactor}
                    onFocus={() => setIsEditingPid(true)}
                    onBlur={() => setIsEditingPid(false)}
                    onInput={(e) => setPidDFactor(Number((e.target as HTMLInputElement).value) || 0)}
                  />
                  <label for="pid-delay">Process delay (s)</label>
                  <input
                    id="pid-delay"
                    type="number"
                    value={pidProcessDelaySec}
                    onInput={(e) => setPidProcessDelaySec(Number((e.target as HTMLInputElement).value) || 0)}
                  />
                  <label for="pid-predictor">Predictor enabled</label>
                  <input
                    id="pid-predictor"
                    type="checkbox"
                    checked={pidPredictorEnabled}
                    onChange={(e) => setPidPredictorEnabled(e.currentTarget.checked)}
                  />
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
