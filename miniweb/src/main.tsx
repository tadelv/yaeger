import "./style.css";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import van from "vanjs-core";
import { roastApp } from "./roast";
import { logsApp } from "./logs";
import { ProfileControl } from "./profiling";
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

function App() {
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const [pidPFactor, setPidPFactor] = useState(1.0);
  const [pidIFactor, setPidIFactor] = useState(0.1);
  const [pidDFactor, setPidDFactor] = useState(0.01);
  const [ssid, setSsid] = useState("");
  const [pass, setPass] = useState("");
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [deviceInfoError, setDeviceInfoError] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((x) => x + 1), 400);
    return () => window.clearInterval(id);
  }, []);

  const refreshDeviceInfo = async () => {
    try {
      setDeviceInfoError(null);
      const response = await fetch(`http://${location.host}/api/info`);
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const info = (await response.json()) as DeviceInfo;
      setDeviceInfo(info);
      setCsrfToken(info.csrfToken || "");
    } catch (error: unknown) {
      setDeviceInfo(null);
      setDeviceInfoError(error instanceof Error ? error.message : "Unknown error");
    }
  };

  useEffect(() => {
    void refreshDeviceInfo();
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
        body: JSON.stringify({ ssid, pass }),
      });
      if (response.ok) {
        alert("Wifi updated. Restart to apply.");
        await refreshDeviceInfo();
      } else {
        alert(`Request failed: ${response.status}`);
      }
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : "Unknown error");
    }
  };

  const sensorSnapshot = useMemo(
    () => ({
      connection: connectionStatus.val,
      message: lastMessage.val,
      updated: lastUpdate.val,
    }),
    [tick],
  );

  const openRoast = () => {
    const app = document.getElementById("app");
    if (!app) return;
    app.innerHTML = "";
    van.add(app, roastApp());
  };

  const openLogs = () => {
    const app = document.getElementById("app");
    if (!app) return;
    app.innerHTML = "";
    van.add(app, logsApp());
    window.history.pushState({}, "", "/logs");
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>Yaeger</h1>
        <button className={activeTab === "overview" ? "sidebar-tab is-active" : "sidebar-tab"} onClick={() => setActiveTab("overview")}>Overview</button>
        <button className={activeTab === "control" ? "sidebar-tab is-active" : "sidebar-tab"} onClick={() => setActiveTab("control")}>Roast Controls</button>
        <button className={activeTab === "network" ? "sidebar-tab is-active" : "sidebar-tab"} onClick={() => setActiveTab("network")}>Network</button>
      </aside>

      <main className="content">
        {activeTab === "overview" && (
          <>
            <section className="section">
              <h2>Connection</h2>
              <p>Status: {sensorSnapshot.connection}</p>
              <p>Last update: {sensorSnapshot.updated?.toString() ?? "N/A"}</p>
            </section>
            <section className="section">
              <h2>Sensors</h2>
              <p>ET: {sensorSnapshot.message?.ET ?? "N/A"}°C</p>
              <p>BT: {sensorSnapshot.message?.BT ?? "N/A"}°C</p>
              <p>Age: {sensorSnapshot.message?.sampleAgeMs ?? "N/A"} ms</p>
            </section>
          </>
        )}

        {activeTab === "control" && (
          <>
            <section className="section">
              <h2>Profile</h2>
              <ProfileControl />
            </section>
            <section className="section">
              <h2>PID</h2>
              <div className="settings-grid">
                <p>P</p>
                <input type="number" value={pidPFactor} onChange={(e) => setPidPFactor(Number.parseFloat(e.target.value) || 0)} />
                <p>I</p>
                <input type="number" value={pidIFactor} onChange={(e) => setPidIFactor(Number.parseFloat(e.target.value) || 0)} />
                <p>D</p>
                <input type="number" value={pidDFactor} onChange={(e) => setPidDFactor(Number.parseFloat(e.target.value) || 0)} />
              </div>
            </section>
          </>
        )}

        {activeTab === "network" && (
          <>
            <section className="section">
              <h2>Versions</h2>
              <p>Web UI: {__APP_VERSION__}</p>
              <p>Build: {new Date(__BUILD_TIMESTAMP__).toLocaleString()}</p>
              <p>Firmware: {deviceInfo?.firmwareVersion ?? "N/A"}</p>
              <p>Mode: {deviceInfo?.networkMode ?? "N/A"}</p>
              <p>SSID: {deviceInfo?.ssid || "N/A"}</p>
              <p>IP: {deviceInfo?.ip || "N/A"}</p>
              {deviceInfoError && <p style={{ color: "#b91c1c" }}>{deviceInfoError}</p>}
              <button onClick={() => void refreshDeviceInfo()}>Refresh</button>
            </section>
            <section className="section">
              <h2>Wifi</h2>
              <div className="settings-grid">
                <p>SSID</p>
                <input type="text" value={ssid} onChange={(e) => setSsid(e.target.value)} />
                <p>Password</p>
                <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
              </div>
              <button onClick={() => void updateWifiSettings()}>Update Wifi</button>
            </section>
          </>
        )}

        <section className="section">
          <div className="action-row">
            <button onClick={openRoast}>Start Roasting</button>
            <button onClick={openLogs}>Open Logs</button>
          </div>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById("app") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
