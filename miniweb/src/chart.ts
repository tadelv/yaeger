
import { Chart } from "chart.js/auto";
import { YaegerMessage } from "./model.ts"


let chartData: number[] = [1];
let heatData: number[] = [0];

export function initializeChart(ctx: CanvasRenderingContext2D): Chart {
  return new Chart(ctx, {
    type: "line",
    data: {
      labels: ["0"],
      datasets: [
        {
          label: "Live Data",
          data: [1],
          borderColor: "blue",
          borderWidth: 2,
        },
        {
          label: "Heat Data",
          data: [0],
          borderColor: "red",
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      animation: false,
    },
  });
}

export function updateChart(chart: Chart, message: YaegerMessage) {
  chart.data.datasets[0].data.push(message.FanVal);
  chart.data.datasets[1].data.push(message.BurnerVal);
  chart.data.labels.push(`${Math.floor(new Date().getTime())}`);
  chart.update();
}
