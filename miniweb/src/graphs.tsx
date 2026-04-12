import { RoastState } from "./model";

type GraphSeries = {
  label: string;
  color: string;
  values: number[];
};

type BasicLineGraphProps = {
  title: string;
  samples: number[];
  series: GraphSeries[];
  minY?: number;
  maxY?: number;
  height?: number;
  eventTimes?: Array<{ label: string; sec: number }>;
};

const VIEWBOX_WIDTH = 900;
const DEFAULT_HEIGHT = 180;
const PADDING = { top: 16, right: 16, bottom: 26, left: 34 };

function toPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
}

function describeTime(sec: number) {
  if (sec < 60) return `${sec.toFixed(0)}s`;
  return `${Math.floor(sec / 60)}m`;
}

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

function BasicLineGraph({ title, samples, series, minY, maxY, height = DEFAULT_HEIGHT, eventTimes = [] }: BasicLineGraphProps) {
  if (samples.length < 2) {
    return <div class="graph-empty">{title}: waiting for samples…</div>;
  }

  const innerWidth = VIEWBOX_WIDTH - PADDING.left - PADDING.right;
  const innerHeight = height - PADDING.top - PADDING.bottom;
  const safeMaxX = Math.max(samples[samples.length - 1], 1);

  const flat = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
  const low = minY ?? Math.min(...flat);
  const high = maxY ?? Math.max(...flat);
  const spanY = Math.max(1, high - low);

  const x = (sec: number) => PADDING.left + (sec / safeMaxX) * innerWidth;
  const y = (value: number) => PADDING.top + innerHeight - ((value - low) / spanY) * innerHeight;

  const tickSeconds = [0, safeMaxX * 0.25, safeMaxX * 0.5, safeMaxX * 0.75, safeMaxX];

  return (
    <div class="graph-card">
      <h4>{title}</h4>
      <svg class="line-graph" viewBox={`0 0 ${VIEWBOX_WIDTH} ${height}`} preserveAspectRatio="none" role="img" aria-label={title}>
        <rect x="0" y="0" width={VIEWBOX_WIDTH} height={height} fill="#0f172a" />
        <line x1={PADDING.left} y1={PADDING.top} x2={PADDING.left} y2={height - PADDING.bottom} stroke="#334155" />
        <line x1={PADDING.left} y1={height - PADDING.bottom} x2={VIEWBOX_WIDTH - PADDING.right} y2={height - PADDING.bottom} stroke="#334155" />

        {tickSeconds.map((s) => (
          <g key={`tick-${title}-${s}`}>
            <line x1={x(s)} y1={height - PADDING.bottom} x2={x(s)} y2={height - PADDING.bottom + 5} stroke="#64748b" />
            <text x={x(s)} y={height - 5} fill="#94a3b8" textAnchor="middle" fontSize="12">{describeTime(s)}</text>
          </g>
        ))}

        {eventTimes.map((event) => (
          <g key={`${event.label}-${event.sec}`}>
            <line x1={x(event.sec)} y1={PADDING.top} x2={x(event.sec)} y2={height - PADDING.bottom} stroke="#ef4444" strokeDasharray="4 3" />
            <text x={x(event.sec) + 3} y={PADDING.top + 12} fill="#fca5a5" fontSize="11">{event.label}</text>
          </g>
        ))}

        {series.map((s) => {
          const points = s.values
            .map((value, i) => ({ x: x(samples[i]), y: y(value) }))
            .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
          return <path key={s.label} d={toPath(points)} fill="none" stroke={s.color} strokeWidth="2" />;
        })}
      </svg>
      <div class="graph-legend">
        {series.map((s) => (
          <span key={`${title}-legend-${s.label}`}>
            <i style={{ backgroundColor: s.color }} /> {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export type RoastGraphMode = "combined" | "separate";

export function RoastGraphs({ roast, mode = "separate" }: { roast?: RoastState; mode?: RoastGraphMode }) {
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
  const btRor = buildRoR(bt, sampleTimes).map((v) => v ?? 0);
  const etRor = buildRoR(et, sampleTimes).map((v) => v ?? 0);

  const eventTimes = (roast?.events ?? []).map((event) => ({
    label: String(event.label),
    sec: (event.measurement.timestamp.getTime() - start.getTime()) / 1000,
  }));

  if (mode === "combined") {
    return (
      <div class="graph-stack">
        <BasicLineGraph
          title="Combined Roast Telemetry"
          samples={sampleTimes}
          minY={0}
          maxY={300}
          series={[
            { label: "BT", color: "#60a5fa", values: bt },
            { label: "ET", color: "#f87171", values: et },
            { label: "Setpoint", color: "#34d399", values: setpoint },
            { label: "Fan % (x3)", color: "#38bdf8", values: fan.map((v) => v * 3) },
            { label: "Heater % (x3)", color: "#fb923c", values: heater.map((v) => v * 3) },
            { label: "BT RoR (x5)", color: "#22c55e", values: btRor.map((v) => Math.max(0, v) * 5) },
            { label: "ET RoR (x5)", color: "#a855f7", values: etRor.map((v) => Math.max(0, v) * 5) },
          ]}
          eventTimes={eventTimes}
          height={240}
        />
      </div>
    );
  }

  return (
    <div class="graph-stack">
      <BasicLineGraph
        title="Temperature"
        samples={sampleTimes}
        minY={0}
        maxY={300}
        series={[
          { label: "BT", color: "#60a5fa", values: bt },
          { label: "ET", color: "#f87171", values: et },
          { label: "Setpoint", color: "#34d399", values: setpoint },
        ]}
        eventTimes={eventTimes}
      />
      <BasicLineGraph
        title="Power"
        samples={sampleTimes}
        minY={0}
        maxY={100}
        series={[
          { label: "Fan %", color: "#38bdf8", values: fan },
          { label: "Heater %", color: "#fb923c", values: heater },
        ]}
      />
      <BasicLineGraph
        title="Rate of Rise"
        samples={sampleTimes}
        minY={-5}
        maxY={60}
        series={[
          { label: "BT RoR", color: "#22c55e", values: btRor },
          { label: "ET RoR", color: "#a855f7", values: etRor },
        ]}
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
    <BasicLineGraph
      title="Autotune target trend"
      samples={samples}
      minY={Math.min(...values, setpoint) - 3}
      maxY={Math.max(...values, setpoint) + 3}
      series={[
        { label: `${target} sensor`, color: "#22d3ee", values },
        { label: "Setpoint", color: "#94a3b8", values: values.map(() => setpoint) },
      ]}
      height={220}
    />
  );
}
