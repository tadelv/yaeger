import { useEffect, useRef, useState } from "preact/hooks";
import { AutotuneGraph } from "./graphs";
import { getAdminSecret } from "./auth";
import { sendWsCommand, useSocketState } from "./websocket";

type PidTarget = "BT" | "ET" | "simBT";
type PidMethod = "ziegler-nichols" | "tyreus-luyben" | "pessen-integral" | "no-overshoot";

export function AutotuneApp() {
  const { lastMessage } = useSocketState();
  const [target, setTarget] = useState<PidTarget>("BT");
  const [method, setMethod] = useState<PidMethod>("ziegler-nichols");
  const [setpoint, setSetpoint] = useState(20);
  const [fanSpeed, setFanSpeed] = useState(50);
  const [minHeaterPwm, setMinHeaterPwm] = useState(0);
  const [maxHeaterPwm, setMaxHeaterPwm] = useState(60);
  const [kp, setKp] = useState(1.0);
  const [ki, setKi] = useState(0.1);
  const [kd, setKd] = useState(0.01);
  const [history, setHistory] = useState<Array<{ ET: number; BT: number; simBT: number }>>([]);
  const [autotuneLog, setAutotuneLog] = useState<string[]>([]);
  const lastCrossing = useRef(-1);

  const sendCommand = (data: Record<string, unknown>) => {
    const authToken = getAdminSecret();
    sendWsCommand({ ...data, authToken });
  };

  useEffect(() => {
    if (!lastMessage) return;

    if (typeof lastMessage.pidAutotuneCrossings === "number" && lastMessage.pidAutotuneCrossings !== lastCrossing.current) {
      lastCrossing.current = lastMessage.pidAutotuneCrossings;
      setAutotuneLog((prev) => [
        ...prev.slice(-24),
        `Crossing ${lastMessage.pidAutotuneCrossings}/${lastMessage.pidAutotuneTargetCrossings ?? "?"} • Heater ${lastMessage.pidAutotuneHeaterCommand ?? "?"}%`,
      ]);
    }

    if (!lastMessage.pidAutotune && typeof lastMessage.pidKpActive === "number") {
      setKp(lastMessage.pidKpActive);
      setKi(lastMessage.pidKiActive ?? ki);
      setKd(lastMessage.pidKdActive ?? kd);
    }

    if (typeof lastMessage.pidAutotuneMin === "number") setMinHeaterPwm(lastMessage.pidAutotuneMin);
    if (typeof lastMessage.pidAutotuneMax === "number") setMaxHeaterPwm(lastMessage.pidAutotuneMax);

    if (typeof lastMessage.ET === "number" && typeof lastMessage.BT === "number" && typeof lastMessage.simBT === "number") {
      setHistory((prev) => [...prev, { ET: lastMessage.ET, BT: lastMessage.BT, simBT: lastMessage.simBT }].slice(-300));
    }
  }, [kd, ki, lastMessage]);


  return (
    <div class="section">
      <h2>PID Autotune</h2>
      <div class="status-strip">
        Autotune: {lastMessage?.pidAutotune ? "Running" : "Idle"} • Crossings {lastMessage?.pidAutotuneCrossings ?? 0}/
        {lastMessage?.pidAutotuneTargetCrossings ?? "?"}
      </div>
      <AutotuneGraph history={history} target={target} setpoint={setpoint} />
      <div class="form-grid">
        <label>Target</label>
        <select value={target} onChange={(e) => setTarget((e.target as HTMLSelectElement).value as PidTarget)}>
          <option value="BT">BT</option><option value="ET">ET</option><option value="simBT">Sim BT</option>
        </select>
        <label>Method</label>
        <select value={method} onChange={(e) => setMethod((e.target as HTMLSelectElement).value as PidMethod)}>
          <option value="ziegler-nichols">Ziegler–Nichols</option><option value="tyreus-luyben">Tyreus–Luyben</option>
          <option value="pessen-integral">Pessen Integral</option><option value="no-overshoot">No overshoot</option>
        </select>
        <label>Setpoint</label>
        <input type="number" value={setpoint} onInput={(e) => setSetpoint(Number((e.target as HTMLInputElement).value) || 0)} />
        <label>Fan</label>
        <input type="number" value={fanSpeed} onInput={(e) => setFanSpeed(Number((e.target as HTMLInputElement).value) || 0)} />
        <label>Min PWM</label>
        <input type="number" value={minHeaterPwm} onInput={(e) => setMinHeaterPwm(Number((e.target as HTMLInputElement).value) || 0)} />
        <label>Max PWM</label>
        <input type="number" value={maxHeaterPwm} onInput={(e) => setMaxHeaterPwm(Number((e.target as HTMLInputElement).value) || 0)} />
        <label>Kp / Ki / Kd</label>
        <div class="pid-inline-inputs">
          <input type="number" value={kp} onInput={(e) => setKp(Number((e.target as HTMLInputElement).value) || 0)} />
          <input type="number" value={ki} onInput={(e) => setKi(Number((e.target as HTMLInputElement).value) || 0)} />
          <input type="number" value={kd} onInput={(e) => setKd(Number((e.target as HTMLInputElement).value) || 0)} />
        </div>
      </div>
      <div class="inline-actions">
        <button
        onClick={() => {
          sendCommand({
            id: 1,
            command: "setPidControl",
            FanVal: fanSpeed,
            pidEnabled: false,
            pidTarget: target,
            pidTuneMethod: method,
            setpoint,
            pidAutotuneMin: minHeaterPwm,
            pidAutotuneMax: maxHeaterPwm,
            pidAutotune: true,
          });
          setAutotuneLog(["Autotune requested… waiting for crossings"]);
        }}
      >
        Start Autotune
      </button>
      <button onClick={() => sendCommand({ id: 1, command: "setPidControl", pidAutotune: false })}>Stop</button>
      <button onClick={() => sendCommand({ id: 1, command: "setPreferences", pidTarget: target, pidKp: kp, pidKi: ki, pidKd: kd })}>Apply PID</button>
      </div>
      <pre class="log-console">{autotuneLog.slice(-25).join("\n")}</pre>
    </div>
  );
}
