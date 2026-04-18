import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { RoastGraphs } from "./graphs";
import { getAdminSecret } from "./auth";
import { getFormattedTimeDifference } from "./util";
import { Measurement, RoastState, RoasterStatus, YaegerState } from "./model";
import { followProfile, ProfileControl, profileStore, ROAST_EVENT_TAGS } from "./profiling";
import { sendWsCommand, useSocketState } from "./websocket";

type PidTarget = "BT" | "ET" | "simBT";
type ControlMode = "pid" | "adrc";

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
  const { connectionStatus, lastData, lastMessage, lastUpdate } = useSocketState();
  const [state, setState] = useState<YaegerState>(initialState);
  const [fan, setFan] = useState(50);
  const [heater, setHeater] = useState(50);
  const [setpoint, setSetpoint] = useState(20);
  const [setpointTarget, setSetpointTarget] = useState(20);
  const [kp, setKp] = useState(1.0);
  const [ki, setKi] = useState(0.1);
  const [kd, setKd] = useState(0.01);
  const [adrcB0, setAdrcB0] = useState(0.02);
  const [adrcW0, setAdrcW0] = useState(1.0);
  const [adrcWc, setAdrcWc] = useState(0.25);
  const [controlFanMin, setControlFanMin] = useState(30);
  const [controlFanMax, setControlFanMax] = useState(80);
  const [pidEnabled, setPidEnabled] = useState(false);
  const [roastControlActive, setRoastControlActive] = useState(false);
  const [pidTarget, setPidTarget] = useState<PidTarget>("BT");
  const [controlMode, setControlMode] = useState<ControlMode>("pid");
  const [isEditingPid, setIsEditingPid] = useState(false);
  const hasHydratedPidFromTelemetry = useRef(false);
  const pidSyncPausedUntilMs = useRef(0);
  const [refreshToken, setRefreshToken] = useState(0);
  const [graphHeightScale, setGraphHeightScale] = useState(1.2);
  const controlModeDirty = useRef(false);
  const controlFanBoundsDirty = useRef(false);
  const sendCommand = (data: Record<string, unknown>) => {
    const authToken = getAdminSecret();
    sendWsCommand({ ...data, authToken });
  };

  const requestRoastHistory = () => {
    sendWsCommand({ id: 1, command: "getRoastHistory" });
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

  const sendPidControlConfig = (
    status = state.currentState.status,
    pidOn = pidEnabled,
    setpointValue = setpointTarget,
  ) => {
    const fanBounds = normalizeFanBounds(controlFanMin, controlFanMax);
    if (fanBounds.min !== controlFanMin) setControlFanMin(fanBounds.min);
    if (fanBounds.max !== controlFanMax) setControlFanMax(fanBounds.max);
    sendCommand({
      id: 1,
      command: "setPidControl",
      setpoint: setpointValue,
      pidEnabled: pidOn && status === RoasterStatus.roasting,
      pidTarget,
      controlMode,
      controlFanMin: fanBounds.min,
      controlFanMax: fanBounds.max,
      adrcB0,
      adrcW0,
      adrcWc,
    });
  };

  useEffect(() => {
    if (!lastMessage || !lastUpdate) return;

    setFan(lastMessage.FanVal);
    setHeater(lastMessage.BurnerVal);
    if (typeof lastMessage.setpoint === "number") {
      setSetpoint(lastMessage.setpoint);
    }

    setState((prev) => {
      const next: YaegerState = {
        ...prev,
        currentState: { ...prev.currentState, lastMessage, lastUpdate },
      };

      if (prev.roast && prev.currentState.status === RoasterStatus.roasting) {
        const measurement: Measurement = {
          timestamp: lastUpdate,
          message: lastMessage,
          extra: {
            setpoint: lastMessage.setpoint ?? setpointTarget,
            pidData: { enabled: pidEnabled, kp, ki, kd },
          },
        };
        next.roast = {
          ...prev.roast,
          measurements: [...prev.roast.measurements, measurement],
        };

        if (profileStore.profile && profileStore.followProfileEnabled && roastControlActive) {
          const profileUpdate = followProfile(profileStore.profile, next.roast);
          if (profileUpdate) {
            setSetpointTarget(profileUpdate.setPoint);
            sendPidControlConfig(prev.currentState.status, pidEnabled, profileUpdate.setPoint);
            if (profileUpdate.fanValue != null) {
              setFan(profileUpdate.fanValue);
              updateFanPower(profileUpdate.fanValue);
            }
          }
        }

      }

      return next;
    });
  }, [kd, ki, kp, lastMessage, lastUpdate, pidEnabled, roastControlActive, setpointTarget]);

  useEffect(() => {
    if (connectionStatus === "Connected") {
      requestRoastHistory();
    }
  }, [connectionStatus]);

  useEffect(() => {
    if (!lastData || lastData.type !== "roastHistory") return;
    if (state.roast?.measurements?.length) return;

    const samples = Array.isArray(lastData.samples) ? lastData.samples : [];
    if (!samples.length) return;

    const latestMs = Number((samples[samples.length - 1] as Record<string, unknown>).ms ?? 0);
    if (!Number.isFinite(latestMs) || latestMs <= 0) return;
    const nowMs = Date.now();
    const startDate = new Date(nowMs - latestMs);

    const measurements: Measurement[] = samples
      .map((entry): Measurement | null => {
        const sample = entry as Record<string, unknown>;
        const sampleMs = Number(sample.ms ?? 0);
        if (!Number.isFinite(sampleMs)) return null;
        return {
          timestamp: new Date(nowMs - (latestMs - sampleMs)),
          message: {
            id: 1,
            ET: Number(sample.ET ?? NaN),
            BT: Number(sample.BT ?? NaN),
            simBT: Number(sample.simBT ?? NaN),
            Amb: Number(sample.Amb ?? NaN),
            BurnerVal: Number(sample.BurnerVal ?? 0),
            FanVal: Number(sample.FanVal ?? 0),
          },
          extra: {
            setpoint: Number(sample.setpoint ?? 0),
            pidData: {
              enabled: Boolean(sample.pidEnabled),
              kp,
              ki,
              kd,
            },
          },
        };
      })
      .filter((m): m is Measurement => m != null);

    if (!measurements.length) return;
    const recoveredSetpoint = Number(
      (samples[samples.length - 1] as Record<string, unknown>).setpoint ?? 20,
    );
    if (Number.isFinite(recoveredSetpoint)) {
      setSetpoint(recoveredSetpoint);
      setSetpointTarget(recoveredSetpoint);
    }
    setState((prev) => ({
      ...prev,
      currentState: {
        ...prev.currentState,
        status: Boolean(lastData.active) ? RoasterStatus.roasting : RoasterStatus.idle,
      },
      roast: {
        startDate,
        measurements,
        events: [],
        commands: [],
        profile: prev.roast?.profile ?? profileStore.profile,
      },
    }));
  }, [kd, ki, kp, lastData, state.roast?.measurements?.length]);

  useEffect(() => {
    const shouldSyncPidFromDevice = !isEditingPid && Date.now() >= pidSyncPausedUntilMs.current;
    if (!hasHydratedPidFromTelemetry.current && shouldSyncPidFromDevice) {
      let hydratedAny = false;
      if (typeof lastMessage?.pidKpActive === "number") {
        setKp(lastMessage.pidKpActive);
        hydratedAny = true;
      }
      if (typeof lastMessage?.pidKiActive === "number") {
        setKi(lastMessage.pidKiActive);
        hydratedAny = true;
      }
      if (typeof lastMessage?.pidKdActive === "number") {
        setKd(lastMessage.pidKdActive);
        hydratedAny = true;
      }
      if (hydratedAny) hasHydratedPidFromTelemetry.current = true;
    }
    if (lastMessage?.pidTarget) setPidTarget(lastMessage.pidTarget);
    if (typeof lastMessage?.adrcB0 === "number") setAdrcB0(lastMessage.adrcB0);
    if (typeof lastMessage?.adrcW0 === "number") setAdrcW0(lastMessage.adrcW0);
    if (typeof lastMessage?.adrcWc === "number") setAdrcWc(lastMessage.adrcWc);
    if (typeof lastMessage?.controlFanMin === "number" && typeof lastMessage?.controlFanMax === "number") {
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
    if (lastMessage?.controlMode === "pid" || lastMessage?.controlMode === "adrc") {
      if (!controlModeDirty.current) {
        setControlMode(lastMessage.controlMode);
      } else if (lastMessage.controlMode === controlMode) {
        controlModeDirty.current = false;
      }
    }
  }, [controlFanMax, controlFanMin, controlMode, isEditingPid, lastMessage]);

  useEffect(() => {
    const onPidUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ kp?: number; ki?: number; kd?: number; pidTarget?: PidTarget }>;
      if (typeof customEvent.detail?.kp === "number") setKp(customEvent.detail.kp);
      if (typeof customEvent.detail?.ki === "number") setKi(customEvent.detail.ki);
      if (typeof customEvent.detail?.kd === "number") setKd(customEvent.detail.kd);
      if (customEvent.detail?.pidTarget) setPidTarget(customEvent.detail.pidTarget);
    };
    window.addEventListener("pid-preferences-updated", onPidUpdated);
    return () => window.removeEventListener("pid-preferences-updated", onPidUpdated);
  }, []);

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
    if (!Number.isFinite(latest.message.BT) || !Number.isFinite(prev.message.BT)) return null;
    const elapsed = (latest.timestamp.getTime() - prev.timestamp.getTime()) / 1000;
    return elapsed > 0 ? ((latest.message.BT - prev.message.BT) / elapsed) * 60 : null;
  }, [state.roast]);

  const etRoR = useMemo(() => {
    const m = state.roast?.measurements ?? [];
    if (m.length < 2) return null;
    const latest = m[m.length - 1];
    const prev = m[m.length - 2];
    if (!Number.isFinite(latest.message.ET) || !Number.isFinite(prev.message.ET)) return null;
    const elapsed = (latest.timestamp.getTime() - prev.timestamp.getTime()) / 1000;
    return elapsed > 0 ? ((latest.message.ET - prev.message.ET) / elapsed) * 60 : null;
  }, [state.roast]);

  const formatMetric = (value: number | null | undefined, digits = 2) =>
    typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "N/A";
  const effectiveControlMode = lastMessage?.controlMode ?? controlMode;
  const controllerCommand =
    effectiveControlMode === "adrc"
      ? lastMessage?.adrcLastCommand ?? lastMessage?.pidOutputSmoothed
      : lastMessage?.pidOutputSmoothed;

  const forceStopRoastControl = (status = state.currentState.status) => {
    setRoastControlActive(false);
    setPidEnabled(false);
    profileStore.followProfileEnabled = false;
    setRefreshToken((v) => v + 1);
    setSetpointTarget(0);
    setHeater(0);
    sendCommand({ id: 1, BurnerVal: 0 });
    sendPidControlConfig(status, false, 0);
  };

  useEffect(() => {
    const onEmergencyStop = () => {
      forceStopRoastControl(RoasterStatus.roasting);
      setState((prev) => ({
        ...prev,
        currentState: { ...prev.currentState, status: RoasterStatus.idle },
      }));
    };
    window.addEventListener("emergency-stop", onEmergencyStop);
    return () => window.removeEventListener("emergency-stop", onEmergencyStop);
  }, []);

  const toggleRoastRecording = () => {
    if (state.currentState.status === RoasterStatus.idle) {
      setState((prev) => ({
        ...prev,
        currentState: { ...prev.currentState, status: RoasterStatus.roasting },
        roast: {
          startDate: new Date(),
          measurements: [],
          events: [],
          commands: [],
          profile: profileStore.profile,
        },
      }));
      setRoastControlActive(false);
      sendCommand({ id: 1, command: "startRoastSession" });
      sendPidControlConfig(RoasterStatus.roasting, false);
      return;
    }

    if (roastControlActive || pidEnabled || profileStore.followProfileEnabled) {
      forceStopRoastControl(RoasterStatus.roasting);
    }

    setState((prev) => ({
      ...prev,
      currentState: { ...prev.currentState, status: RoasterStatus.idle },
      roast: prev.roast,
    }));
    sendCommand({ id: 1, command: "endRoastSession" });
    sendPidControlConfig(RoasterStatus.idle, false);
  };

  const clearRoastGraph = () => {
    sendCommand({ id: 1, command: "clearRoastHistory" });
    setState((prev) => ({
      ...prev,
      currentState: { ...prev.currentState, status: RoasterStatus.idle },
      roast: undefined,
    }));
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

  const onProfileStateChange = () => {
    setRefreshToken((v) => v + 1);
    setState((prev) =>
      prev.roast
        ? {
            ...prev,
            roast: {
              ...prev.roast,
              profile: profileStore.profile,
            },
          }
        : prev,
    );
  };

  return (
    <div class="roast-dashboard">
      <div class="roast-toolbar">
        <button onClick={toggleRoastRecording}>
          {state.currentState.status === RoasterStatus.idle ? "Start logging" : "Stop logging"}
        </button>
        <button
          onClick={() => {
            const nextControlState = !roastControlActive;
            if (!nextControlState) {
              forceStopRoastControl(state.currentState.status);
              return;
            }

            setRoastControlActive(true);
            sendPidControlConfig(state.currentState.status, pidEnabled, setpointTarget);
          }}
          disabled={state.currentState.status !== RoasterStatus.roasting}
        >
          {roastControlActive ? "Stop roasting" : "Start roasting"}
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
        <button
          onClick={clearRoastGraph}
          disabled={state.currentState.status === RoasterStatus.roasting}
        >
          Clear graph
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
              } catch (error) {
                console.error("upload failed", error);
              }
            };
            reader.readAsText(file);
          }}
          disabled={state.currentState.status === RoasterStatus.roasting}
        />
        <span class="roast-time-pill">Roast time: {roastTime}</span>
        <label class="graph-height-control">
          Graph height
          <input
            type="range"
            min="70"
            max="180"
            step="10"
            value={Math.round(graphHeightScale * 100)}
            onInput={(e) => setGraphHeightScale(Number((e.target as HTMLInputElement).value) / 100)}
          />
          <span>{Math.round(graphHeightScale * 100)}%</span>
        </label>
      </div>

      <section class="telemetry-panel">
        <div class="telemetry-header">
          <h2>Live telemetry</h2>
          <span class="last-update">Last update: {lastUpdate?.toString() ?? "N/A"}</span>
        </div>
        <div class="telemetry-grid">
          <div class="metric-card">
            <span>ET</span>
            <strong>{formatMetric(lastMessage?.ET, 3)} °C</strong>
          </div>
          <div class="metric-card">
            <span>BT</span>
            <strong>{formatMetric(lastMessage?.BT, 3)} °C</strong>
          </div>
          <div class="metric-card">
            <span>Sim BT</span>
            <strong>{formatMetric(lastMessage?.simBT, 1)} °C</strong>
          </div>
          <div class="metric-card">
            <span>BT RoR</span>
            <strong>{formatMetric(btRoR, 2)} °C/min</strong>
          </div>
          <div class="metric-card">
            <span>ET RoR</span>
            <strong>{formatMetric(etRoR, 2)} °C/min</strong>
          </div>
        </div>

        <div class="controller-summary">
          <h3>Controller</h3>
          <div class="pid-grid">
            <span>Mode {effectiveControlMode.toUpperCase()}</span>
            <span>Target {lastMessage?.pidTarget ?? pidTarget}</span>
            <span>Temp {formatMetric(lastMessage?.pidCurrentTemp, 2)} °C</span>
            <span>Error {formatMetric(lastMessage?.pidError, 2)} °C</span>
            <span>Setpoint {formatMetric(lastMessage?.setpoint ?? setpointTarget, 1)} °C</span>
            <span>Command {formatMetric(controllerCommand, 2)}%</span>
            <span>Fan range {formatMetric(lastMessage?.controlFanMin ?? controlFanMin, 0)}-{formatMetric(lastMessage?.controlFanMax ?? controlFanMax, 0)}%</span>
          </div>
          <details class="controller-diagnostics roast-controller-diagnostics">
            <summary>Debug values</summary>
            <div class="pid-grid">
              {effectiveControlMode === "adrc" ? (
                <>
                  <span>Observer z1 {formatMetric(lastMessage?.adrcZ1 ?? lastMessage?.pidPredictedTemp, 2)} °C</span>
                  <span>Slope z2 {formatMetric(lastMessage?.adrcZ2, 4)} °C/s</span>
                  <span>Disturbance z3 {formatMetric(lastMessage?.adrcZ3, 4)}</span>
                  <span>Raw heater {formatMetric(lastMessage?.pidOutput, 2)}%</span>
                  <span>Command {formatMetric(lastMessage?.adrcLastCommand ?? lastMessage?.pidOutputSmoothed, 2)}%</span>
                  <span>b0 {formatMetric(lastMessage?.adrcB0 ?? adrcB0, 4)}</span>
                  <span>w0 {formatMetric(lastMessage?.adrcW0 ?? adrcW0, 4)}</span>
                  <span>wc {formatMetric(lastMessage?.adrcWc ?? adrcWc, 4)}</span>
                </>
              ) : (
                <>
                  <span>Pred Temp {formatMetric(lastMessage?.pidPredictedTemp, 2)} °C</span>
                  <span>Integral {formatMetric(lastMessage?.pidIntegral, 2)}</span>
                  <span>Derivative {formatMetric(lastMessage?.pidDerivative, 2)}</span>
                  <span>Output {formatMetric(lastMessage?.pidOutput, 2)}%</span>
                  <span>Smoothed {formatMetric(lastMessage?.pidOutputSmoothed, 2)}%</span>
                  <span>Delay {formatMetric(lastMessage?.pidProcessDelaySec, 2)}s</span>
                  <span>Predictor {lastMessage?.pidPredictorEnabled ? "On" : "Off"}</span>
                </>
              )}
            </div>
          </details>
        </div>
      </section>

      <RoastGraphs
        roast={state.roast}
        heightScale={graphHeightScale}
        profile={profileStore.profile}
      />

      <section class="control-panel">
        <h3>Roast controls</h3>
        <div class="slider-grid">
          <div class="slider-card">
            <div class="slider-header">
              <span>Setpoint</span>
              <strong>{setpointTarget} °C</strong>
            </div>
            <small class="setpoint-current">Current: {setpoint.toFixed(1)} °C</small>
          <input
            type="range"
            min="0"
            max="300"
            disabled={profileStore.followProfileEnabled}
            value={setpointTarget}
            onInput={(e) => {
              const value = Number((e.target as HTMLInputElement).value);
              setSetpointTarget(value);
            }}
            onChange={(e) => {
              const value = Number((e.target as HTMLInputElement).value);
              setSetpointTarget(value);
              sendPidControlConfig(state.currentState.status, pidEnabled && roastControlActive, value);
            }}
          />
          </div>

          <div class="slider-card">
            <div class="slider-header">
              <span>FAN 1</span>
              <strong>{fan}%</strong>
            </div>
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

          <div class="slider-card">
            <div class="slider-header">
              <span>HEATER</span>
              <strong>{heater}%</strong>
            </div>
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
      </section>

      <section class="section">
        <h3>Roast events</h3>
        <div class="event-buttons">
          {ROAST_EVENT_TAGS.map((tag) => (
            <button key={tag.key} onClick={() => appendEvent(tag.key)}>
              {tag.label}
            </button>
          ))}
        </div>
      </section>

      <div class="section">
        <h3>Controller Factors</h3>
        <div class="form-grid">
          {controlMode === "pid" ? (
            <>
              <label>P</label>
              <input
                type="number"
                value={kp}
                onFocus={() => setIsEditingPid(true)}
                onBlur={() => setIsEditingPid(false)}
                onInput={(e) => setKp(Number((e.target as HTMLInputElement).value) || 0)}
              />
              <label>I</label>
              <input
                type="number"
                value={ki}
                onFocus={() => setIsEditingPid(true)}
                onBlur={() => setIsEditingPid(false)}
                onInput={(e) => setKi(Number((e.target as HTMLInputElement).value) || 0)}
              />
              <label>D</label>
              <input
                type="number"
                value={kd}
                onFocus={() => setIsEditingPid(true)}
                onBlur={() => setIsEditingPid(false)}
                onInput={(e) => setKd(Number((e.target as HTMLInputElement).value) || 0)}
              />
            </>
          ) : (
            <>
              <label>b0</label>
              <input type="number" value={adrcB0} onInput={(e) => setAdrcB0(Number((e.target as HTMLInputElement).value) || 0)} />
              <label>w0</label>
              <input type="number" value={adrcW0} onInput={(e) => setAdrcW0(Number((e.target as HTMLInputElement).value) || 0)} />
              <label>wc</label>
              <input type="number" value={adrcWc} onInput={(e) => setAdrcWc(Number((e.target as HTMLInputElement).value) || 0)} />
            </>
          )}
          <label>Target</label>
          <select value={pidTarget} onChange={(e) => setPidTarget((e.target as HTMLSelectElement).value as PidTarget)}>
            <option value="BT">BT</option>
            <option value="ET">ET</option>
            <option value="simBT">Sim BT</option>
          </select>
          <label>Control</label>
          <select
            value={controlMode}
            onChange={(e) => {
              controlModeDirty.current = true;
              setControlMode((e.target as HTMLSelectElement).value as ControlMode);
            }}
          >
            <option value="pid">PID</option>
            <option value="adrc">ADRC</option>
          </select>
          <label>Auto fan min</label>
          <input
            type="number"
            value={controlFanMin}
            onInput={(e) => {
              controlFanBoundsDirty.current = true;
              setControlFanMin(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
          <label>Auto fan max</label>
          <input
            type="number"
            value={controlFanMax}
            onInput={(e) => {
              controlFanBoundsDirty.current = true;
              setControlFanMax(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
        </div>
        <div class="inline-actions">
          <button
            onClick={() => {
              const fanBounds = normalizeFanBounds(controlFanMin, controlFanMax);
              setControlFanMin(fanBounds.min);
              setControlFanMax(fanBounds.max);
              pidSyncPausedUntilMs.current = Date.now() + 3000;
              sendCommand({
                id: 1,
                command: "setPreferences",
                pidTarget,
                pidKp: kp,
                pidKi: ki,
                pidKd: kd,
              });
              sendCommand({
                id: 1,
                command: "setPidControl",
                controlMode,
                pidTarget,
                controlFanMin: fanBounds.min,
                controlFanMax: fanBounds.max,
                adrcB0,
                adrcW0,
                adrcWc,
              });
              window.dispatchEvent(
                new CustomEvent("pid-preferences-updated", {
                  detail: { kp, ki, kd, pidTarget },
                }),
              );
            }}
          >
            Apply controller
          </button>
          <label class="switch-label">
            <input
              type="checkbox"
              checked={pidEnabled}
              onChange={(e) => {
                setPidEnabled(e.currentTarget.checked);
                sendPidControlConfig(state.currentState.status, e.currentTarget.checked && roastControlActive);
              }}
            />
            Controller Enabled
          </label>
        </div>
      </div>

      <div class="section">
        <h3>Profile Selection</h3>
        <ProfileControl onStateChange={onProfileStateChange} />
      </div>
      <div style="display:none">{refreshToken}</div>
    </div>
  );
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
