import { useEffect, useRef, useState } from "preact/hooks";
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
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, width, height);

    if (history.length < 2) {
      ctx.fillStyle = "#9ca3af";
      ctx.font = "14px sans-serif";
      ctx.fillText("Waiting for sensor samples…", 16, 24);
      return;
    }

    const values = history.map((s) => (target === "ET" ? s.ET : target === "simBT" ? s.simBT : s.BT));
    const minV = Math.min(...values, setpoint) - 3;
    const maxV = Math.max(...values, setpoint) + 3;
    const range = Math.max(1, maxV - minV);
    const xFor = (i: number) => (i / (history.length - 1)) * (width - 20) + 10;
    const yFor = (v: number) => height - 20 - ((v - minV) / range) * (height - 40);

    ctx.strokeStyle = "#374151";
    ctx.beginPath();
    ctx.moveTo(10, yFor(setpoint));
    ctx.lineTo(width - 10, yFor(setpoint));
    ctx.stroke();

    ctx.strokeStyle = "#22d3ee";
    ctx.lineWidth = 2;
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = xFor(i);
      const y = yFor(v);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [history, setpoint, target]);

  return (
    <div class="section">
      <h2>PID Autotune</h2>
      <p>
        Autotune: {lastMessage?.pidAutotune ? "Running" : "Idle"} | Crossings {lastMessage?.pidAutotuneCrossings ?? 0}/
        {lastMessage?.pidAutotuneTargetCrossings ?? "?"}
      </p>
      <canvas ref={canvasRef} width={700} height={220} />
      <p>
        Target
        <select value={target} onChange={(e) => setTarget((e.target as HTMLSelectElement).value as PidTarget)}>
          <option value="BT">BT</option><option value="ET">ET</option><option value="simBT">Sim BT</option>
        </select>
      </p>
      <p>
        Method
        <select value={method} onChange={(e) => setMethod((e.target as HTMLSelectElement).value as PidMethod)}>
          <option value="ziegler-nichols">Ziegler–Nichols</option><option value="tyreus-luyben">Tyreus–Luyben</option>
          <option value="pessen-integral">Pessen Integral</option><option value="no-overshoot">No overshoot</option>
        </select>
      </p>
      <p>Setpoint <input type="number" value={setpoint} onInput={(e) => setSetpoint(Number((e.target as HTMLInputElement).value) || 0)} /></p>
      <p>Fan <input type="number" value={fanSpeed} onInput={(e) => setFanSpeed(Number((e.target as HTMLInputElement).value) || 0)} /></p>
      <p>Min PWM <input type="number" value={minHeaterPwm} onInput={(e) => setMinHeaterPwm(Number((e.target as HTMLInputElement).value) || 0)} /></p>
      <p>Max PWM <input type="number" value={maxHeaterPwm} onInput={(e) => setMaxHeaterPwm(Number((e.target as HTMLInputElement).value) || 0)} /></p>
      <p>
        Kp <input type="number" value={kp} onInput={(e) => setKp(Number((e.target as HTMLInputElement).value) || 0)} />
        Ki <input type="number" value={ki} onInput={(e) => setKi(Number((e.target as HTMLInputElement).value) || 0)} />
        Kd <input type="number" value={kd} onInput={(e) => setKd(Number((e.target as HTMLInputElement).value) || 0)} />
      </p>
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
      <pre>{autotuneLog.slice(-25).join("\n")}</pre>
    </div>
  );
}
