import { Profile, ProfileStep, RoastState } from "./model";

type EventMarker = { label: string; sec: number; color?: string };

type GraphSeries = {
  label: string;
  color: string;
  samples?: number[];
  values: Array<number | null>;
};

type LineGraphProps = {
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

function createScale(domainMin: number, domainMax: number, rangeMin: number, rangeMax: number) {
  const domainSpan = domainMax - domainMin || 1;
  const rangeSpan = rangeMax - rangeMin;
  return (value: number) => rangeMin + ((value - domainMin) / domainSpan) * rangeSpan;
}

function formatTick(value: number) {
  if (Math.abs(value) >= 100 || Number.isInteger(value)) {
    return value.toFixed(0);
  }
  return value.toFixed(1);
}

function linePath(
  samples: number[],
  values: Array<number | null>,
  xScale: (value: number) => number,
  yScale: (value: number) => number,
) {
  let path = "";
  let drawing = false;

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    const sample = samples[i];
    if (value == null || sample == null || !Number.isFinite(value) || !Number.isFinite(sample)) {
      drawing = false;
      continue;
    }

    const x = xScale(sample);
    const y = yScale(value);
    path += `${drawing ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)} `;
    drawing = true;
  }

  return path.trim();
}

function buildRoR(values: number[], timeSeconds: number[], windowSize = 20): Array<number | null> {
  const rate = values.map((temp, i) => {
    if (i === 0) return null;
    const deltaT = temp - values[i - 1];
    const deltaS = timeSeconds[i] - timeSeconds[i - 1];
    const value = deltaS > 0 ? (deltaT / deltaS) * 60 : null;
    return value != null && Number.isFinite(value) ? value : null;
  });

  return rate.map((value, i, arr) => {
    if (value == null || i < windowSize - 1) return value;
    const window = arr
      .slice(i - windowSize + 1, i + 1)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (!window.length) return null;
    return window.reduce((sum, v) => sum + v, 0) / window.length;
  });
}

function gridTicks(minY: number, maxY: number, count = 5) {
  const step = (maxY - minY) / count;
  return Array.from({ length: count + 1 }, (_, i) => minY + i * step);
}

function interpolateProfileValue(
  start: number,
  end: number,
  progress: number,
  type: ProfileStep["interpolation"],
): number {
  switch (type) {
    case "linear":
      return start + (end - start) * progress;
    case "ease-in":
      return start + (end - start) * Math.pow(progress, 2);
    case "ease-out":
      return start + (end - start) * (1 - Math.pow(1 - progress, 2));
    case "ease-in-out":
      return (
        start +
        (end - start) *
          (progress < 0.5
            ? 2 * Math.pow(progress, 2)
            : 1 - Math.pow(-2 * progress + 2, 2) / 2)
      );
    default:
      return end;
  }
}

function clampProgress(value: number) {
  return Math.min(1, Math.max(0, value));
}

function getProfileSetpointAtElapsed(profile: Profile, elapsedSeconds: number): number | null {
  if (!profile.steps.length) return null;
  let accumulated = 0;

  for (let i = 0; i < profile.steps.length; i += 1) {
    const step = profile.steps[i];
    const stepStart = accumulated;
    accumulated += step.duration;
    if (elapsedSeconds <= accumulated) {
      const progress = step.duration > 0 ? (elapsedSeconds - stepStart) / step.duration : 1;
      const previousSetpoint = i === 0 ? step.setpoint : profile.steps[i - 1].setpoint;
      return interpolateProfileValue(previousSetpoint, step.setpoint, clampProgress(progress), step.interpolation);
    }
  }

  return profile.steps[profile.steps.length - 1].setpoint;
}

function getProfileFanAtElapsed(profile: Profile, elapsedSeconds: number): number | null {
  if (!profile.steps.length) return null;
  let accumulated = 0;

  for (const step of profile.steps) {
    accumulated += Math.max(0, step.duration);
    if (elapsedSeconds <= accumulated) {
      return typeof step.fanValue === "number" ? step.fanValue : null;
    }
  }

  const lastStep = profile.steps[profile.steps.length - 1];
  return typeof lastStep.fanValue === "number" ? lastStep.fanValue : null;
}

function getProfileTotalDuration(profile: Profile) {
  return profile.steps.reduce((sum, step) => sum + Math.max(0, step.duration), 0);
}

function buildProfileSamples(profile: Profile) {
  const totalDuration = Math.max(1, Math.ceil(getProfileTotalDuration(profile)));
  const sampleStep = Math.max(1, Math.ceil(totalDuration / 360));
  const samples = new Set<number>([0, totalDuration]);

  for (let seconds = 0; seconds <= totalDuration; seconds += sampleStep) {
    samples.add(seconds);
  }

  let accumulated = 0;
  for (const step of profile.steps) {
    accumulated += Math.max(0, step.duration);
    samples.add(Math.min(totalDuration, Math.max(0, Math.round(accumulated))));
  }

  return [...samples].sort((a, b) => a - b);
}

function getProfileMarkers(profile: Profile): EventMarker[] {
  let accumulated = 0;
  return profile.steps.map((step, index) => {
    const marker = {
      label: step.name || step.tag || `Phase ${index + 1}`,
      sec: accumulated,
      color: "#facc15",
    };
    accumulated += Math.max(0, step.duration);
    return marker;
  });
}

function hasDrawableSeries(samples: number[], series: GraphSeries[]) {
  return series.some((s) => {
    const seriesSamples = s.samples ?? samples;
    let pointCount = 0;
    for (let i = 0; i < s.values.length; i += 1) {
      const value = s.values[i];
      const sample = seriesSamples[i];
      if (value != null && sample != null && Number.isFinite(value) && Number.isFinite(sample)) {
        pointCount += 1;
        if (pointCount >= 2) return true;
      }
    }
    return false;
  });
}

function getMaxSample(samples: number[], series: GraphSeries[], eventTimes: EventMarker[]) {
  let maxSample = 1;
  const consider = (value: number) => {
    if (Number.isFinite(value)) maxSample = Math.max(maxSample, value);
  };

  samples.forEach(consider);
  eventTimes.forEach((event) => consider(event.sec));
  series.forEach((s) => (s.samples ?? samples).forEach(consider));
  return maxSample;
}

function LineGraph({ title, samples, series, minY, maxY, height, eventTimes = [] }: LineGraphProps) {
  if (!hasDrawableSeries(samples, series)) {
    return <div class="graph-empty">{title}: waiting for samples…</div>;
  }

  const innerWidth = WIDTH - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;
  const maxSample = getMaxSample(samples, series, eventTimes);
  const xScale = createScale(0, maxSample, 0, innerWidth);
  const yScale = createScale(minY, maxY, innerHeight, 0);
  const yTicks = gridTicks(minY, maxY, 5);
  const xTicks = gridTicks(0, maxSample, 5);

  return (
    <div class="graph-card">
      <h4>{title}</h4>
      <svg class="line-graph" viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none">
        <rect x={0} y={0} width={WIDTH} height={height} fill="#0f172a" rx={8} />
        <g transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
          {yTicks.map((tick) => (
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

          {xTicks.map((tick) => (
            <line
              key={`${title}-v-${tick}`}
              x1={xScale(tick)}
              y1={0}
              x2={xScale(tick)}
              y2={innerHeight}
              stroke="rgba(148, 163, 184, 0.14)"
              strokeWidth={1}
            />
          ))}

          {eventTimes.map((event) => {
            const x = xScale(event.sec);
            const color = event.color ?? "#ef4444";
            return (
              <g key={`${event.label}-${event.sec}`}>
                <line x1={x} y1={0} x2={x} y2={innerHeight} stroke={color} strokeDasharray="4 3" strokeWidth={1} />
                <text x={x + 2} y={12} fill={color} fontSize={10}>{event.label}</text>
              </g>
            );
          })}

          {series.map((s) => {
            const path = linePath(s.samples ?? samples, s.values, xScale, yScale);
            return path ? (
              <path
                key={`${title}-${s.label}`}
                d={path}
                stroke={s.color}
                strokeWidth={2}
                fill="none"
                vectorEffect="non-scaling-stroke"
              />
            ) : null;
          })}

          <line x1={0} y1={innerHeight} x2={innerWidth} y2={innerHeight} stroke="#94a3b8" strokeWidth={1} />
          <line x1={0} y1={0} x2={0} y2={innerHeight} stroke="#cbd5e1" strokeWidth={1} />

          {xTicks.map((tick) => (
            <g key={`${title}-x-label-${tick}`} transform={`translate(${xScale(tick)}, ${innerHeight})`}>
              <line y2={5} stroke="#94a3b8" strokeWidth={1} />
              <text y={17} fill="#94a3b8" fontSize={11} textAnchor="middle">
                {formatTick(tick)}
              </text>
            </g>
          ))}

          {yTicks.map((tick) => (
            <g key={`${title}-y-label-${tick}`} transform={`translate(0, ${yScale(tick)})`}>
              <line x2={-5} stroke="#cbd5e1" strokeWidth={1} />
              <text x={-8} y={4} fill="#cbd5e1" fontSize={11} textAnchor="end">
                {formatTick(tick)}
              </text>
            </g>
          ))}
        </g>
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
  heightScale = 1,
  profile,
}: {
  roast?: RoastState;
  heightScale?: number;
  profile?: Profile;
}) {
  const measurements = roast?.measurements ?? [];
  const start = roast?.startDate;
  const activeProfile = roast?.profile ?? profile;
  const profileSamples = activeProfile?.steps.length ? buildProfileSamples(activeProfile) : [];

  if (!measurements.length && !profileSamples.length) {
    return <div class="graph-empty">Load a profile or start logging to see the roast graph.</div>;
  }

  const sampleTimes = start ? measurements.map((m) => (m.timestamp.getTime() - start.getTime()) / 1000) : [];
  const bt = measurements.map((m) => m.message.BT);
  const et = measurements.map((m) => m.message.ET);
  const setpoint = measurements.map((m) => m.extra?.setpoint ?? 0);
  const fan = measurements.map((m) => m.message.FanVal);
  const heater = measurements.map((m) => m.message.BurnerVal);
  const btRor = buildRoR(bt, sampleTimes);
  const etRor = buildRoR(et, sampleTimes);
  const profileSetpoint = activeProfile
    ? profileSamples.map((seconds) => getProfileSetpointAtElapsed(activeProfile, seconds))
    : [];
  const profileFan = activeProfile
    ? profileSamples.map((seconds) => {
        const value = getProfileFanAtElapsed(activeProfile, seconds);
        return value == null ? null : value * 3;
      })
    : [];

  const eventTimes = start
    ? (roast?.events ?? []).map((event) => ({
        label: String(event.label),
        sec: (event.measurement.timestamp.getTime() - start.getTime()) / 1000,
      }))
    : [];
  const profileMarkers = activeProfile ? getProfileMarkers(activeProfile) : [];

  const clampedHeightScale = Math.min(1.8, Math.max(0.7, heightScale));
  const combinedHeight = Math.round(380 * clampedHeightScale);
  const series: GraphSeries[] = [];

  if (profileSetpoint.length) {
    series.push({ label: "Profile setpoint", color: "#facc15", samples: profileSamples, values: profileSetpoint });
  }
  if (profileFan.some((value) => value != null)) {
    series.push({ label: "Profile fan % (x3)", color: "#67e8f9", samples: profileSamples, values: profileFan });
  }
  if (measurements.length) {
    series.push(
      { label: "BT", color: "#60a5fa", values: bt },
      { label: "ET", color: "#f87171", values: et },
      { label: "Setpoint", color: "#34d399", values: setpoint },
      { label: "Fan % (x3)", color: "#38bdf8", values: fan.map((v) => v * 3) },
      { label: "Heater % (x3)", color: "#fb923c", values: heater.map((v) => v * 3) },
      { label: "BT RoR (x5)", color: "#22c55e", values: btRor.map((v) => (v == null ? null : Math.max(v, 0) * 5)) },
      { label: "ET RoR (x5)", color: "#a855f7", values: etRor.map((v) => (v == null ? null : Math.max(v, 0) * 5)) },
    );
  }

  return (
    <LineGraph
      title="Roast Logging Graph"
      samples={sampleTimes.length ? sampleTimes : profileSamples}
      minY={0}
      maxY={300}
      height={combinedHeight}
      eventTimes={[...profileMarkers, ...eventTimes]}
      series={series}
    />
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
    <LineGraph
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
