import { useEffect, useRef, useState } from "preact/hooks";
import { AutotuneGraph } from "./graphs";
import { getAdminSecret } from "./auth";
import { sendWsCommand, useSocketState } from "./websocket";

type PidTarget = "BT" | "ET" | "simBT";
type PidMethod = "ziegler-nichols" | "tyreus-luyben" | "pessen-integral" | "no-overshoot";
type ControlMode = "pid" | "adrc";

export function AutotuneApp() {
  const { lastMessage } = useSocketState();
  const [target, setTarget] = useState<PidTarget>("BT");
  const [method, setMethod] = useState<PidMethod>("ziegler-nichols");
  const [controlMode, setControlMode] = useState<ControlMode>("pid");
  const [autotuneMode, setAutotuneMode] = useState<ControlMode>("pid");
  const [setpoint, setSetpoint] = useState(20);
  const [fanSpeed, setFanSpeed] = useState(50);
  const [minHeaterPwm, setMinHeaterPwm] = useState(0);
  const [maxHeaterPwm, setMaxHeaterPwm] = useState(60);
  const [controlFanMin, setControlFanMin] = useState(30);
  const [controlFanMax, setControlFanMax] = useState(80);
  const [adrcFanControlEnabled, setAdrcFanControlEnabled] = useState(true);
  const [delayFan, setDelayFan] = useState(50);
  const [delayHeater, setDelayHeater] = useState(60);
  const [processDelaySec, setProcessDelaySec] = useState(0);
  const [kp, setKp] = useState(1.0);
  const [ki, setKi] = useState(0.1);
  const [kd, setKd] = useState(0.01);
  const [adrcB0, setAdrcB0] = useState(0.02);
  const [adrcW0, setAdrcW0] = useState(1.0);
  const [adrcWc, setAdrcWc] = useState(0.25);
  const [history, setHistory] = useState<Array<{ ET: number; BT: number; simBT: number }>>([]);
  const [autotuneLog, setAutotuneLog] = useState<string[]>([]);
  const lastCrossing = useRef(-1);
  const lastAdrcPhase = useRef("");
  const wasPidAutotuneRunning = useRef(false);
  const wasAdrcAutotuneRunning = useRef(false);
  const autotuneStopRequested = useRef(false);
  const autotuneBoundsDirty = useRef(false);
  const controlFanBoundsDirty = useRef(false);
  const adrcFanControlDirty = useRef(false);
  const delayInputsDirty = useRef(false);
  const adrcValuesDirty = useRef(false);
  const controlModeDirty = useRef(false);
  const autotuneModeDirty = useRef(false);

  const sendCommand = (data: Record<string, unknown>) => {
    const authToken = getAdminSecret();
    sendWsCommand({ ...data, authToken });
  };

  useEffect(() => {
    if (!lastMessage) return;
    const pidAutotuneRunning = Boolean(lastMessage.pidAutotune);
    const adrcAutotuneRunning = Boolean(lastMessage.adrcAutotune);
    const pidAutotuneJustCompleted = wasPidAutotuneRunning.current && !pidAutotuneRunning;
    const adrcAutotuneJustCompleted = wasAdrcAutotuneRunning.current && !adrcAutotuneRunning;

    if (lastMessage.controlMode === "pid" || lastMessage.controlMode === "adrc") {
      if (!controlModeDirty.current) {
        setControlMode(lastMessage.controlMode);
      } else if (lastMessage.controlMode === controlMode) {
        controlModeDirty.current = false;
      }
    }
    if (lastMessage.autotuneMode === "pid" || lastMessage.autotuneMode === "adrc") {
      if (!autotuneModeDirty.current) {
        setAutotuneMode(lastMessage.autotuneMode);
      } else if (lastMessage.autotuneMode === autotuneMode) {
        autotuneModeDirty.current = false;
      }
    }

    if (
      lastMessage.pidAutotune &&
      typeof lastMessage.pidAutotuneCrossings === "number" &&
      lastMessage.pidAutotuneCrossings > 0 &&
      lastMessage.pidAutotuneCrossings !== lastCrossing.current
    ) {
      lastCrossing.current = lastMessage.pidAutotuneCrossings;
      setAutotuneLog((prev) => [
        ...prev.slice(-24),
        `Crossing ${lastMessage.pidAutotuneCrossings}/${lastMessage.pidAutotuneTargetCrossings ?? "?"} • Heater ${lastMessage.pidAutotuneHeaterCommand ?? "?"}%`,
      ]);
    }

    if (lastMessage.adrcAutotune && lastMessage.adrcAutotunePhase && lastMessage.adrcAutotunePhase !== lastAdrcPhase.current) {
      lastAdrcPhase.current = lastMessage.adrcAutotunePhase;
      setAutotuneLog((prev) => [
        ...prev.slice(-24),
        `ADRC ${lastMessage.adrcAutotunePhase} • slope ${formatValue(lastMessage.adrcAutotunePeakSlope, 4)} °C/s`,
      ]);
    } else if (!lastMessage.adrcAutotune && lastAdrcPhase.current) {
      lastAdrcPhase.current = "";
    }

    if (!lastMessage.pidAutotune && typeof lastMessage.pidKpActive === "number") {
      const nextKp = lastMessage.pidKpActive;
      const nextKi = lastMessage.pidKiActive ?? ki;
      const nextKd = lastMessage.pidKdActive ?? kd;
      setKp(nextKp);
      setKi(nextKi);
      setKd(nextKd);
      if (pidAutotuneJustCompleted) {
        const message = autotuneStopRequested.current
          ? "PID autotune stopped."
          : `PID tuning finished: Kp ${nextKp.toFixed(4)}, Ki ${nextKi.toFixed(4)}, Kd ${nextKd.toFixed(4)}`;
        setAutotuneLog((prev) => [...prev.slice(-24), message]);
        autotuneStopRequested.current = false;
      }
    }

    const nextAdrcB0 = lastMessage.adrcB0;
    const nextAdrcW0 = lastMessage.adrcW0;
    const nextAdrcWc = lastMessage.adrcWc;
    if (typeof nextAdrcB0 === "number" && typeof nextAdrcW0 === "number" && typeof nextAdrcWc === "number") {
      if (!adrcValuesDirty.current || adrcAutotuneJustCompleted) {
        setAdrcB0(nextAdrcB0);
        setAdrcW0(nextAdrcW0);
        setAdrcWc(nextAdrcWc);
        adrcValuesDirty.current = false;
        if (adrcAutotuneJustCompleted) {
          const message = autotuneStopRequested.current
            ? "ADRC autotune stopped."
            : `ADRC tuning finished: b0 ${nextAdrcB0.toFixed(4)}, w0 ${nextAdrcW0.toFixed(4)}, wc ${nextAdrcWc.toFixed(4)}`;
          setAutotuneLog((prev) => [
            ...prev.slice(-24),
            message,
          ]);
          autotuneStopRequested.current = false;
        }
      } else {
        const b0Matches = Math.abs(nextAdrcB0 - adrcB0) < 0.0001;
        const w0Matches = Math.abs(nextAdrcW0 - adrcW0) < 0.0001;
        const wcMatches = Math.abs(nextAdrcWc - adrcWc) < 0.0001;
        if (b0Matches && w0Matches && wcMatches) {
          adrcValuesDirty.current = false;
        }
      }
    }

    if (typeof lastMessage.pidAutotuneMin === "number" && typeof lastMessage.pidAutotuneMax === "number") {
      if (!autotuneBoundsDirty.current) {
        setMinHeaterPwm(lastMessage.pidAutotuneMin);
        setMaxHeaterPwm(lastMessage.pidAutotuneMax);
      } else {
        const minMatches = Math.abs(lastMessage.pidAutotuneMin - minHeaterPwm) < 0.01;
        const maxMatches = Math.abs(lastMessage.pidAutotuneMax - maxHeaterPwm) < 0.01;
        if (minMatches && maxMatches) {
          autotuneBoundsDirty.current = false;
        }
      }
    }
    if (typeof lastMessage.controlFanMin === "number" && typeof lastMessage.controlFanMax === "number") {
      if (!controlFanBoundsDirty.current) {
        setControlFanMin(lastMessage.controlFanMin);
        setControlFanMax(lastMessage.controlFanMax);
      } else {
        const minMatches = Math.abs(lastMessage.controlFanMin - controlFanMin) < 0.01;
        const maxMatches = Math.abs(lastMessage.controlFanMax - controlFanMax) < 0.01;
        if (minMatches && maxMatches) {
          controlFanBoundsDirty.current = false;
        }
      }
    }
    if (typeof lastMessage.adrcFanControlEnabled === "boolean") {
      if (!adrcFanControlDirty.current) {
        setAdrcFanControlEnabled(lastMessage.adrcFanControlEnabled);
      } else if (lastMessage.adrcFanControlEnabled === adrcFanControlEnabled) {
        adrcFanControlDirty.current = false;
      }
    }
    if (typeof lastMessage.pidDelayFan === "number" && typeof lastMessage.pidDelayHeater === "number") {
      if (!delayInputsDirty.current) {
        setDelayFan(lastMessage.pidDelayFan);
        setDelayHeater(lastMessage.pidDelayHeater);
      } else {
        const delayFanMatches = Math.abs(lastMessage.pidDelayFan - delayFan) < 0.01;
        const delayHeaterMatches = Math.abs(lastMessage.pidDelayHeater - delayHeater) < 0.01;
        if (delayFanMatches && delayHeaterMatches) {
          delayInputsDirty.current = false;
        }
      }
    }
    if (typeof lastMessage.pidProcessDelaySec === "number") setProcessDelaySec(lastMessage.pidProcessDelaySec);

    if (typeof lastMessage.ET === "number" && typeof lastMessage.BT === "number" && typeof lastMessage.simBT === "number") {
      setHistory((prev) => [...prev, { ET: lastMessage.ET, BT: lastMessage.BT, simBT: Number(lastMessage.simBT) }].slice(-300));
    }
    wasPidAutotuneRunning.current = pidAutotuneRunning;
    wasAdrcAutotuneRunning.current = adrcAutotuneRunning;
  }, [
    adrcB0,
    adrcFanControlEnabled,
    adrcW0,
    adrcWc,
    autotuneMode,
    controlFanMax,
    controlFanMin,
    controlMode,
    delayFan,
    delayHeater,
    kd,
    ki,
    lastMessage,
    maxHeaterPwm,
    minHeaterPwm,
  ]);

  const delayElapsedSec =
    typeof lastMessage?.pidDelayMeasureElapsedSec === "number" ? lastMessage.pidDelayMeasureElapsedSec.toFixed(1) : "0.0";
  const measuredDelaySec =
    typeof lastMessage?.pidMeasuredProcessDelaySec === "number" ? lastMessage.pidMeasuredProcessDelaySec : processDelaySec;
  const isAutotuneRunning = Boolean(lastMessage?.pidAutotune || lastMessage?.adrcAutotune);
  const autotuneProgress =
    autotuneMode === "adrc"
      ? `ADRC ${lastMessage?.adrcAutotunePhase ?? "idle"} • ${formatValue(lastMessage?.adrcAutotuneElapsedSec, 1)}s`
      : `Crossings ${lastMessage?.pidAutotuneCrossings ?? 0}/${lastMessage?.pidAutotuneTargetCrossings ?? "?"}`;

  return (
    <div class="section">
      <h2>Controller Autotune</h2>
      <div class="status-strip">
        Mode {autotuneMode.toUpperCase()} • Autotune: {isAutotuneRunning ? "Running" : "Idle"} • {autotuneProgress}
      </div>
      <AutotuneGraph history={history} target={target} setpoint={setpoint} />
      <div class="autotune-memos">
        <article class="memo-card">
          <h3>PID memo</h3>
          <p>
            Relay autotune toggles the heater between Min PWM and Max PWM around the setpoint. After repeated crossings it estimates
            Ku and Pu, then writes Kp, Ki, and Kd using the selected method.
          </p>
          <p>The result appears in Kp, Ki, and Kd below and is saved for the selected target sensor.</p>
        </article>
        <article class="memo-card">
          <h3>ADRC memo</h3>
          <p>
            Step autotune holds heat off for 10 seconds, applies a 60% heater step for 25 seconds, then estimates b0 from the fastest
            positive temperature slope.
          </p>
          <p>The fan can use the automatic min/max range during tuning. The result appears in b0, w0, and wc below.</p>
        </article>
      </div>
      <div class="controller-diagnostics">
        <h3>Autotune values</h3>
        <div class="pid-grid">
          <span>Kp {formatValue(lastMessage?.pidKpActive ?? kp, 4)}</span>
          <span>Ki {formatValue(lastMessage?.pidKiActive ?? ki, 4)}</span>
          <span>Kd {formatValue(lastMessage?.pidKdActive ?? kd, 4)}</span>
          <span>Ku {formatValue(lastMessage?.pidAutotuneKu, 4)}</span>
          <span>Pu {formatValue(lastMessage?.pidAutotunePu, 2)}s</span>
          <span>Peaks {formatValue(lastMessage?.pidAutotuneAvgPeakLow, 2)} / {formatValue(lastMessage?.pidAutotuneAvgPeakHigh, 2)}</span>
          <span>b0 {formatValue(lastMessage?.adrcB0 ?? adrcB0, 4)}</span>
          <span>w0 {formatValue(lastMessage?.adrcW0 ?? adrcW0, 4)}</span>
          <span>wc {formatValue(lastMessage?.adrcWc ?? adrcWc, 4)}</span>
          <span>ADRC slope {formatValue(lastMessage?.adrcAutotunePeakSlope, 4)} °C/s</span>
          <span>ADRC baseline {formatValue(lastMessage?.adrcAutotuneBaselineTemp, 2)} °C</span>
          <span>Step {formatValue(lastMessage?.adrcAutotuneHeaterStep, 0)}%</span>
        </div>
      </div>
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
        <label>Control mode</label>
        <select
          value={controlMode}
          onChange={(e) => {
            controlModeDirty.current = true;
            setControlMode((e.target as HTMLSelectElement).value as ControlMode);
          }}
        >
          <option value="pid">PID</option><option value="adrc">ADRC</option>
        </select>
        <label>Autotune mode</label>
        <select
          value={autotuneMode}
          onChange={(e) => {
            autotuneModeDirty.current = true;
            setAutotuneMode((e.target as HTMLSelectElement).value as ControlMode);
          }}
        >
          <option value="pid">PID</option><option value="adrc">ADRC</option>
        </select>
        <label>Setpoint</label>
        <input type="number" value={setpoint} onInput={(e) => setSetpoint(Number((e.target as HTMLInputElement).value) || 0)} />
        <label>Fan</label>
        <input type="number" value={fanSpeed} onInput={(e) => setFanSpeed(Number((e.target as HTMLInputElement).value) || 0)} />
        <label>Auto fan min / max</label>
        <div class="pid-inline-inputs">
          <input
            type="number"
            value={controlFanMin}
            onInput={(e) => {
              controlFanBoundsDirty.current = true;
              setControlFanMin(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
          <input
            type="number"
            value={controlFanMax}
            onInput={(e) => {
              controlFanBoundsDirty.current = true;
              setControlFanMax(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
        </div>
        <label>ADRC controls fan</label>
        <input
          type="checkbox"
          checked={adrcFanControlEnabled}
          onChange={(e) => {
            adrcFanControlDirty.current = true;
            setAdrcFanControlEnabled(e.currentTarget.checked);
          }}
        />
        <label>Min PWM</label>
        <input
          type="number"
          value={minHeaterPwm}
          onInput={(e) => {
            autotuneBoundsDirty.current = true;
            setMinHeaterPwm(Number((e.target as HTMLInputElement).value) || 0);
          }}
        />
        <label>Max PWM</label>
        <input
          type="number"
          value={maxHeaterPwm}
          onInput={(e) => {
            autotuneBoundsDirty.current = true;
            setMaxHeaterPwm(Number((e.target as HTMLInputElement).value) || 0);
          }}
        />
        <label>Kp / Ki / Kd</label>
        <div class="pid-inline-inputs">
          <input type="number" value={kp} onInput={(e) => setKp(Number((e.target as HTMLInputElement).value) || 0)} />
          <input type="number" value={ki} onInput={(e) => setKi(Number((e.target as HTMLInputElement).value) || 0)} />
          <input type="number" value={kd} onInput={(e) => setKd(Number((e.target as HTMLInputElement).value) || 0)} />
        </div>
        <label>b0 / w0 / wc</label>
        <div class="pid-inline-inputs">
          <input
            type="number"
            value={adrcB0}
            onInput={(e) => {
              adrcValuesDirty.current = true;
              setAdrcB0(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
          <input
            type="number"
            value={adrcW0}
            onInput={(e) => {
              adrcValuesDirty.current = true;
              setAdrcW0(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
          <input
            type="number"
            value={adrcWc}
            onInput={(e) => {
              adrcValuesDirty.current = true;
              setAdrcWc(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
        </div>
        <label>Delay fan / heater</label>
        <div class="pid-inline-inputs">
          <input
            type="number"
            value={delayFan}
            onInput={(e) => {
              delayInputsDirty.current = true;
              setDelayFan(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
          <input
            type="number"
            value={delayHeater}
            onInput={(e) => {
              delayInputsDirty.current = true;
              setDelayHeater(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
        </div>
        <label>Measured delay (s)</label>
        <input type="number" value={processDelaySec} onInput={(e) => setProcessDelaySec(Number((e.target as HTMLInputElement).value) || 0)} />
      </div>
      <div class="inline-actions">
        <button
          onClick={() => {
            const fanBounds = normalizeFanBounds(controlFanMin, controlFanMax);
            setControlFanMin(fanBounds.min);
            setControlFanMax(fanBounds.max);
            if (autotuneMode === "adrc") {
              adrcValuesDirty.current = false;
            }
            sendCommand({
              id: 1,
              command: "setPidControl",
              FanVal: fanSpeed,
              pidEnabled: false,
              controlMode,
              autotuneMode,
              pidTarget: target,
              pidTuneMethod: method,
              controlFanMin: fanBounds.min,
              controlFanMax: fanBounds.max,
              adrcFanControlEnabled,
              setpoint,
              pidAutotuneMin: minHeaterPwm,
              pidAutotuneMax: maxHeaterPwm,
              pidAutotune: autotuneMode === "pid",
              adrcAutotune: autotuneMode === "adrc",
            });
            setAutotuneLog([`Autotune requested (${autotuneMode.toUpperCase()})…`]);
            autotuneStopRequested.current = false;
          }}
        >
          Start Autotune
        </button>
        <button
          onClick={() => {
            autotuneStopRequested.current = true;
            sendCommand({ id: 1, command: "setPidControl", pidAutotune: false, adrcAutotune: false });
          }}
        >
          Stop
        </button>
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
            const fanBounds = normalizeFanBounds(controlFanMin, controlFanMax);
            setControlFanMin(fanBounds.min);
            setControlFanMax(fanBounds.max);
            sendCommand({
              id: 1,
              command: "setPidControl",
              controlMode: "adrc",
              controlFanMin: fanBounds.min,
              controlFanMax: fanBounds.max,
              adrcFanControlEnabled,
              adrcB0,
              adrcW0,
              adrcWc,
            });
            adrcValuesDirty.current = true;
            setAutotuneLog((prev) => [...prev.slice(-24), `Applied ADRC: b0 ${adrcB0.toFixed(4)}, w0 ${adrcW0.toFixed(4)}, wc ${adrcWc.toFixed(4)}`]);
          }}
        >
          Apply ADRC
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

function formatValue(value: number | null | undefined, digits = 2) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "N/A";
}

function normalizeFanBounds(min: number, max: number) {
  const safeMin = clampPercent(min);
  const safeMax = clampPercent(max);
  return {
    min: Math.min(safeMin, safeMax),
    max: Math.max(safeMin, safeMax),
  };
}

function clampPercent(value: number) {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}
