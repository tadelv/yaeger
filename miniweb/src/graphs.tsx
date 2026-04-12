import { useEffect, useMemo, useRef } from "preact/hooks";
import uPlot, { Options, Plugin } from "uplot";
import "uplot/dist/uPlot.min.css";
import { RoastState } from "./model";

export type RoastGraphMode = "combined" | "separate";

type EventMarker = { label: string; sec: number };

type UPlotChartProps = {
  title: string;
  options: Options;
  data: uPlot.AlignedData;
  events?: EventMarker[];
};

function buildRoR(values: number[], timeSeconds: number[], windowSize = 20): Array<number | null> {
  const rate = values.map((temp, i) => {
    if (i === 0) return null;
    const deltaT = temp - values[i - 1];
    const deltaS = timeSeconds[i] - timeSeconds[i - 1];
    return deltaS > 0 ? (deltaT / deltaS) * 60 : null;
  });

  return rate.map((value, i, arr) => {
    if (value == null || i < windowSize - 1) return value;
    const window = arr.slice(i - windowSize + 1, i + 1).filter((v): v is number => typeof v === "number");
    if (!window.length) return null;
    return window.reduce((sum, v) => sum + v, 0) / window.length;
  });
}

function buildEventPlugin(events: EventMarker[]): Plugin {
  return {
    hooks: {
      draw: [(u) => {
        if (!events.length) return;
        const { ctx, bbox } = u;
        ctx.save();
        ctx.strokeStyle = "#ef4444";
        ctx.fillStyle = "#fca5a5";
        ctx.font = "10px sans-serif";
        events.forEach((event) => {
          const x = Math.round(u.valToPos(event.sec, "x", true));
          if (x < bbox.left || x > bbox.left + bbox.width) return;
          ctx.beginPath();
          ctx.setLineDash([4, 3]);
          ctx.moveTo(x, bbox.top);
          ctx.lineTo(x, bbox.top + bbox.height);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillText(event.label, x + 2, bbox.top + 11);
        });
        ctx.restore();
      }],
    },
  };
}

function UPlotChart({ title, options, data, events = [] }: UPlotChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);

  const finalOptions = useMemo<Options>(() => {
    const basePlugins = options.plugins ?? [];
    const plugins = events.length ? [...basePlugins, buildEventPlugin(events)] : basePlugins;
    return { ...options, plugins };
  }, [events, options]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    chartRef.current = new uPlot(finalOptions, data, host);
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [data, finalOptions]);

  return (
    <div class="graph-card">
      <h4>{title}</h4>
      <div ref={hostRef} class="uplot-host" />
    </div>
  );
}

function makeBaseOptions(height: number): Options {
  return {
    width: 900,
    height,
    scales: { x: { time: false } },
    series: [{ label: "Time (s)" }],
    axes: [
      {
        stroke: "#94a3b8",
        grid: { stroke: "#334155" },
      },
      {
        stroke: "#cbd5e1",
        grid: { stroke: "#334155" },
      },
    ],
    legend: { show: true },
  };
}

export function RoastGraphs({
  roast,
  mode = "separate",
  heightScale = 1,
}: {
  roast?: RoastState;
  mode?: RoastGraphMode;
  heightScale?: number;
}) {
  const measurements = roast?.measurements ?? [];
  const start = roast?.startDate;
  if (!start || measurements.length < 2) {
    return <div class="graph-empty">Live roast graphs will appear after the roast starts.</div>;
  }

  const t = measurements.map((m) => (m.timestamp.getTime() - start.getTime()) / 1000);
  const bt = measurements.map((m) => m.message.BT);
  const et = measurements.map((m) => m.message.ET);
  const setpoint = measurements.map((m) => m.extra?.setpoint ?? 0);
  const fan = measurements.map((m) => m.message.FanVal);
  const heater = measurements.map((m) => m.message.BurnerVal);
  const btRor = buildRoR(bt, t).map((v) => v ?? null);
  const etRor = buildRoR(et, t).map((v) => v ?? null);

  const eventTimes = (roast?.events ?? []).map((event) => ({
    label: String(event.label),
    sec: (event.measurement.timestamp.getTime() - start.getTime()) / 1000,
  }));

  const clampedHeightScale = Math.min(1.8, Math.max(0.7, heightScale));
  const separateHeight = Math.round(300 * clampedHeightScale);
  const combinedHeight = Math.round(380 * clampedHeightScale);

  if (mode === "combined") {
    const options: Options = {
      ...makeBaseOptions(combinedHeight),
      scales: {
        x: { time: false },
        temp: { auto: false, range: [0, 300] },
        power: { auto: false, range: [0, 100] },
        ror: { auto: false, range: [-5, 60] },
      },
      series: [
        { label: "Time (s)" },
        { label: "BT", stroke: "#60a5fa", scale: "temp" },
        { label: "ET", stroke: "#f87171", scale: "temp" },
        { label: "Setpoint", stroke: "#34d399", scale: "temp" },
        { label: "Fan %", stroke: "#38bdf8", scale: "power" },
        { label: "Heater %", stroke: "#fb923c", scale: "power" },
        { label: "BT RoR", stroke: "#22c55e", scale: "ror" },
        { label: "ET RoR", stroke: "#a855f7", scale: "ror" },
      ],
      axes: [
        { stroke: "#94a3b8", grid: { stroke: "#334155" } },
        { stroke: "#cbd5e1", scale: "temp", label: "Temp (°C)", grid: { stroke: "#334155" } },
        { stroke: "#cbd5e1", scale: "power", side: 1, label: "Power (%)", grid: { show: false } },
        { stroke: "#cbd5e1", scale: "ror", side: 1, label: "RoR (°C/min)", grid: { show: false } },
      ],
    };

    return (
      <UPlotChart
        title="Combined Roast Telemetry"
        options={options}
        data={[t, bt, et, setpoint, fan, heater, btRor, etRor]}
        events={eventTimes}
      />
    );
  }

  const tempOptions: Options = {
    ...makeBaseOptions(separateHeight),
    scales: { x: { time: false }, y: { auto: false, range: [0, 300] } },
    series: [
      { label: "Time (s)" },
      { label: "BT", stroke: "#60a5fa" },
      { label: "ET", stroke: "#f87171" },
      { label: "Setpoint", stroke: "#34d399" },
    ],
  };

  const powerOptions: Options = {
    ...makeBaseOptions(separateHeight),
    scales: { x: { time: false }, y: { auto: false, range: [0, 100] } },
    series: [
      { label: "Time (s)" },
      { label: "Fan %", stroke: "#38bdf8" },
      { label: "Heater %", stroke: "#fb923c" },
    ],
  };

  const rorOptions: Options = {
    ...makeBaseOptions(separateHeight),
    scales: { x: { time: false }, y: { auto: false, range: [-5, 60] } },
    series: [
      { label: "Time (s)" },
      { label: "BT RoR", stroke: "#22c55e" },
      { label: "ET RoR", stroke: "#a855f7" },
    ],
  };

  return (
    <div class="graph-stack">
      <UPlotChart title="Temperature" options={tempOptions} data={[t, bt, et, setpoint]} events={eventTimes} />
      <UPlotChart title="Power" options={powerOptions} data={[t, fan, heater]} />
      <UPlotChart title="Rate of Rise" options={rorOptions} data={[t, btRor, etRor]} />
    </div>
  );
}

export function AutotuneGraph({
  history,
  target,
  setpoint,
}: {
  history: Array<{ ET: number; BT: number; simBT: number }>;
  target: "BT" | "ET" | "simBT";
  setpoint: number;
}) {
  const values = history.map((s) => (target === "ET" ? s.ET : target === "simBT" ? s.simBT : s.BT));
  const x = values.map((_, i) => i);
  const setpointLine = values.map(() => setpoint);

  const options: Options = {
    ...makeBaseOptions(320),
    scales: {
      x: { time: false },
      y: { auto: false, range: [Math.min(...values, setpoint) - 3, Math.max(...values, setpoint) + 3] },
    },
    series: [
      { label: "Sample" },
      { label: `${target} sensor`, stroke: "#22d3ee" },
      { label: "Setpoint", stroke: "#94a3b8" },
    ],
  };

  return <UPlotChart title="Autotune target trend" options={options} data={[x, values, setpointLine]} />;
}
