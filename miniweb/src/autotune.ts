import van from "vanjs-core";
import { getAdminSecret } from "./auth";
import { lastMessage, socket } from "./websocket";

const { button, div, h2, input, option, p, select } = van.tags;

type PidTarget = "BT" | "ET" | "simBT";
type PidMethod = "ziegler-nichols" | "tyreus-luyben" | "pessen-integral" | "no-overshoot";

const target = van.state<PidTarget>("BT");
const method = van.state<PidMethod>("ziegler-nichols");
const setpoint = van.state(20);
const kp = van.state(1.0);
const ki = van.state(0.1);
const kd = van.state(0.01);
const autotuneActive = van.state(false);

function sendCommand(data: any) {
  const authToken = getAdminSecret();
  socket?.send(JSON.stringify({ ...data, authToken }));
}

function syncFromMessage() {
  const msg = lastMessage.val;
  if (!msg) {
    return;
  }
  if (msg.pidTarget) {
    target.val = msg.pidTarget;
  }
  if (msg.pidTuneMethod) {
    method.val = msg.pidTuneMethod;
  }
  if (typeof msg.setpoint === "number") {
    setpoint.val = msg.setpoint;
  }
  if (typeof msg.pidAutotune === "boolean") {
    autotuneActive.val = msg.pidAutotune;
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
    pidEnabled: false,
    pidTarget: target.val,
    pidTuneMethod: method.val,
    setpoint: setpoint.val,
    pidAutotune: true,
  });
  autotuneActive.val = true;
}

function stopAutotune() {
  sendCommand({
    id: 1,
    command: "setPidControl",
    pidAutotune: false,
  });
  autotuneActive.val = false;
}

export const autotuneApp = () =>
  div(
    { class: "section" },
    h2("PID Autotune"),
    p("Use this page to tune PID without starting a roast session."),
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
  );
