import { useEffect, useState } from "preact/hooks";
import { getBasicAuthHeaderValue } from "./auth";

export function LogsApp() {
  const [logText, setLogText] = useState("");
  const [logError, setLogError] = useState("");
  const [csrfToken, setCsrfToken] = useState("");

  const fetchCsrfToken = async () => {
    const response = await fetch(`http://${location.host}/api/info`);
    if (!response.ok) throw new Error(`Failed to load CSRF token: ${response.status}`);
    const info = (await response.json()) as { csrfToken?: string };
    setCsrfToken(info.csrfToken || "");
    return info.csrfToken || "";
  };

  const refreshLogs = async () => {
    try {
      setLogError("");
      const response = await fetch(`http://${location.host}/api/logs`);
      if (!response.ok) throw new Error(`Failed to fetch logs: ${response.status}`);
      setLogText(await response.text());
    } catch (error) {
      setLogError(error instanceof Error ? error.message : "Unknown log error");
    }
  };

  useEffect(() => {
    void fetchCsrfToken();
    void refreshLogs();
    const timer = window.setInterval(() => void refreshLogs(), 2000);
    return () => window.clearInterval(timer);
  }, []);

  const clearLogs = async () => {
    try {
      const token = csrfToken || (await fetchCsrfToken());
      const response = await fetch(`http://${location.host}/api/logs`, {
        method: "DELETE",
        headers: { Authorization: getBasicAuthHeaderValue(), "X-Yaeger-CSRF": token },
      });
      if (!response.ok) throw new Error(`Clear failed: ${response.status}`);
      await refreshLogs();
    } catch (error) {
      setLogError(error instanceof Error ? error.message : "Unknown clear error");
    }
  };

  const uploadLogFile = async (file: File) => {
    try {
      const token = csrfToken || (await fetchCsrfToken());
      const body = await file.text();
      const response = await fetch(`http://${location.host}/api/logs/upload`, {
        method: "POST",
        headers: {
          Authorization: getBasicAuthHeaderValue(),
          "X-Yaeger-CSRF": token,
          "Content-Type": "text/plain",
        },
        body,
      });
      if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
      await refreshLogs();
    } catch (error) {
      setLogError(error instanceof Error ? error.message : "Unknown upload error");
    }
  };

  return (
    <div class="start-page">
      <h1>Yaeger Logs</h1>
      <p>Live device logs (auto-refresh every 2s).</p>
      {logError ? <p style="color:#b91c1c;">Log error: {logError}</p> : null}
      <div class="section">
        <button onClick={() => void refreshLogs()}>Refresh Logs</button>
        <button
          onClick={() => {
            const blob = new Blob([logText], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `yaeger-logs-${new Date().toISOString()}.txt`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download Logs
        </button>
        <button onClick={() => void clearLogs()}>Clear Device Logs</button>
      </div>
      <div class="section">
        <p>Upload a log file into device log history for troubleshooting context.</p>
        <input
          type="file"
          accept=".txt,.log,application/json,text/plain"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            if (file) void uploadLogFile(file);
          }}
        />
      </div>
      <textarea readOnly style="width:100%;min-height:320px;font-family:monospace;" value={logText} />
    </div>
  );
}
