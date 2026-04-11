import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { initializeChart, updateChart } from "./chart";
import { getAdminSecret } from "./auth";
import { getFormattedTimeDifference } from "./util";
import { Measurement, RoastState, RoasterStatus, YaegerState } from "./model";
import { followProfile, ProfileControl, profileStore } from "./profiling";
import { sendWsCommand, useSocketState } from "./websocket";

type PidTarget = "BT" | "ET" | "simBT";

const initialState = new YaegerState();

function dateReviver(_key: string, value: unknown): unknown {
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(value)
  ) {
    return new Date(value);
  }
  return value;
}

export function RoastApp() {
  const { lastMessage, lastUpdate } = useSocketState();
  const [state, setState] = useState<YaegerState>(initialState);
  const [fan, setFan] = useState(50);
  const [heater, setHeater] = useState(50);
  const [setpoint, setSetpoint] = useState(20);
  const [kp, setKp] = useState(1.0);
  const [ki, setKi] = useState(0.1);
  const [kd, setKd] = useState(0.01);
  const [pidEnabled, setPidEnabled] = useState(false);
  const [pidTarget, setPidTarget] = useState<PidTarget>("BT");
  const [refreshToken, setRefreshToken] = useState(0);
  const chartCanvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ReturnType<typeof initializeChart> | null>(null);

  useEffect(() => {
    if (!chartCanvasRef.current || chartRef.current) return;
    const ctx = chartCanvasRef.current.getContext("2d");
    if (!ctx) return;
    chartRef.current = initializeChart(ctx);
  }, []);

  const sendCommand = (data: Record<string, unknown>) => {
    const authToken = getAdminSecret();
    sendWsCommand({ ...data, authToken });
  };

  const appendCommand = (label: "fan" | "heater", value: number) => {
    setState((prev) => {
      if (prev.currentState.status === RoasterStatus.idle || !prev.roast) return prev;
      return {
        ...prev,
        roast: {
          ...prev.roast,
          commands: [...(prev.roast.commands || []), { type: label, value, timestamp: new Date() }],
        },
      };
    });
  };

  const updateFanPower = (value: number) => {
    sendCommand({ id: 1, FanVal: value });
    appendCommand("fan", value);
  };

  const updateHeaterPower = (value: number) => {
    sendCommand({ id: 1, BurnerVal: value });
    appendCommand("heater", value);
  };

  const sendPidControlConfig = (status = state.currentState.status, pidOn = pidEnabled) => {
    sendCommand({
      id: 1,
      command: "setPidControl",
      setpoint,
      pidEnabled: pidOn && status === RoasterStatus.roasting,
      pidTarget,
    });
  };

  useEffect(() => {
    if (!lastMessage || !lastUpdate) return;

    setFan(lastMessage.FanVal);
    setHeater(lastMessage.BurnerVal);

    setState((prev) => {
      const next: YaegerState = {
        ...prev,
        currentState: { ...prev.currentState, lastMessage, lastUpdate },
      };

      if (prev.roast && prev.currentState.status === RoasterStatus.roasting) {
        const measurement: Measurement = {
          timestamp: lastUpdate,
          message: lastMessage,
          extra: { setpoint, pidData: { enabled: pidEnabled, kp, ki, kd } },
        };
        next.roast = {
          ...prev.roast,
          measurements: [...prev.roast.measurements, measurement],
        };

        if (profileStore.profile && profileStore.followProfileEnabled) {
          const profileUpdate = followProfile(profileStore.profile, next.roast);
          if (profileUpdate) {
            setSetpoint(profileUpdate.setPoint);
            if (profileUpdate.fanValue != null) {
              setFan(profileUpdate.fanValue);
              updateFanPower(profileUpdate.fanValue);
            }
          }
        }

        if (chartRef.current) {
          updateChart(chartRef.current, next.roast);
        }
      }

      return next;
    });
  }, [kd, ki, kp, lastMessage, lastUpdate, pidEnabled, setpoint]);

  const roastTime = useMemo(() => {
    if (!state.roast?.measurements.length) return "00:00";
    return getFormattedTimeDifference(
      state.roast.startDate,
      state.roast.measurements[state.roast.measurements.length - 1].timestamp,
    );
  }, [state.roast]);

  const btRoR = useMemo(() => {
    const m = state.roast?.measurements ?? [];
    if (m.length < 2) return null;
    const latest = m[m.length - 1];
    const prev = m[m.length - 2];
    const elapsed = (latest.timestamp.getTime() - prev.timestamp.getTime()) / 1000;
    return elapsed > 0 ? ((latest.message.BT - prev.message.BT) / elapsed) * 60 : null;
  }, [state.roast]);

  const etRoR = useMemo(() => {
    const m = state.roast?.measurements ?? [];
    if (m.length < 2) return null;
    const latest = m[m.length - 1];
    const prev = m[m.length - 2];
    const elapsed = (latest.timestamp.getTime() - prev.timestamp.getTime()) / 1000;
    return elapsed > 0 ? ((latest.message.ET - prev.message.ET) / elapsed) * 60 : null;
  }, [state.roast]);

  const toggleRoastStart = () => {
    if (state.currentState.status === RoasterStatus.idle) {
      setState((prev) => ({
        ...prev,
        currentState: { ...prev.currentState, status: RoasterStatus.roasting },
        roast: { startDate: new Date(), measurements: [], events: [], commands: [] },
        profile: profileStore.profile,
      }));
      sendPidControlConfig(RoasterStatus.roasting);
      return;
    }

    setState((prev) => ({
      ...prev,
      currentState: { ...prev.currentState, status: RoasterStatus.idle },
      roast: prev.roast ? { ...prev.roast, profile: prev.profile } : prev.roast,
    }));
    sendPidControlConfig(RoasterStatus.idle);
  };

  const appendEvent = (label: string) => {
    setState((prev) => {
      if (prev.currentState.status === RoasterStatus.idle || !prev.roast) return prev;
      if (!prev.currentState.lastMessage || !prev.currentState.lastUpdate) return prev;
      return {
        ...prev,
        roast: {
          ...prev.roast,
          events: [
            ...(prev.roast.events || []),
            {
              label,
              measurement: {
                message: prev.currentState.lastMessage,
                timestamp: prev.currentState.lastUpdate,
              },
            },
          ],
        },
      };
    });
  };

  return (
    <div>
      <div>
        <button onClick={toggleRoastStart}>
          {state.currentState.status === RoasterStatus.idle ? "Start" : "Stop"}
        </button>
        <button
          onClick={() => {
            if (!state.roast) return;
            const blob = new Blob([JSON.stringify(state.roast)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "roast.json";
            a.click();
            URL.revokeObjectURL(url);
          }}
          disabled={state.currentState.status !== RoasterStatus.idle || !state.roast?.measurements.length}
        >
          Download
        </button>
        <input
          type="file"
          accept="application/json"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (evt) => {
              try {
                const roast = JSON.parse((evt.target?.result as string) || "{}", dateReviver) as RoastState;
                setState((prev) => ({ ...prev, roast }));
                if (chartRef.current) {
                  updateChart(chartRef.current, roast);
                }
              } catch (error) {
                console.error("upload failed", error);
              }
            };
            reader.readAsText(file);
          }}
          disabled={state.currentState.status === RoasterStatus.roasting}
        />
        <span> Roast time: {roastTime}</span>
      </div>

      <canvas id="liveChart" ref={chartCanvasRef} />

      <div class="control_cluster">
        <div>
          Setpoint (°C): {setpoint}
          <input
            type="range"
            min="0"
            max="300"
            disabled={profileStore.followProfileEnabled}
            value={setpoint}
            onInput={(e) => {
              const value = Number((e.target as HTMLInputElement).value);
              setSetpoint(value);
              sendPidControlConfig(state.currentState.status);
            }}
          />
        </div>

        <div>
          FAN 1: {fan}%
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={fan}
            onInput={(e) => {
              const value = Number((e.target as HTMLInputElement).value);
              setFan(value);
              updateFanPower(value);
            }}
          />
        </div>

        <div>
          HEATER: {heater}%
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            disabled={pidEnabled}
            value={heater}
            onInput={(e) => {
              const value = Number((e.target as HTMLInputElement).value);
              setHeater(value);
              updateHeaterPower(value);
            }}
          />
        </div>
      </div>

      <div>
        {[
          ["charge", "Charge"],
          ["dry-end", "Dry End"],
          ["first-crack-start", "First crack start"],
          ["first-crack-end", "First crack end"],
          ["second-crack-start", "Second crack start"],
          ["second-crack-end", "Second crack end"],
          ["drop", "Drop"],
        ].map(([key, text]) => (
          <button key={key} onClick={() => appendEvent(key)}>
            {text}
          </button>
        ))}
      </div>

      <p>
        ET: {lastMessage?.ET ?? "N/A"} BT: {lastMessage?.BT ?? "N/A"} Sim BT: {lastMessage?.simBT?.toFixed(1) ?? "N/A"} BT
        RoR: {btRoR?.toFixed(2) ?? "N/A"} °C/min ET RoR: {etRoR?.toFixed(2) ?? "N/A"} °C/min
      </p>
      <p>Last update: {lastUpdate?.toString() ?? "N/A"}</p>

      <div>
        PID current values: Temp {lastMessage?.pidCurrentTemp?.toFixed(2) ?? "N/A"} | Error {lastMessage?.pidError?.toFixed(2) ?? "N/A"} |
        Integral {lastMessage?.pidIntegral?.toFixed(2) ?? "N/A"} | Derivative {lastMessage?.pidDerivative?.toFixed(2) ?? "N/A"} | Output
        {" "}
        {lastMessage?.pidOutput?.toFixed(2) ?? "N/A"}
      </div>

      <div>
        <h3>PID Factors</h3>
        <p>
          P <input type="number" value={kp} onInput={(e) => setKp(Number((e.target as HTMLInputElement).value) || 0)} />
          I <input type="number" value={ki} onInput={(e) => setKi(Number((e.target as HTMLInputElement).value) || 0)} />
          D <input type="number" value={kd} onInput={(e) => setKd(Number((e.target as HTMLInputElement).value) || 0)} />
        </p>
        <p>
          Target
          <select value={pidTarget} onChange={(e) => setPidTarget((e.target as HTMLSelectElement).value as PidTarget)}>
            <option value="BT">BT</option>
            <option value="ET">ET</option>
            <option value="simBT">Sim BT</option>
          </select>
        </p>
        <button
          onClick={() => {
            sendCommand({
              id: 1,
              command: "setPreferences",
              pidTarget,
              pidKp: kp,
              pidKi: ki,
              pidKd: kd,
            });
          }}
        >
          Apply pid
        </button>
        <label>
          <input
            type="checkbox"
            checked={pidEnabled}
            onChange={(e) => {
              setPidEnabled(e.currentTarget.checked);
              sendPidControlConfig(state.currentState.status, e.currentTarget.checked);
            }}
          />
          PID Enabled
        </label>
      </div>

      <div class="section">
        <h3>Profile Selection</h3>
        <ProfileControl onStateChange={() => setRefreshToken((v) => v + 1)} />
      </div>
      <div style="display:none">{refreshToken}</div>
    </div>
  );
}
