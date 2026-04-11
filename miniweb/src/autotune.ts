import van from "vanjs-core";
import { getAdminSecret } from "./auth";
import { lastMessage, socket } from "./websocket";

const { button, div, h2, input, option, p, pre, select } = van.tags;

type PidTarget = "BT" | "ET" | "simBT";
type PidMethod = "ziegler-nichols" | "tyreus-luyben" | "pessen-integral" | "no-overshoot";

const target = van.state<PidTarget>("BT");
const method = van.state<PidMethod>("ziegler-nichols");
const setpoint = van.state(20);
const fanSpeed = van.state(50);
const minHeaterPwm = van.state(0);
const maxHeaterPwm = van.state(60);
const kp = van.state(1.0);
const ki = van.state(0.1);
const kd = van.state(0.01);
const autotuneActive = van.state(false);
const history = van.state<Array<{ ts: number; ET: number; BT: number; simBT: number }>>([]);
const HISTORY_LIMIT = 300;
const autotuneLog = van.state<string[]>([]);
let lastCrossingsSeen = -1;

function sendCommand(data: any) {
  const authToken = getAdminSecret();
  socket?.send(JSON.stringify({ ...data, authToken }));
}

function syncFromMessage() {
  const msg = lastMessage.val;
  if (!msg) {
    return;
  }
  if (typeof msg.pidAutotune === "boolean") {
    autotuneActive.val = msg.pidAutotune;
  }
  if (typeof msg.pidAutotuneCrossings === "number" && msg.pidAutotuneCrossings !== lastCrossingsSeen) {
    lastCrossingsSeen = msg.pidAutotuneCrossings;
    autotuneLog.val = [
      ...autotuneLog.val.slice(-24),
      `Crossing ${msg.pidAutotuneCrossings}/${msg.pidAutotuneTargetCrossings ?? "?"} • Heater ${msg.pidAutotuneHeaterCommand ?? "?"}%`,
    ];
  }
  if (!msg.pidAutotune && typeof msg.pidAutotuneKu === "number" && typeof msg.pidAutotunePu === "number") {
    const doneMessage = `Autotune complete • Ku ${msg.pidAutotuneKu.toFixed(3)} • Pu ${msg.pidAutotunePu.toFixed(2)}s`;
    if (autotuneLog.val[autotuneLog.val.length - 1] !== doneMessage) {
      autotuneLog.val = [...autotuneLog.val.slice(-24), doneMessage];
    }
  }
  if (!msg.pidAutotune && typeof msg.pidKpActive === "number" && typeof msg.pidKiActive === "number" && typeof msg.pidKdActive === "number") {
    kp.val = msg.pidKpActive;
    ki.val = msg.pidKiActive;
    kd.val = msg.pidKdActive;
  }
  if (typeof msg.pidAutotuneMin === "number") {
    minHeaterPwm.val = msg.pidAutotuneMin;
  }
  if (typeof msg.pidAutotuneMax === "number") {
    maxHeaterPwm.val = msg.pidAutotuneMax;
  }
  if (
    typeof msg.ET === "number" &&
    typeof msg.BT === "number" &&
    typeof msg.simBT === "number"
  ) {
    const sample = {
      ts: Date.now(),
      ET: msg.ET,
      BT: msg.BT,
      simBT: msg.simBT,
    };
    const nextHistory = [...history.val, sample];
    history.val = nextHistory.slice(Math.max(0, nextHistory.length - HISTORY_LIMIT));
  }
}

van.derive(syncFromMessage);

function applyTargetPid() {
  sendCommand({
    id: 1,
    command: "setPreferences",
    pidTarget: target.val,
    pidKp: kp.val,
    pidKi: ki.val,
    pidKd: kd.val,
  });
}

function startAutotune() {
  sendCommand({
    id: 1,
    command: "setPidControl",
    FanVal: fanSpeed.val,
    pidEnabled: false,
    pidTarget: target.val,
    pidTuneMethod: method.val,
    setpoint: setpoint.val,
    pidAutotuneMin: minHeaterPwm.val,
    pidAutotuneMax: maxHeaterPwm.val,
    pidAutotune: true,
  });
  autotuneActive.val = true;
  autotuneLog.val = ["Autotune requested… waiting for crossings"];
}

function stopAutotune() {
  sendCommand({
    id: 1,
    command: "setPidControl",
    pidAutotune: false,
  });
  autotuneActive.val = false;
}

function currentTargetTemp() {
  const msg = lastMessage.val;
  if (!msg) {
    return null;
  }
  if (target.val === "ET") {
    return msg.ET ?? null;
  }
  if (target.val === "simBT") {
    return msg.simBT ?? null;
  }
  return msg.BT ?? null;
}

const graphCanvas = document.createElement("canvas");
graphCanvas.width = 700;
graphCanvas.height = 220;

function drawGraph() {
  const ctx = graphCanvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const samples = history.val;
  const width = graphCanvas.width;
  const height = graphCanvas.height;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#111827";
  ctx.fillRect(0, 0, width, height);

  if (samples.length < 2) {
    ctx.fillStyle = "#9ca3af";
    ctx.font = "14px sans-serif";
    ctx.fillText("Waiting for sensor samples…", 16, 24);
    return;
  }

  const values = samples.map((s) => (target.val === "ET" ? s.ET : target.val === "simBT" ? s.simBT : s.BT));
  const minV = Math.min(...values, setpoint.val) - 3;
  const maxV = Math.max(...values, setpoint.val) + 3;
  const range = Math.max(1, maxV - minV);

  const xFor = (idx: number) => (idx / (samples.length - 1)) * (width - 20) + 10;
  const yFor = (v: number) => height - 20 - ((v - minV) / range) * (height - 40);

  ctx.strokeStyle = "#374151";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(10, yFor(setpoint.val));
  ctx.lineTo(width - 10, yFor(setpoint.val));
  ctx.stroke();

  ctx.strokeStyle = "#22d3ee";
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v, idx) => {
    const x = xFor(idx);
    const y = yFor(v);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = "#e5e7eb";
  ctx.font = "12px sans-serif";
  ctx.fillText(`Target ${target.val} • ${values[values.length - 1].toFixed(1)}°C`, 12, 16);
  ctx.fillText(`Setpoint ${setpoint.val.toFixed(1)}°C`, width - 150, 16);
}

van.derive(drawGraph);

export const autotuneApp = () =>
  div(
    { class: "section" },
    h2("PID Autotune"),
    p("Use this page to tune PID without starting a roast session."),
    p(
      "Autotune: ",
      () => (lastMessage.val?.pidAutotune ? "Running" : "Idle"),
      " | Crossings ",
      () => `${lastMessage.val?.pidAutotuneCrossings ?? 0}/${lastMessage.val?.pidAutotuneTargetCrossings ?? "?"}`,
      " | Heater PWM ",
      () => `${lastMessage.val?.pidAutotuneHeaterCommand?.toFixed(0) ?? "N/A"}%`,
      " | Elapsed ",
      () => `${lastMessage.val?.pidAutotuneElapsedSec?.toFixed(1) ?? "N/A"}s`,
      " | ETA ",
      () => `${lastMessage.val?.pidAutotuneEtaSec?.toFixed(1) ?? "N/A"}s`,
      " | Min/Max PWM ",
      () => `${lastMessage.val?.pidAutotuneMin?.toFixed(0) ?? "N/A"}-${lastMessage.val?.pidAutotuneMax?.toFixed(0) ?? "N/A"}%`,
    ),
    p(
      "Peaks: High ",
      () => lastMessage.val?.pidAutotunePeakHigh?.toFixed(2) ?? "N/A",
      "°C | Low ",
      () => lastMessage.val?.pidAutotunePeakLow?.toFixed(2) ?? "N/A",
      "°C | Ku ",
      () => lastMessage.val?.pidAutotuneKu?.toFixed(3) ?? "N/A",
      " | Pu ",
      () => lastMessage.val?.pidAutotunePu?.toFixed(3) ?? "N/A",
      "s",
    ),
    p(
      "Active PID for target: Kp ",
      () => lastMessage.val?.pidKpActive?.toFixed(3) ?? "N/A",
      " | Ki ",
      () => lastMessage.val?.pidKiActive?.toFixed(3) ?? "N/A",
      " | Kd ",
      () => lastMessage.val?.pidKdActive?.toFixed(3) ?? "N/A",
    ),
    p(
      "Measured: ET ",
      () => lastMessage.val?.ET?.toFixed(1) ?? "N/A",
      "°C | BT ",
      () => lastMessage.val?.BT?.toFixed(1) ?? "N/A",
      "°C | Sim BT ",
      () => lastMessage.val?.simBT?.toFixed(1) ?? "N/A",
      "°C | Selected ",
      () => currentTargetTemp()?.toFixed(1) ?? "N/A",
      "°C",
    ),
    div(graphCanvas),
    p(
      "Target",
      select(
        {
          value: target,
          onchange: (e: Event) => {
            target.val = (e.target as HTMLSelectElement).value as PidTarget;
          },
        },
        option({ value: "BT" }, "BT"),
        option({ value: "ET" }, "ET"),
        option({ value: "simBT" }, "Sim BT"),
      ),
    ),
    p(
      "Method",
      select(
        {
          value: method,
          onchange: (e: Event) => {
            method.val = (e.target as HTMLSelectElement).value as PidMethod;
          },
        },
        option({ value: "ziegler-nichols" }, "Ziegler-Nichols"),
        option({ value: "tyreus-luyben" }, "Tyreus-Luyben"),
        option({ value: "pessen-integral" }, "Pessen Integral"),
        option({ value: "no-overshoot" }, "No overshoot"),
      ),
    ),
    p(
      "Setpoint (°C)",
      input({
        type: "number",
        value: setpoint,
        oninput: (e: Event) => {
          setpoint.val = parseFloat((e.target as HTMLInputElement).value) || 0;
        },
      }),
    ),
    p(
      "Heater Min PWM (%)",
      input({
        type: "number",
        min: "0",
        max: "100",
        value: minHeaterPwm,
        oninput: (e: Event) => {
          minHeaterPwm.val = parseFloat((e.target as HTMLInputElement).value) || 0;
        },
      }),
    ),
    p(
      "Heater Max PWM (%)",
      input({
        type: "number",
        min: "0",
        max: "100",
        value: maxHeaterPwm,
        oninput: (e: Event) => {
          maxHeaterPwm.val = parseFloat((e.target as HTMLInputElement).value) || 0;
        },
      }),
    ),
    p(
      "Fan (%)",
      input({
        type: "number",
        min: "0",
        max: "100",
        value: fanSpeed,
        oninput: (e: Event) => {
          fanSpeed.val = parseFloat((e.target as HTMLInputElement).value) || 0;
        },
      }),
    ),
    button(
      {
        onclick: () =>
          sendCommand({
            id: 1,
            command: "setFan",
            value: fanSpeed.val,
          }),
      },
      "Apply fan speed",
    ),
    p(
      "Kp",
      input({
        type: "number",
        value: kp,
        oninput: (e: Event) => {
          kp.val = parseFloat((e.target as HTMLInputElement).value) || 0;
        },
      }),
    ),
    p(
      "Ki",
      input({
        type: "number",
        value: ki,
        oninput: (e: Event) => {
          ki.val = parseFloat((e.target as HTMLInputElement).value) || 0;
        },
      }),
    ),
    p(
      "Kd",
      input({
        type: "number",
        value: kd,
        oninput: (e: Event) => {
          kd.val = parseFloat((e.target as HTMLInputElement).value) || 0;
        },
      }),
    ),
    button({ onclick: applyTargetPid }, "Save PID for target"),
    " ",
    button({ onclick: startAutotune, disabled: () => autotuneActive.val }, "Start autotune"),
    " ",
    button({ onclick: stopAutotune, disabled: () => !autotuneActive.val }, "Stop autotune"),
    p("Autotune status: ", () => (autotuneActive.val ? "Running" : "Idle")),
    p("Autotune log:"),
    pre(() => autotuneLog.val.map((line) => `• ${line}`).join("\n")),
  );
