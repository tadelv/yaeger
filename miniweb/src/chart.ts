import chartTrendline from "chartjs-plugin-trendline";
import "chartjs-adapter-date-fns";
import { Chart } from "chart.js/auto";
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
          trendlineLinear: {
            colorMin: "#0f0588",
            colorMax: "#00f0ff",
            lineStyle: "dotted",
            width: 1,
          },
          yAxisID: "y1",
          tension: 0.4,
        },
        {
          label: "Exhaust Temp",
          borderColor: "red",
          pointStyle: false,
          data: [],
          trendlineLinear: {
            colorMin: "#666099",
            colorMax: "#f770aa",
            lineStyle: "dotted",
            projection: true,
            width: 3,
          },
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
      scales: {
        x: { grace: 5, type: "linear", bounds: "ticks", beginAtZero: true },
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
      },
      responsive: true,
      animation: false,
    },
    lineAtIndex: [],
    plugins: [verticalLinePlugin, chartTrendline],
  });
}

export function updateChart(chart: Chart, roast: RoastState) {
  chart.data.datasets[0].data = roast.measurements.map((el) => el.message.BT);
  chart.data.datasets[1].data = roast.measurements.map((el) => el.message.ET);
  chart.data.datasets[2].data = roast.measurements.map(
    (el) => el.message.FanVal,
  );
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
				return Math.abs(el.timestamp.getTime() - event.measurement.timestamp.getTime()) < 500
			})
		}
	})
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
    context.textAlign = "center";
    context.fillText(
      pointIndex.label,
      lineLeftOffset,
      (scale.bottom - scale.top) / 2 + scale.top,
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
