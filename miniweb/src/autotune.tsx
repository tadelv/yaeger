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
  const [delayFan, setDelayFan] = useState(50);
  const [delayHeater, setDelayHeater] = useState(60);
  const [processDelaySec, setProcessDelaySec] = useState(0);
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
    if (typeof lastMessage.pidDelayFan === "number") setDelayFan(lastMessage.pidDelayFan);
    if (typeof lastMessage.pidDelayHeater === "number") setDelayHeater(lastMessage.pidDelayHeater);
    if (typeof lastMessage.pidProcessDelaySec === "number") setProcessDelaySec(lastMessage.pidProcessDelaySec);

    if (typeof lastMessage.ET === "number" && typeof lastMessage.BT === "number" && typeof lastMessage.simBT === "number") {
      setHistory((prev) => [...prev, { ET: lastMessage.ET, BT: lastMessage.BT, simBT: lastMessage.simBT }].slice(-300));
    }
  }, [kd, ki, lastMessage]);

  const delayElapsedSec =
    typeof lastMessage?.pidDelayMeasureElapsedSec === "number" ? lastMessage.pidDelayMeasureElapsedSec.toFixed(1) : "0.0";
  const measuredDelaySec =
    typeof lastMessage?.pidMeasuredProcessDelaySec === "number" ? lastMessage.pidMeasuredProcessDelaySec : processDelaySec;

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
        <label>Delay fan / heater</label>
        <div class="pid-inline-inputs">
          <input type="number" value={delayFan} onInput={(e) => setDelayFan(Number((e.target as HTMLInputElement).value) || 0)} />
          <input type="number" value={delayHeater} onInput={(e) => setDelayHeater(Number((e.target as HTMLInputElement).value) || 0)} />
        </div>
        <label>Measured delay (s)</label>
        <input type="number" value={processDelaySec} onInput={(e) => setProcessDelaySec(Number((e.target as HTMLInputElement).value) || 0)} />
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
      <button onClick={() => sendCommand({ id: 1, command: "setFan", value: 0 })}>Fan Off</button>
      <button
        onClick={() => {
          sendCommand({ id: 1, command: "setPreferences", pidTarget: target, pidKp: kp, pidKi: ki, pidKd: kd });
          window.dispatchEvent(
            new CustomEvent("pid-preferences-updated", {
              detail: { kp, ki, kd, pidTarget: target },
            }),
          );
          setAutotuneLog((prev) => [...prev.slice(-24), `Applied PID: Kp ${kp.toFixed(3)}, Ki ${ki.toFixed(3)}, Kd ${kd.toFixed(3)}`]);
        }}
      >
        Apply PID
      </button>
      <button
        onClick={() => {
          sendCommand({
            id: 1,
            command: "setPidControl",
            pidEnabled: false,
            pidDelayFan: delayFan,
            pidDelayHeater: delayHeater,
            pidMeasureDelay: true,
          });
          setAutotuneLog((prev) => [...prev.slice(-24), "Delay measurement requested (10s stabilize + heater step)"]);
        }}
      >
        Measure Delay
      </button>
      <button
        onClick={() => {
          sendCommand({
            id: 1,
            command: "setPidControl",
            pidProcessDelaySec: processDelaySec,
            pidPredictorEnabled: true,
          });
          setAutotuneLog((prev) => [...prev.slice(-24), `Applied process delay: ${processDelaySec.toFixed(2)}s`]);
        }}
      >
        Apply Delay
      </button>
      </div>
      <div class="status-strip">
        Delay measure: {lastMessage?.pidDelayMeasureState ?? "idle"} • elapsed {delayElapsedSec}s • measured {measuredDelaySec}s
      </div>
      <pre class="log-console">{autotuneLog.slice(-25).join("\n")}</pre>
    </div>
  );
}
