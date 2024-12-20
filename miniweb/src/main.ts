import "./style.css";
import van from "vanjs-core";
import { Chart } from "chart.js/auto";
import { YaegerMessage } from "./model.ts"

const { div, input, h1, canvas } = van.tags;


// State variables
let chartData: number[] = [1];
let heatData: number[] = [0];
const slider1Value = van.state(50);
const slider2Value = van.state(50);

// Initialize WebSocket
const socket = new WebSocket("ws://" + location.host + "/ws");

socket.onopen = () => {
  console.log("WebSocket connection established");
  startPeriodicWebSocketMessages(1000);
};
socket.onclose = () => console.log("WebSocket connection closed");
socket.onerror = (error) => console.error("WebSocket error:", error);

// Chart.js setup
const chartElement = canvas({ id: "liveChart" });
const ctx = chartElement.getContext("2d") as CanvasRenderingContext2D;

const chart = new Chart(ctx, {
  type: "line",
  data: {
    labels: ["0"],
    datasets: [
      {
        label: "Live Data",
        data: chartData,
        borderColor: "blue",
        borderWidth: 2,
      },
			{

        label: "heat Data",
        data: heatData,
        borderColor: "red",
        borderWidth: 2,
			}
    ],
  },
  options: {
    responsive: true,
    animation: false,
  },
});

// WebSocket message handling
socket.onmessage = (event) => {
  try {
    console.log(event.data);
    const data = JSON.parse(event.data);
    const message: YaegerMessage = data.data;
    if (message != undefined) {
      slider1Value.val = message.FanVal
			slider2Value.val = message.BurnerVal
      chart.data.datasets[0].data.push(message.FanVal);
			chart.data.datasets[1].data.push(message.BurnerVal)
      chart.data.labels.push(`${Math.floor(new Date().getTime())}`);
      chart.update();

    }
  } catch (error) {
    console.error("Error parsing WebSocket message:", error);
  }
};

// Slider change handler
const onSliderChange = (slider: string, value: number) => {
  console.log("slider: ", JSON.stringify({ slider, value }));
  switch (slider) {
    case "slider1":
      console.log("fan");
      updateFanPower(value);
      break;
    case "slider2":
      console.log("heat");
      updateHeaterPower(value);
      break;
    default:
      break;
  }
};
export function updateFanPower(value: number) {
  console.log("updateFanPower", value);
  sendCommand({ id: 1, FanVal: value });
}
export function updateHeaterPower(value: number) {
  sendCommand({ id: 1, BurnerVal: value });
}

function sendCommand(data: any) {
  // WebSocket code to send updated values
  let msg = JSON.stringify(data);
  console.log("sending command: ", msg);
  socket?.send(msg);
}

// UI creation
const app = div(
  h1("VanJS WebSocket Live Chart"),
  chartElement,
  div(
    "FAN 1:",
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
    }),
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
    }),
  ),
);

function startPeriodicWebSocketMessages(interval: number) {
  if (socket.readyState === WebSocket.OPEN) {
    const timerId = setInterval(() => {
      const cmd = JSON.stringify({
        id: 1,
        command: "getData",
      });
      socket.send(cmd);
    }, interval);

    // Clear timer on WebSocket close
    socket.onclose = () => {
      clearInterval(timerId);
      console.log("Timer stopped due to WebSocket closure.");
    };
  } else {
    console.warn("WebSocket is not open. Timer will not start.");
  }
}
// Attach UI to DOM
van.add(document.getElementById("app") as HTMLElement, app);
