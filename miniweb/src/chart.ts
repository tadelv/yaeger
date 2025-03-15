import chartTrendline from "chartjs-plugin-trendline";
import "chartjs-adapter-date-fns";
import { Chart, plugins } from "chart.js/auto";
import { RoastState, YaegerMessage } from "./model.ts";

export function initializeChart(ctx: CanvasRenderingContext2D): Chart {
  return new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Bean Temp",
          borderColor: "blue",
          pointStyle: false,
          data: [],
          yAxisID: "y1",
          tension: 0.4,
        },
        {
          label: "Exhaust Temp",
          borderColor: "red",
          pointStyle: false,
          data: [],
          yAxisID: "y1",
          tension: 0.4,
        },
        {
          label: "Fan Power",
          borderColor: "#055088",
          pointStyle: false,
          data: [],
          yAxisID: "y2",
          tension: 0.1,
        },
        {
          label: "Heater Power",
          pointStyle: false,
          borderColor: "orange",
          data: [],
          yAxisID: "y2",
          tension: 0.1,
        },
      ],
    },
    options: {
      interaction: {
        intersect: false,
        mode: "index",
        axis: "xy",
      },
      plugins: {
        tooltip: {
          callbacks: {
            title: function (item) {
              const x = item[0].parsed.x;
              if (x < 60) {
                return `${x} seconds`;
              }
              return `${Math.floor(x / 60)} minutes, ${(x % 60).toFixed(2)} seconds`;
            },
          },
        },
      },
      scales: {
        x: {
          grace: 5,
          type: "linear",
          bounds: "ticks",
          beginAtZero: true,
          title: {
            display: true,
            text: "Time",
          },
          ticks: {
            stepSize: 60,
            callback: function (value: any, __, _) {
              if (value <= 60) {
                return `${value}s`;
              } else {
                const minutes = Math.floor(value / 60);
                return `${minutes}m`;
              }
            },
          },
        },
        //x: { type: 'time', time: { unit: 'minute' } },
        y1: {
          min: 0,
          max: 300,
          type: "linear",
          position: "left",
          title: {
            display: true,
            text: "Temperature (°C)",
          },
        },
        y2: {
          min: 0,
          max: 100,
          type: "linear",
          position: "right",
          title: {
            display: true,
            text: "Fan/Heater power (%)",
          },
        },
        y3: {
          min: 0,
          max: 60,
          //type: "logarithmic",
        },
      },
      responsive: true,
      animation: false,
    },
    lineAtIndex: [],
    plugins: [verticalLinePlugin],
  });
}

export function updateChart(chart: Chart, roast: RoastState) {
  chart.data.datasets[0].data = roast.measurements.map((el) => el.message.BT);
  chart.data.datasets[1].data = roast.measurements.map((el) => el.message.ET);
  chart.data.datasets[2].data = roast.measurements.map(
    (el) => el.message.FanVal,
  );

  const { measurements, startDate } = roast;
  const timestamps = measurements.map(
    (el) => (el.timestamp.getTime() - startDate.getTime()) / 1000,
  );
  const beanTemps = measurements.map((el) => el.message.BT);
  const envTemps = measurements.map((el) => el.message.ET);

  const windowSize = 30;

  // Helper to calculate rate of rise (RoR)
  const calculateRoR = (temps: number[], times: number[]) =>
    temps.map((temp, i) => {
      if (i === 0) return null; // No RoR for the first data point
      const deltaTemp = temp - temps[i - 1];
      const deltaTime = times[i] - times[i - 1];
      return deltaTime > 0 ? deltaTemp / deltaTime : 0;
    });

  // Helper to calculate rolling average
  const applyRollingAverage = (values: (number | null)[], size: number) => {
    return values.map((val, i, arr) => {
      if (val === null || i < size - 1) return val; // Skip if insufficient data
      const window = arr.slice(i - size + 1, i + 1) as number[];
      return window.reduce((sum, v) => sum + v * 60, 0) / size;
    });
  };

  // Calculate RoR and apply rolling averages
  const btRor = applyRollingAverage(
    calculateRoR(beanTemps, timestamps),
    windowSize,
  );
  const etRor = applyRollingAverage(
    calculateRoR(envTemps, timestamps),
    windowSize,
  );

  // Add datasets to chart
  chart.data.datasets[4] = {
    label: "BT Rate of Rise (°C/min)",
    borderColor: "green",
    pointStyle: false,
    data: btRor,
    yAxisID: "y3",
    tension: 0.2,
  };

  chart.data.datasets[5] = {
    label: "ET Rate of Rise (°C/min)",
    borderColor: "purple",
    pointStyle: false,
    data: etRor,
    yAxisID: "y3",
    tension: 0.2,
  };

  chart.data.datasets[6] = {
    label: "Setpoint (°C)",
    borderColor: "#03fc7b",
    pointStyle: false,
    data: roast.measurements.map((el) => el.extra?.setpoint ?? 0),
    yAxisID: "y1",
    tension: 0.1,
  };

  chart.data.datasets[3].data = roast.measurements.map(
    (el) => el.message.BurnerVal,
  );
  chart.data.labels = roast.measurements.map(
    (el) => `${(el.timestamp.getTime() - roast.startDate.getTime()) / 1000}`,
  );
  chart.config._config.lineAtIndex = roast.events.map((event) => {
    return {
      label: event.label,
      idx: roast.measurements.findIndex((el) => {
        return (
          Math.abs(
            el.timestamp.getTime() - event.measurement.timestamp.getTime(),
          ) < 500
        );
      }),
    };
  });
  chart.update();
}

const verticalLinePlugin = {
  getLinePosition: function (chart, pointIndex) {
    const meta = chart.getDatasetMeta(0); // first dataset is used to discover X coordinate of a point
    const data = meta.data;
    return data[pointIndex.idx].x;
  },

  renderVerticalLine: function (chartInstance, pointIndex) {
    const lineLeftOffset = this.getLinePosition(chartInstance, pointIndex);
    const scale = chartInstance.scales.y1;
    const context = chartInstance.ctx;
    // render vertical line
    context.beginPath();
    context.strokeStyle = "#ff0000";
    context.moveTo(lineLeftOffset, scale.top);
    context.lineTo(lineLeftOffset, scale.bottom);
    context.stroke();

    // write label
    context.fillStyle = "#ff0000";
    context.textAlign = "trailing";
    context.fillText(
      pointIndex.label,
      lineLeftOffset,
      scale.bottom - 20,
      // (scale.bottom - scale.top) / 2 + scale.top,
    );
  },

  beforeDatasetsDraw: function (chart, easing) {
    if (chart.config._config.lineAtIndex) {
      console.log("doing ", chart.config._config.lineAtIndex);
      chart.config._config.lineAtIndex.forEach((pointIndex) => {
        this.renderVerticalLine(chart, pointIndex);
      });
    }
  },
};
