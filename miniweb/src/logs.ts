import van from "vanjs-core";
import { getBasicAuthHeaderValue } from "./auth";

const { div, h1, button, p, textarea, input } = van.tags;

const logText = van.state("");
const logError = van.state("");
const csrfToken = van.state("");
let refreshTimerId: number | null = null;

async function fetchCsrfToken() {
  const response = await fetch(`http://${location.host}/api/info`);
  if (!response.ok) {
    throw new Error(`Failed to load CSRF token: ${response.status}`);
  }
  const info = (await response.json()) as { csrfToken?: string };
  csrfToken.val = info.csrfToken || "";
}

async function refreshLogs() {
  try {
    logError.val = "";
    const response = await fetch(`http://${location.host}/api/logs`);
    if (!response.ok) {
      throw new Error(`Failed to fetch logs: ${response.status}`);
    }
    logText.val = await response.text();
  } catch (error) {
    logError.val = error instanceof Error ? error.message : "Unknown log error";
  }
}

async function clearLogs() {
  try {
    if (!csrfToken.val) {
      await fetchCsrfToken();
    }
    const response = await fetch(`http://${location.host}/api/logs`, {
      method: "DELETE",
      headers: {
        Authorization: getBasicAuthHeaderValue(),
        "X-Yaeger-CSRF": csrfToken.val,
      },
    });
    if (!response.ok) {
      throw new Error(`Clear failed: ${response.status}`);
    }
    await refreshLogs();
  } catch (error) {
    logError.val = error instanceof Error ? error.message : "Unknown clear error";
  }
}

function downloadLogs() {
  const blob = new Blob([logText.val], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `yaeger-logs-${new Date().toISOString()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

async function uploadLogFile(file: File) {
  try {
    if (!csrfToken.val) {
      await fetchCsrfToken();
    }
    const body = await file.text();
    const response = await fetch(`http://${location.host}/api/logs/upload`, {
      method: "POST",
      headers: {
        Authorization: getBasicAuthHeaderValue(),
        "X-Yaeger-CSRF": csrfToken.val,
        "Content-Type": "text/plain",
      },
      body,
    });
    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }
    await refreshLogs();
  } catch (error) {
    logError.val = error instanceof Error ? error.message : "Unknown upload error";
  }
}

export const logsApp = () => {
  void fetchCsrfToken();
  void refreshLogs();

  if (refreshTimerId != null) {
    window.clearInterval(refreshTimerId);
  }
  refreshTimerId = window.setInterval(() => {
    void refreshLogs();
  }, 2000);

  return div(
    { class: "start-page" },
    h1("Yaeger Logs"),
    p("Live device logs (auto-refresh every 2s)."),
    () =>
      logError.val
        ? p({ style: "color: #b91c1c;" }, "Log error: ", logError.val)
        : null,
    div(
      { class: "section" },
      button({ onclick: () => void refreshLogs() }, "Refresh Logs"),
      " ",
      button({ onclick: downloadLogs }, "Download Logs"),
      " ",
      button({ onclick: () => void clearLogs() }, "Clear Device Logs"),
    ),
    div(
      { class: "section" },
      p("Upload a log file into device log history for troubleshooting context."),
      input({
        type: "file",
        accept: ".txt,.log,application/json,text/plain",
        onchange: (e: Event) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (file) {
            void uploadLogFile(file);
          }
        },
      }),
    ),
    textarea({
      readonly: true,
      style: "width: 100%; min-height: 320px; font-family: monospace;",
      value: () => logText.val,
    }),
    div(
      { class: "section" },
      button({
        onclick: () => {
          if (refreshTimerId != null) {
            window.clearInterval(refreshTimerId);
            refreshTimerId = null;
          }
          document.getElementById("app")!.innerHTML = "";
          window.location.href = "/";
        },
      }, "Back"),
    ),
  );
};
