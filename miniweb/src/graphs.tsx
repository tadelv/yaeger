import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-basic-dist-min";
import { RoastState } from "./model";

const Plot = createPlotlyComponent(Plotly);

export type RoastGraphMode = "combined" | "separate";

type EventMarker = { label: string; sec: number };

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

function buildEventShapes(eventTimes: EventMarker[], yRef = "paper") {
  return eventTimes.map((event) => ({
    type: "line",
    x0: event.sec,
    x1: event.sec,
    y0: 0,
    y1: 1,
    xref: "x",
    yref,
    line: { color: "#ef4444", width: 1, dash: "dot" },
  }));
}

function buildEventAnnotations(eventTimes: EventMarker[], y = 1.04) {
  return eventTimes.map((event) => ({
    x: event.sec,
    y,
    xref: "x",
    yref: "paper",
    text: event.label,
    showarrow: false,
    font: { color: "#fca5a5", size: 10 },
  }));
}

function baseLayout(title: string, height: number) {
  return {
    title: { text: title, font: { size: 14 } },
    margin: { l: 50, r: 24, t: 40, b: 38 },
    paper_bgcolor: "#0f172a",
    plot_bgcolor: "#0f172a",
    font: { color: "#cbd5e1" },
    height,
    legend: { orientation: "h", y: -0.22 },
    xaxis: {
      title: "Time (s)",
      gridcolor: "#334155",
      zerolinecolor: "#334155",
      tickfont: { color: "#94a3b8" },
      titlefont: { color: "#cbd5e1" },
    },
  };
}

function PlotCard({ data, layout }: { data: any[]; layout: any }) {
  return (
    <div class="graph-card">
      <Plot
        data={data}
        layout={layout}
        useResizeHandler
        style={{ width: "100%" }}
        config={{ displaylogo: false, responsive: true }}
      />
    </div>
  );
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

  const sampleTimes = measurements.map((m) => (m.timestamp.getTime() - start.getTime()) / 1000);
  const bt = measurements.map((m) => m.message.BT);
  const et = measurements.map((m) => m.message.ET);
  const setpoint = measurements.map((m) => m.extra?.setpoint ?? 0);
  const fan = measurements.map((m) => m.message.FanVal);
  const heater = measurements.map((m) => m.message.BurnerVal);
  const btRor = buildRoR(bt, sampleTimes).map((v) => v ?? null);
  const etRor = buildRoR(et, sampleTimes).map((v) => v ?? null);

  const eventTimes = (roast?.events ?? []).map((event) => ({
    label: String(event.label),
    sec: (event.measurement.timestamp.getTime() - start.getTime()) / 1000,
  }));

  const clampedHeightScale = Math.min(1.8, Math.max(0.7, heightScale));
  const separateHeight = Math.round(290 * clampedHeightScale);
  const combinedHeight = Math.round(380 * clampedHeightScale);

  if (mode === "combined") {
    const layout = {
      ...baseLayout("Combined Roast Telemetry", combinedHeight),
      yaxis: {
        title: "Temperature (°C)",
        range: [0, 300],
        gridcolor: "#334155",
      },
      yaxis2: {
        title: "Power (%)",
        range: [0, 100],
        overlaying: "y",
        side: "right",
      },
      yaxis3: {
        title: "RoR (°C/min)",
        range: [-5, 60],
        overlaying: "y",
        side: "right",
        anchor: "free",
        position: 1,
        showgrid: false,
      },
      shapes: buildEventShapes(eventTimes),
      annotations: buildEventAnnotations(eventTimes),
    };

    const data = [
      { x: sampleTimes, y: bt, type: "scatter", mode: "lines", name: "BT", line: { color: "#60a5fa" } },
      { x: sampleTimes, y: et, type: "scatter", mode: "lines", name: "ET", line: { color: "#f87171" } },
      { x: sampleTimes, y: setpoint, type: "scatter", mode: "lines", name: "Setpoint", line: { color: "#34d399" } },
      { x: sampleTimes, y: fan, type: "scatter", mode: "lines", name: "Fan %", yaxis: "y2", line: { color: "#38bdf8" } },
      { x: sampleTimes, y: heater, type: "scatter", mode: "lines", name: "Heater %", yaxis: "y2", line: { color: "#fb923c" } },
      { x: sampleTimes, y: btRor, type: "scatter", mode: "lines", name: "BT RoR", yaxis: "y3", line: { color: "#22c55e" } },
      { x: sampleTimes, y: etRor, type: "scatter", mode: "lines", name: "ET RoR", yaxis: "y3", line: { color: "#a855f7" } },
    ];

    return <PlotCard data={data} layout={layout} />;
  }

  return (
    <div class="graph-stack">
      <PlotCard
        data={[
          { x: sampleTimes, y: bt, type: "scatter", mode: "lines", name: "BT", line: { color: "#60a5fa" } },
          { x: sampleTimes, y: et, type: "scatter", mode: "lines", name: "ET", line: { color: "#f87171" } },
          { x: sampleTimes, y: setpoint, type: "scatter", mode: "lines", name: "Setpoint", line: { color: "#34d399" } },
        ]}
        layout={{
          ...baseLayout("Temperature", separateHeight),
          yaxis: { title: "Temperature (°C)", range: [0, 300], gridcolor: "#334155" },
          shapes: buildEventShapes(eventTimes),
          annotations: buildEventAnnotations(eventTimes),
        }}
      />
      <PlotCard
        data={[
          { x: sampleTimes, y: fan, type: "scatter", mode: "lines", name: "Fan %", line: { color: "#38bdf8" } },
          { x: sampleTimes, y: heater, type: "scatter", mode: "lines", name: "Heater %", line: { color: "#fb923c" } },
        ]}
        layout={{
          ...baseLayout("Power", separateHeight),
          yaxis: { title: "Power (%)", range: [0, 100], gridcolor: "#334155" },
        }}
      />
      <PlotCard
        data={[
          { x: sampleTimes, y: btRor, type: "scatter", mode: "lines", name: "BT RoR", line: { color: "#22c55e" } },
          { x: sampleTimes, y: etRor, type: "scatter", mode: "lines", name: "ET RoR", line: { color: "#a855f7" } },
        ]}
        layout={{
          ...baseLayout("Rate of Rise", separateHeight),
          yaxis: { title: "RoR (°C/min)", range: [-5, 60], gridcolor: "#334155" },
        }}
      />
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
  const samples = values.map((_, i) => i);

  return (
    <PlotCard
      data={[
        { x: samples, y: values, type: "scatter", mode: "lines", name: `${target} sensor`, line: { color: "#22d3ee" } },
        { x: samples, y: values.map(() => setpoint), type: "scatter", mode: "lines", name: "Setpoint", line: { color: "#94a3b8" } },
      ]}
      layout={{
        ...baseLayout("Autotune target trend", 300),
        xaxis: { title: "Sample", gridcolor: "#334155" },
        yaxis: {
          title: "Temperature (°C)",
          range: [Math.min(...values, setpoint) - 3, Math.max(...values, setpoint) + 3],
          gridcolor: "#334155",
        },
      }}
    />
  );
}
