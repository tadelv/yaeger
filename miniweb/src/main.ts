import './style.css'
import van from "vanjs-core";
import { Chart } from "chart.js/auto";

const { div, input, h1, canvas } = van.tags;

// WebSocket message type
type WebSocketMessage = {
  values: number[];
};

// State variables
let chartData: number[] = [0, 0, 0, 0, 0, 0];
const slider1Value = van.state(50);
const slider2Value = van.state(50);

// Initialize WebSocket
//const socket = new WebSocket("wss://your-websocket-server");

//socket.onopen = () => console.log("WebSocket connection established");
//socket.onclose = () => console.log("WebSocket connection closed");
//socket.onerror = (error) => console.error("WebSocket error:", error);

// Chart.js setup
const chartElement = canvas({ id: "liveChart" });
const ctx = chartElement.getContext("2d") as CanvasRenderingContext2D;

const chart = new Chart(ctx, {
  type: "line",
  data: {
    labels: ["1", "2", "3", "4", "5", "6"],
    datasets: [
      {
        label: "Live Data",
        data: chartData,
        borderColor: "blue",
        borderWidth: 2,
      },
    ],
  },
  options: {
    responsive: true,
    animation: false,
  },
});

// WebSocket message handling
//socket.onmessage = (event) => {
//  try {
//    const data: WebSocketMessage = JSON.parse(event.data);
//    chartData = data.values;
//    chart.data.datasets[0].data = chartData;
//    chart.update();
//  } catch (error) {
//    console.error("Error parsing WebSocket message:", error);
//  }
//};

// Slider change handler
const onSliderChange = (slider: string, value: number) => {
  //socket.send(JSON.stringify({ slider, value }));
	console.log("slider: ", JSON.stringify(({slider, value})))
};

// UI creation
const app = div(
  h1("VanJS WebSocket Live Chart"),
  chartElement,
  div(
    "Slider 1:",
    input({
      type: "range",
      min: "0",
      max: "100",
      value: slider1Value,
      oninput: (e: Event) => {
        const target = e.target as HTMLInputElement;
        slider1Value.val = parseInt(target.value, 10);
        onSliderChange("slider1", slider1Value.val);
      },
    })
  ),
  div(
    "Slider 2:",
    input({
      type: "range",
      min: "0",
      max: "100",
      value: slider2Value,
      oninput: (e: Event) => {
        const target = e.target as HTMLInputElement;
        slider2Value.val = parseInt(target.value, 10);
        onSliderChange("slider2", slider2Value.val);
      },
    })
  )
);

// Attach UI to DOM
van.add(document.getElementById("app") as HTMLElement, app);
