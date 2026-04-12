import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { RoastState } from "./model";

export type RoastGraphMode = "combined" | "separate";

type EventMarker = { label: string; sec: number };

type GraphSeries = {
  label: string;
  color: string;
  values: Array<number | null>;
};

type VisxLineGraphProps = {
  title: string;
  samples: number[];
  series: GraphSeries[];
  minY: number;
  maxY: number;
  height: number;
  eventTimes?: EventMarker[];
};

const WIDTH = 900;
const MARGIN = { top: 20, right: 20, bottom: 34, left: 52 };

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

function gridTicks(minY: number, maxY: number, count = 5) {
  const step = (maxY - minY) / count;
  return Array.from({ length: count + 1 }, (_, i) => minY + i * step);
}

function VisxLineGraph({ title, samples, series, minY, maxY, height, eventTimes = [] }: VisxLineGraphProps) {
  if (samples.length < 2) {
    return <div class="graph-empty">{title}: waiting for samples…</div>;
  }

  const innerWidth = WIDTH - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;

  const xScale = scaleLinear<number>({
    domain: [0, Math.max(1, samples[samples.length - 1])],
    range: [0, innerWidth],
  });

  const yScale = scaleLinear<number>({
    domain: [minY, maxY],
    range: [innerHeight, 0],
  });

  return (
    <div class="graph-card">
      <h4>{title}</h4>
      <svg class="line-graph" viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none">
        <rect x={0} y={0} width={WIDTH} height={height} fill="#0f172a" rx={8} />
        <Group top={MARGIN.top} left={MARGIN.left}>
          {gridTicks(minY, maxY, 5).map((tick) => (
            <line
              key={`${title}-h-${tick}`}
              x1={0}
              y1={yScale(tick)}
              x2={innerWidth}
              y2={yScale(tick)}
              stroke="rgba(148, 163, 184, 0.22)"
              strokeWidth={1}
            />
          ))}

          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const x = innerWidth * ratio;
            return (
              <line
                key={`${title}-v-${ratio}`}
                x1={x}
                y1={0}
                x2={x}
                y2={innerHeight}
                stroke="rgba(148, 163, 184, 0.14)"
                strokeWidth={1}
              />
            );
          })}

          {eventTimes.map((event) => {
            const x = xScale(event.sec);
            return (
              <g key={`${event.label}-${event.sec}`}>
                <line x1={x} y1={0} x2={x} y2={innerHeight} stroke="#ef4444" strokeDasharray="4 3" strokeWidth={1} />
                <text x={x + 2} y={12} fill="#fca5a5" fontSize={10}>{event.label}</text>
              </g>
            );
          })}

          {series.map((s) => (
            <LinePath
              key={`${title}-${s.label}`}
              data={s.values.map((v, i) => ({ x: samples[i], y: v }))}
              x={(d) => xScale(d.x)}
              y={(d) => yScale((d.y ?? minY) as number)}
              defined={(d) => d.y != null}
              stroke={s.color}
              strokeWidth={2}
              fill="none"
            />
          ))}

          <AxisBottom
            top={innerHeight}
            scale={xScale}
            numTicks={6}
            stroke="#94a3b8"
            tickStroke="#94a3b8"
            tickLabelProps={() => ({ fill: "#94a3b8", fontSize: 11, textAnchor: "middle", dy: "0.25em" })}
          />
          <AxisLeft
            scale={yScale}
            numTicks={6}
            stroke="#cbd5e1"
            tickStroke="#cbd5e1"
            tickLabelProps={() => ({ fill: "#cbd5e1", fontSize: 11, textAnchor: "end", dx: "-0.3em", dy: "0.25em" })}
          />
        </Group>
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
  const btRor = buildRoR(bt, sampleTimes);
  const etRor = buildRoR(et, sampleTimes);

  const eventTimes = (roast?.events ?? []).map((event) => ({
    label: String(event.label),
    sec: (event.measurement.timestamp.getTime() - start.getTime()) / 1000,
  }));

  const clampedHeightScale = Math.min(1.8, Math.max(0.7, heightScale));
  const separateHeight = Math.round(300 * clampedHeightScale);
  const combinedHeight = Math.round(380 * clampedHeightScale);

  if (mode === "combined") {
    return (
      <VisxLineGraph
        title="Combined Roast Telemetry"
        samples={sampleTimes}
        minY={0}
        maxY={300}
        height={combinedHeight}
        eventTimes={eventTimes}
        series={[
          { label: "BT", color: "#60a5fa", values: bt },
          { label: "ET", color: "#f87171", values: et },
          { label: "Setpoint", color: "#34d399", values: setpoint },
          { label: "Fan % (x3)", color: "#38bdf8", values: fan.map((v) => v * 3) },
          { label: "Heater % (x3)", color: "#fb923c", values: heater.map((v) => v * 3) },
          { label: "BT RoR (x5)", color: "#22c55e", values: btRor.map((v) => (v == null ? null : Math.max(v, 0) * 5)) },
          { label: "ET RoR (x5)", color: "#a855f7", values: etRor.map((v) => (v == null ? null : Math.max(v, 0) * 5)) },
        ]}
      />
    );
  }

  return (
    <div class="graph-stack">
      <VisxLineGraph
        title="Temperature"
        samples={sampleTimes}
        minY={0}
        maxY={300}
        height={separateHeight}
        eventTimes={eventTimes}
        series={[
          { label: "BT", color: "#60a5fa", values: bt },
          { label: "ET", color: "#f87171", values: et },
          { label: "Setpoint", color: "#34d399", values: setpoint },
        ]}
      />
      <VisxLineGraph
        title="Power"
        samples={sampleTimes}
        minY={0}
        maxY={100}
        height={separateHeight}
        series={[
          { label: "Fan %", color: "#38bdf8", values: fan },
          { label: "Heater %", color: "#fb923c", values: heater },
        ]}
      />
      <VisxLineGraph
        title="Rate of Rise"
        samples={sampleTimes}
        minY={-5}
        maxY={60}
        height={separateHeight}
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
    <VisxLineGraph
      title="Autotune target trend"
      samples={samples}
      minY={Math.min(...values, setpoint) - 3}
      maxY={Math.max(...values, setpoint) + 3}
      height={320}
      series={[
        { label: `${target} sensor`, color: "#22d3ee", values },
        { label: "Setpoint", color: "#94a3b8", values: values.map(() => setpoint) },
      ]}
    />
  );
}
